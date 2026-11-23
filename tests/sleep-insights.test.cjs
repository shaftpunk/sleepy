const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, imports = {}) {
  const exports = {};
  const source = fs.readFileSync('src/analytics/' + name + '.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name], Date });
  return exports;
}

const { buildSleepInsights, sleepInsightsWindow } = load('sleepInsights', {
  './time': load('time'),
  './normalize': load('normalize'),
});
const row = (id, start, end, baby = 'baby') => ({
  id, starttime: start, endtime: end, baby_id: baby, durationminutes: null, rate: null, sleep_type: null,
});
const minutes = (days, key) => days.find(day => day.dayKey === key).minutes;

test('today heads the seven-day view and midnight overlap splits across actual local days', () => {
  process.env.TZ = 'Europe/Oslo';
  const now = Date.parse('2026-11-25T12:00:00+01:00');
  const result = buildSleepInsights([
    row('night', '2026-11-24T23:00:00+01:00', '2026-11-25T02:00:00+01:00'),
    row('duplicate', '2026-11-24T23:30:00+01:00', '2026-11-25T01:00:00+01:00'),
  ], 'baby', now);
  assert.equal(result.last7.length, 7);
  assert.equal(result.last7[0].dayKey, '2026-11-25');
  assert.equal(result.last7[0].minutes, 120);
  assert.equal(result.last7[1].minutes, 60);
  assert.equal(result.last7[2].minutes, null);
});

test('DST dates use 23-hour and 25-hour local calendar days', () => {
  for (const [key, next, hours] of [['2026-03-29', '2026-03-30', 23], ['2026-10-25', '2026-10-26', 25]]) {
    const { last7 } = buildSleepInsights([row('one', key + 'T00:00:00', next + 'T00:00:00')], 'baby', Date.parse(next + 'T12:00:00'));
    assert.equal(minutes(last7, key), hours * 60);
  }
});

test('30-day series is oldest first, preserves gaps and confines the active sleep to today', () => {
  const now = Date.parse('2026-11-25T01:45:00+01:00');
  const { last30 } = buildSleepInsights([
    row('active', '2026-11-24T23:00:00+01:00', null),
    row('other', '2026-11-23T09:00:00+01:00', '2026-11-23T12:00:00+01:00', 'other'),
    row('older', '2026-11-22T09:00:00+01:00', '2026-11-22T12:00:00+01:00'),
    { ...row('deleted', '2026-11-24T09:00:00+01:00', '2026-11-24T12:00:00+01:00'), deleted_at: 'yes' },
  ], 'baby', now);
  assert.equal(last30.length, 30);
  assert.equal(last30[0].dayKey, '2026-10-27');
  assert.equal(last30.at(-1).minutes, 105);
  assert.equal(minutes(last30, '2026-11-24'), null);
  assert.equal(minutes(last30, '2026-11-23'), null);
  assert.equal(minutes(last30, '2026-11-22'), 180);
});

test('15 Monday-based weeks share one scale and retain seven slots, including gaps', () => {
  const now = Date.parse('2026-11-25T12:00:00+01:00');
  const { weeks, scaleMinutes } = buildSleepInsights([
    row('today', '2026-11-25T06:00:00+01:00', '2026-11-25T07:30:00+01:00'),
    row('old', '2026-08-17T05:00:00+02:00', '2026-08-17T12:00:00+02:00'),
  ], 'baby', now);
  assert.equal(weeks.length, 15);
  assert.ok(weeks.every(week => week.length === 7));
  assert.equal(weeks[0][0].dayKey, '2026-11-23');
  assert.equal(weeks[0][2].minutes, 90);
  assert.equal(weeks[0][3].minutes, null);
  assert.equal(weeks.at(-1)[0].dayKey, '2026-08-17');
  assert.equal(weeks.at(-1)[0].minutes, 420);
  assert.equal(scaleMinutes, 420);
  assert.equal(sleepInsightsWindow(now).startMs, Date.parse('2026-08-17T00:00:00+02:00'));
});
