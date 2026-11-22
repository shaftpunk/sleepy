const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name], Date });
  return exports;
}

const { logDayBounds, localDayKey, logTimeline } = load('src/lib/logDay.ts', {
  '../analytics/localDate': load('src/analytics/localDate.ts'),
});

test('Log day is a local calendar day across spring and autumn DST transitions', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/Oslo';
  try {
    for (const [key, hours] of [['2026-03-29', 23], ['2026-10-25', 25], ['2026-11-21', 24]]) {
      const {start, end} = logDayBounds(key, '2026-11-22');
      assert.equal(start.getHours(), 0);
      assert.equal(end.getHours(), 0);
      assert.equal(localDayKey(start), key);
      assert.equal((end - start) / 3600000, hours);
    }
    assert.equal(logDayBounds('2026-02-30', '2026-11-22').key, '2026-11-22');
    assert.equal(logDayBounds(null, '2026-11-22').key, '2026-11-22');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('Sleep time is anchored on the selected day and ties are deterministic', () => {
  const {start, end} = logDayBounds('2026-11-21', '2026-11-21');
  const time = new Date(+start + 20000).toISOString();
  const overnight = { id: 'overnight', starttime: new Date(+start - 10000).toISOString(), endtime: time };
  const active = { id: 'active', starttime: new Date(+start + 30000).toISOString(), endtime: null };
  const feeds = [{ id: 'z', starttime: time }, { id: 'a', starttime: time }];
  const diapers = [{ id: 'wet', changed_at: time }];
  const ordered = logTimeline([overnight, active], feeds, diapers, +start, +end);
  assert.deepEqual(Array.from(ordered, entry => entry.record.id), ['active', 'wet', 'a', 'z', 'overnight']);
  const prior = logDayBounds('2026-11-20', '2026-11-21');
  assert.equal(logTimeline([overnight], [], [], +prior.start, +prior.end)[0].time, Date.parse(overnight.starttime));
});

function readerFixture(data) {
  const calls = [];
  const supabase = { from(table) {
    const filters = [];
    const sortColumns = [];
    const query = {
      select() { return query; },
      eq(column, value) { filters.push(row => row[column] === value); return query; },
      is(column, value) { return query.eq(column, value); },
      gte(column, value) { filters.push(row => row[column] >= value); return query; },
      lt(column, value) { filters.push(row => row[column] < value); return query; },
      order(column) { sortColumns.push(column); return query; },
      async range(from, to) {
        calls.push({ table, from, to, sortColumns });
        const sorted = data.filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const column of sortColumns) {
            const order = String(a[column]).localeCompare(String(b[column]));
            if (order) return order;
          }
          return 0;
        });
        return { data: sorted.slice(from, to + 1), error: null };
      },
    };
    return query;
  }};
  return { calls, imports: { '../lib/supabase': { supabase } } };
}

for (const [service, reader, column, table] of [
  ['diaperService', 'getDiaperChangesBetween', 'changed_at', 'diaper_changes'],
  ['feedService', 'getFeedsBetween', 'starttime', 'feed'],
]) {
  test(reader + ' includes historical and paginated records with scoped half-open bounds', async () => {
    const first = '2026-10-25T00:00:00.000Z';
    const next = '2026-10-26T00:00:00.000Z';
    const entry = (id, time, baby = 'baby', deleted = null) => ({ id, [column]: time, baby_id: baby, deleted_at: deleted });
    const data = [
      ...Array.from({length: 220}, (_, i) => entry(String(i).padStart(3, '0'), first)),
      ...Array.from({length: 25}, (_, i) => entry('newer-' + i, next)),
      entry('other', first, 'other'),
      ...(table === 'feed' ? [entry('deleted', first, 'baby', next)] : []),
    ];
    const fixture = readerFixture(data);
    const result = await load('src/services/' + service + '.ts', fixture.imports)[reader]('baby', first, next);
    assert.equal(result.length, 220);
    assert.equal(result[0].id, '000');
    assert.equal(result.at(-1).id, '219');
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(fixture.calls[0], { table, from: 0, to: 199, sortColumns: [column, 'id'] });
  });
}

test('existing sleep reader uses overlap and scopes deleted records and baby identity', async () => {
  const calls = [];
  const query = {};
  for (const name of ['select', 'eq', 'is', 'lt', 'or']) {
    query[name] = (...args) => { calls.push([name, ...args]); return query; };
  }
  query.order = async () => ({ data: [{id:'overnight'}], error: null });
  const supabase = { from: table => { assert.equal(table, 'sleep'); return query; } };
  const { getSleepsOverlappingPeriod } = load('src/services/sleepService.ts', {
    '../lib/supabase': { supabase },
  });
  const rows = await getSleepsOverlappingPeriod('baby', 'start', 'end');
  assert.deepEqual(calls, [
    ['select','*'], ['eq','baby_id','baby'], ['is','deleted_at',null], ['lt','starttime','end'],
    ['or','endtime.is.null,endtime.gt.start'],
  ]);
  assert.equal(rows[0].id, 'overnight');
});
