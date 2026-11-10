const fs = require('node:fs');
const ts = require('typescript');
const file = require('node:path').join(__dirname, '../src/sound/detector.ts');
const exportsObject = {};
new Function('exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exportsObject);
const base = 1700000000000;
const runs = (level, from, to, step = 500) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => [base + from + i * step, level]);
const cases = [
  ['quiet', .06, [...runs(.01, 0, 5000), [base + 5000, -1]]],
  ['short-clap', .06, [...runs(.3, 0, 1000), ...runs(0, 1500, 5000), [base + 5000, -1]]],
  ['exact-debounce-and-cooldown', .06, [...runs(.06, 0, 2000), ...runs(0, 2500, 5000), [base + 5000, -1]]],
  ['stop-flush-idempotent', .06, [...runs(.2, 0, 3000), [base + 3100, -1], [base + 3100, -1]]],
  ['quiet-gap-bridged', .06, [...runs(.1, 0, 2000), ...runs(.01, 2500, 3500), ...runs(.4, 4000, 6000), [base + 6000, -1]]],
  ['suspended-gap', .06, [...runs(.2, 0, 2500), ...runs(.3, 10000, 12500), [base + 12500, -1]]],
  ['clock-reversal', .06, [...runs(.2, 1000, 3500), ...runs(.2, 0, 2500), [base + 2500, -1]]],
  ['below-medium-threshold', .06, [...runs(.059, 0, 4000), [base + 4000, -1]]],
  ['high-threshold', .025, [...runs(.025, 0, 2500), [base + 2500, -1]]],
  ['low-threshold-clamping', .12, [...runs(1.5, 0, 2500), [base + 2500, -1]]],
];
module.exports = cases.map(([name, threshold, steps]) => {
  const expected = [];
  const detector = new exportsObject.SoundDetector(threshold, e => expected.push({ startMs: Date.parse(e.started_at), endMs: Date.parse(e.ended_at), avgLevel: e.avg_level, maxLevel: e.max_level }));
  for (const [time, level] of steps) { if (level < 0) detector.flush(time); else detector.sample(level, time); }
  return { name, threshold, steps, expected };
});
