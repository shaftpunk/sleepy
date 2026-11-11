const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, Date, require: name => load(path.resolve(path.dirname(file), name + '.ts')) });
  return exports;
}
const { estimateActiveSleep, estimatedSleepProgress } =
  load(path.resolve(__dirname, '../src/analytics/activeSleepEstimate.ts'));
const estimateActiveSleepWakeTime = (history, active) => estimateActiveSleep(history, active).estimatedWakeTime;
const minute = 60000, day = 1440 * minute;
const start = Date.parse('2026-11-10T13:00:00+01:00');
const active = { id: 'active', startMs: start, sleepTypeRaw: 'nap' };
const nap = (daysAgo, durationMin) => ({ id: String(daysAgo), startMs: start - daysAgo * day,
  endMs: start - daysAgo * day + durationMin * minute, durationMin, sleepTypeRaw: 'nap' });

test('personal median uses cleaned, prior same-baby naps across three days', () => {
  const history = [nap(1, 80), nap(2, 100), nap(3, 130), nap(15, 15), nap(4, 900), nap(-1, 20),
    { ...nap(1, 100), id: 'overlap', startMs: start - day + minute },
    { ...nap(5, 600), sleepTypeRaw: 'night' }];
  assert.equal(estimateActiveSleepWakeTime(history, active), start + 100 * minute);
});
test('missing history, duplicate nap days and a long overnight sleep do not manufacture an estimate', () => {
  assert.equal(estimateActiveSleepWakeTime([], active), null);
  assert.equal(estimateActiveSleepWakeTime([nap(1, 45), nap(2, 45), nap(2, 40)], active), null);
  assert.equal(estimateActiveSleepWakeTime([nap(1, 60), nap(2, 70), nap(3, 80)],
    { ...active, startMs: Date.parse('2026-11-10T23:00:00+01:00'), sleepTypeRaw: 'night' }), null);
});
test('progress at start, halfway, close, and past uses elapsed dates and clamps', () => {
  const end = start + 100 * minute;
  const sample = elapsed => ({ ...estimatedSleepProgress(start, end, start + elapsed * minute) });
  assert.deepEqual(sample(0), { progress: 0, remainingMinutes: 100, phase: 'remaining' });
  assert.deepEqual(sample(50), { progress: 0.5, remainingMinutes: 50, phase: 'remaining' });
  assert.deepEqual(sample(65), { progress: 0.65, remainingMinutes: 35, phase: 'remaining' });
  assert.deepEqual(sample(99), { progress: 0.99, remainingMinutes: 1, phase: 'soon' });
  assert.deepEqual(sample(100), { progress: 1, remainingMinutes: 0, phase: 'past' });
  assert.deepEqual(sample(160), { progress: 1, remainingMinutes: 0, phase: 'past' });
  assert.equal(estimatedSleepProgress(start, null, start), null);
  assert.equal(estimatedSleepProgress(start, start, start), null);
});
test('a one-minute estimate remains bounded and a sub-minute median is omitted', () => {
  assert.equal(estimateActiveSleepWakeTime([nap(1, 0.5), nap(2, 0.5), nap(3, 0.5)], active), null);
  assert.equal(estimateActiveSleepWakeTime([nap(1, 1), nap(2, 1), nap(3, 1)], active), start + minute);
  assert.equal(estimatedSleepProgress(start, start + minute, start + 30000).phase, 'soon');
});
test('absolute time arithmetic survives DST transitions and zone changes', () => {
  const before = Date.parse('2026-10-25T02:30:00+02:00');
  const after = Date.parse('2026-10-25T02:30:00+01:00');
  assert.equal(after - before, 60 * minute);
  assert.equal(estimatedSleepProgress(before, after, Date.parse('2026-10-25T01:00:00Z')).progress, 0.5);
  assert.equal(estimatedSleepProgress(before, after, Date.parse('2026-10-24T21:00:00-04:00')).progress, 0.5);
});
