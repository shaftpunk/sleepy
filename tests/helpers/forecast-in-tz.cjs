/* Prints the local-clock forecast for a synthetic history in the timezone the
   process was started with (TZ env). Used to check timezone independence. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { generate } = require('./synthetic-sleep.cjs');
const root = path.resolve(__dirname, '..', '..'), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Intl, require: name => load(path.join(path.dirname(file), name) + '.ts') });
  return exports;
}
const { calculateNextSleep } = load(path.join(root, 'src/analytics/nextSleep.ts'));
const { calculateDailySleepForecast } = load(path.join(root, 'src/analytics/dailySleepForecast.ts'));
const { sessions, dayPlans, profile } = generate('conditional', { seed: 21 });
const local = ms => new Date(ms).toTimeString().slice(0, 5), out = [];
for (const plan of dayPlans.slice(-4, -1)) {
  const cp = plan.wakeAt + 200 * 60000, visible = sessions.filter(s => s.endMs <= cp);
  const nextSleep = calculateNextSleep({ sessions: visible, active: null, now: cp, ageDays: profile.ageDays });
  const forecast = calculateDailySleepForecast({ sessions: visible, active: null, now: cp, nextSleep, ageDays: profile.ageDays });
  out.push(forecast.predictedNaps.map(n => [local(n.onset.typicalMs), n.durationMinutes?.typicalMin ?? null]));
}
console.log(JSON.stringify(out));
