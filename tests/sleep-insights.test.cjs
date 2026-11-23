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

const time = load('time');
const rhythm = load('sleepRhythm', { './time': time });
const { buildSleepInsights, sleepInsightsWindow } = load('sleepInsights', {
  './time': time, './sleepRhythm': rhythm,
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

test('rhythm splits overnight blocks at local midnight, clips active sleep and preserves empty days', () => {
  const now = Date.parse('2026-11-25T15:45:00+01:00');
  const { rhythm: days } = buildSleepInsights([
    row('night', '2026-11-24T23:15:00+01:00', '2026-11-25T02:30:00+01:00'),
    row('nap', '2026-11-25T15:00:00+01:00', null),
    row('other', '2026-11-22T11:00:00+01:00', '2026-11-22T12:00:00+01:00', 'other'),
  ], 'baby', now);
  const pieces = block => JSON.parse(JSON.stringify(block.pieces));
  assert.equal(days.length, 7);
  assert.equal(days[0].dayKey, '2026-11-25');
  assert.deepEqual(pieces(days[0].blocks[0]), [{ startMinute: 0, endMinute: 150 }]);
  assert.deepEqual(pieces(days[1].blocks[0]), [{ startMinute: 1395, endMinute: 1440 }]);
  const active = days[0].blocks[1];
  assert.equal(active.endMs, now);
  assert.equal(active.active, true);
  assert.deepEqual(pieces(active), [{ startMinute: 900, endMinute: 945 }]);
  assert.equal(days[3].blocks.length, 0);
  assert.equal(rhythm.visibleRhythmDays(days, 14).length, 7);
});

test('rhythm uses the 24-hour local clock through both DST transitions', () => {
  for (const [key, startHour, endHour, expected, duration] of [
    ['2026-03-29', '01:30', '04:30', [[90,120],[180,270]], 120],
    ['2026-10-25', '01:30', '04:30', [[90,180],[120,270]], 240],
  ]) {
    const now = Date.parse(key + 'T12:00:00');
    const { rhythm: days } = buildSleepInsights([
      row('dst', key + 'T' + startHour + ':00', key + 'T' + endHour + ':00'),
    ], 'baby', now);
    const block = days[0].blocks[0];
    assert.deepEqual(Array.from(block.pieces, piece => [piece.startMinute, piece.endMinute]), expected);
    assert.equal((block.endMs - block.startMs) / 60000, duration);
  }
});

test('expansion keeps earlier rows, stops at oldest evidence and caps at 105 rolling days', () => {
  const now = Date.parse('2026-11-25T12:00:00+01:00');
  const old = row('old', '2026-11-04T12:00:00+01:00', '2026-11-04T13:00:00+01:00');
  const { rhythm: days } = buildSleepInsights([old], 'baby', now);
  const shown = count => rhythm.visibleRhythmDays(days, count);
  assert.deepEqual([7, 14, 21, 28].map(count => shown(count).length), [7, 14, 21, 22]);
  assert.deepEqual(shown(7), shown(21).slice(0, 7));
  assert.equal(shown(35).at(-1).dayKey, '2026-11-04');
  const first = new Date(rhythm.sleepRhythmStart(now));
  assert.equal(first.getHours(), 0);
  const readEdge = row('edge', first.toISOString(), new Date(first.getTime() + 3600000).toISOString());
  const capped = buildSleepInsights([readEdge, row('too-old', '2026-08-01T12:00:00+02:00', '2026-08-01T13:00:00+02:00')], 'baby', now).rhythm;
  assert.equal(capped.length, 105);
  assert.equal(rhythm.visibleRhythmDays(capped, 112).length, 105);
  assert.equal(capped.at(-1).blocks[0].id, 'edge');
});
