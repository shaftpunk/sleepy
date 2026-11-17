const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
process.env.TZ = process.env.TZ || 'Europe/Oslo';
function loader() { const cache = new Map(); function load(file) { if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports); vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Intl, require: name => load(path.join(path.dirname(file), name) + '.ts') }); return exports; } return load; }
const load = loader();
const { calculateDailySleepForecast: forecastOf, historicalScenarios, FORECAST_RULES } = load('src/analytics/dailySleepForecast.ts');
const { calculateNextSleep } = load('src/analytics/nextSleep.ts');
const { generate } = require('./helpers/synthetic-sleep.cjs');
const { runBacktest } = require('./daily-forecast-backtest.cjs');
const minute = 60000;
const session = (startMs, endMs) => ({ id: `${startMs}-${endMs}`, startMs, endMs, durationMin: (endMs - startMs) / minute, rate: null, note: null, sleepTypeRaw: 'sleep' });
const at = (daysAgo, h, m = 0, base = new Date(2026, 10, 16)) => { const d = new Date(base); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.getTime(); };

/* Deterministic history: nights 19:30-07:00, naps from plan(day) as
   [startHour, startMinute, durationMin]; small jitter keeps windows realistic. */
function history(plan, { days = 14, base } = {}) {
  const out = [];
  for (let d = days; d >= 1; d--) {
    out.push(session(at(d + 1, 19, 30, base), at(d, 7, 0, base)));
    const jitter = ((d * 7) % 5) * 3;
    for (const [h, m, dur] of plan(d)) out.push(session(at(d, h, m + jitter, base), at(d, h, m + jitter + dur, base)));
  }
  return out;
}
const regular = () => [[9, 0, 60], [12, 30, 90], [16, 0, 40]];
function run(sessions, now, { ageDays = 180, active = null } = {}) {
  const nextSleep = calculateNextSleep({ sessions, active, now, ageDays });
  return { nextSleep, forecast: forecastOf({ sessions, active, now, nextSleep, ageDays }) };
}
const today = (base = history(regular)) => [...base, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10))];
const now = at(0, 10, 15);

test('consistent multi-nap history forecasts ordered later naps with Next Sleep first', () => {
  const { nextSleep, forecast } = run(today(), now);
  assert.equal(forecast.status, 'ready');
  const [first, second] = forecast.predictedNaps;
  assert.equal(first.onset.earliestMs, nextSleep.earliestStart); assert.equal(first.onset.latestMs, nextSleep.latestStart); assert.equal(first.onset.typicalMs, nextSleep.likelyStart);
  assert.ok(first.isNext && !second.isNext);
  assert.ok(Math.abs(first.durationMinutes.typicalMin - 90) <= 10, JSON.stringify(first.durationMinutes));
  assert.ok(Math.abs(second.onset.typicalMs - at(0, 16, 6)) <= 30 * minute, new Date(second.onset.typicalMs).toString());
  assert.ok(Math.abs(second.durationMinutes.typicalMin - 40) <= 10);
  for (let i = 1; i < forecast.predictedNaps.length; i++) assert.ok(forecast.predictedNaps[i].onset.typicalMs > forecast.predictedNaps[i - 1].wakeTime.typicalMs);
});

test('Next Sleep is never altered (no regression) and sleeping/insufficient states abstain', () => {
  const sessions = today(), { nextSleep } = run(sessions, now);
  assert.equal(JSON.stringify(calculateNextSleep({ sessions, active: null, now, ageDays: 180 })), JSON.stringify(nextSleep));
  const sleeping = run(sessions, now, { active: { id: 'a', startMs: at(0, 10, 5) } }).forecast;
  assert.equal(sleeping.status, 'sleeping'); assert.equal(sleeping.predictedNaps.length, 0);
  const empty = run([], now).forecast; assert.equal(empty.status, 'insufficient_data'); assert.equal(empty.predictedNaps.length, 0);
});

test('sparse data shows only the Next Sleep event or abstains', () => {
  const sparse = [...history(regular, { days: 14 }).filter(s => s.startMs > at(4, 0)), session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10))];
  const { forecast } = run(sparse, now);
  assert.ok(forecast.predictedNaps.length <= 1, JSON.stringify({ status: forecast.status, n: forecast.predictedNaps.length, d: forecast.diagnostics }));
  assert.ok(['partial', 'insufficient_data'].includes(forecast.status));
});

test('missing logging periods are not wakefulness and never become scenarios', () => {
  // Every other day's afternoon nap is missing: 12:30 -> 19:30 gap > 6h.
  const gappy = history(d => d % 2 ? [[9, 0, 60], [12, 30, 90]] : regular()).filter(s => !(new Date(s.startMs).getHours() === 12 && Math.floor((at(0, 0) - s.startMs) / 86400000) % 2 === 0));
  const { scenarios } = historicalScenarios([...gappy, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10))], now);
  for (const s of scenarios) assert.ok(s.ended === 'night' || s.ended === 'incomplete');
  const incomplete = scenarios.filter(s => s.ended === 'incomplete');
  assert.ok(incomplete.every(s => s.naps.every((n, i) => i === 0 || n.onsetOffsetMin - s.naps[i - 1].onsetOffsetMin <= FORECAST_RULES.maxWakeGapMinutes + 240)));
});

test('short and long naps keep their own duration evidence', () => {
  const short = run(today(history(() => [[9, 0, 60], [12, 30, 20], [15, 0, 20], [17, 0, 20]])), now).forecast;
  const long = run(today(history(() => [[9, 0, 60], [12, 30, 170], [17, 0, 30]])), now).forecast;
  assert.ok(short.predictedNaps[0].durationMinutes.typicalMin <= 25, JSON.stringify(short.predictedNaps[0]));
  assert.ok(long.predictedNaps[0].durationMinutes.typicalMin >= 150, JSON.stringify(long.predictedNaps[0]));
  for (const f of [short, long]) for (const n of f.predictedNaps) assert.ok(!n.durationMinutes || n.durationMinutes.typicalMin < FORECAST_RULES.nightMinutes);
});

test('conditional sequences: similar days with different morning naps lead to different continuations', () => {
  // Odd days: short morning nap, then a long midday nap. Even days: the reverse.
  const plan = d => d % 2 ? [[9, 0, 30], [11, 0, 100], [15, 0, 40]] : [[9, 0, 100], [13, 10, 30], [15, 40, 40]];
  const base = history(plan, { days: 16 });
  const afterShort = run([...base, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 9, 30))], at(0, 9, 45)).forecast;
  const afterLong = run([...base, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10, 40))], at(0, 10, 55)).forecast;
  const next = f => f.predictedNaps[0].durationMinutes?.typicalMin;
  assert.ok(next(afterShort) >= 80, JSON.stringify(afterShort));
  assert.ok(next(afterLong) <= 45, JSON.stringify(afterLong));
});

test('days with more naps than usual end the forecast sooner; fewer naps keep it open', () => {
  const sessions = history(regular);
  const more = run([...sessions, session(at(1, 19, 30), at(0, 7)), session(at(0, 8, 30), at(0, 9)), session(at(0, 10, 30), at(0, 11)), session(at(0, 12, 30), at(0, 13, 30))], at(0, 13, 45)).forecast;
  const fewer = run([...sessions, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10))], at(0, 10, 15)).forecast;
  assert.ok(more.predictedNaps.length <= fewer.predictedNaps.length);
});

test('a nap ending later than expected moves the whole remaining forecast later', () => {
  const base = history(regular);
  const early = run([...base, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10))], at(0, 10, 15)).forecast;
  const late = run([...base, session(at(1, 19, 30), at(0, 7)), session(at(0, 9), at(0, 10, 30))], at(0, 10, 45)).forecast;
  assert.ok(late.predictedNaps[0].onset.typicalMs > early.predictedNaps[0].onset.typicalMs);
  if (late.predictedNaps[1] && early.predictedNaps[1]) assert.ok(late.predictedNaps[1].onset.typicalMs >= early.predictedNaps[1].onset.typicalMs);
});

test('midnight and overnight: no night-time or bedtime events are fabricated', () => {
  const { sessions } = generate('newborn', { seed: 3 });
  for (const hour of [0, 2, 21, 23]) {
    const cp = at(0, hour, 30), visible = sessions.filter(s => s.endMs <= cp);
    const { forecast } = run(visible, cp, { ageDays: 42 });
    for (const n of forecast.predictedNaps.slice(1)) {
      const clock = new Date(n.onset.typicalMs).getHours() * 60 + new Date(n.onset.typicalMs).getMinutes();
      assert.ok(clock >= FORECAST_RULES.earliestNapOnsetClock && clock < FORECAST_RULES.latestNapOnsetClock, `${hour}: ${new Date(n.onset.typicalMs)}`);
    }
    assert.equal('bedtime' in forecast, false);
  }
});

test('DST day keeps real elapsed durations', () => {
  const base = new Date(2026, 9, 25); // autumn change in Europe/Oslo
  const sessions = [...history(regular, { base }), session(at(1, 19, 30, base), at(0, 7, 0, base)), session(at(0, 9, 0, base), at(0, 10, 0, base))];
  const { forecast } = run(sessions, at(0, 10, 15, base));
  for (const n of forecast.predictedNaps) if (n.wakeTime) assert.equal(n.wakeTime.typicalMs - n.onset.typicalMs, n.durationMinutes.typicalMin * minute);
  assert.ok(forecast.predictedNaps.length >= 1);
});

test('timezone change: the same local-clock rhythm yields the same local forecast', () => {
  const runIn = tz => execFileSync(process.execPath, [path.join(__dirname, 'helpers', 'forecast-in-tz.cjs')], { env: { ...process.env, TZ: tz } }).toString().trim();
  const oslo = runIn('Europe/Oslo');
  assert.ok(JSON.parse(oslo).some(day => day.length > 0));
  assert.equal(runIn('America/New_York'), oslo);
});

test('edits, deletes and realtime updates recompute from inputs with no cached state', () => {
  const sessions = today(), a = run(sessions, now).forecast;
  const edited = sessions.map(s => s.startMs === at(0, 9) ? session(at(0, 9), at(0, 9, 20)) : s);
  const b = run(edited, at(0, 10, 15)).forecast;
  assert.notDeepEqual(b.predictedNaps, a.predictedNaps);
  const deleted = run(sessions.filter(s => s.startMs !== at(0, 9)), now).forecast;
  assert.notDeepEqual(deleted.predictedNaps, a.predictedNaps);
  assert.deepEqual(run(sessions, now).forecast, a); // same input after other calls -> same output
});

test('baby switching: another baby\'s forecast never leaks into this one', () => {
  const mine = run(today(), now).forecast;
  run(today(history(() => [[8, 0, 120]])), now); // a different baby in between
  assert.deepEqual(run(today(), now).forecast, mine);
});

test('no past events, no overlap with recorded sleep, and uncertainty grows with horizon', () => {
  for (const profile of ['conditional', 'transition', 'newborn']) {
    const { sessions, dayPlans, profile: p } = generate(profile, { seed: 11 });
    for (const plan of dayPlans.slice(-6, -1)) for (const cp of [plan.wakeAt + 20 * minute, plan.wakeAt + 300 * minute]) {
      const visible = sessions.filter(s => s.endMs <= cp), { forecast } = run(visible, cp, { ageDays: p.ageDays });
      const lastEnd = Math.max(0, ...visible.map(s => s.endMs));
      forecast.predictedNaps.forEach((n, i) => {
        assert.ok(n.onset.earliestMs >= cp && n.onset.earliestMs >= lastEnd);
        assert.ok(n.onset.earliestMs <= n.onset.typicalMs && n.onset.typicalMs <= n.onset.latestMs);
        if (i > 0) {
          const prev = forecast.predictedNaps[i - 1];
          assert.ok(n.onset.latestMs - n.onset.earliestMs >= prev.onset.latestMs - prev.onset.earliestMs, 'interval width must not shrink');
          assert.ok({ low: 0, medium: 1, high: 2 }[n.quality] <= { low: 0, medium: 1, high: 2 }[prev.quality], 'quality must not rise');
        }
      });
    }
  }
});

test('highly irregular (newborn) history is conservative', () => {
  const { sessions, dayPlans } = generate('newborn', { seed: 5 });
  let later = 0, total = 0;
  for (const plan of dayPlans.slice(-8, -1)) {
    const cp = plan.wakeAt + 120 * minute, { forecast } = run(sessions.filter(s => s.endMs <= cp), cp, { ageDays: 42 });
    total++; later += Math.max(0, forecast.predictedNaps.length - 1);
    for (const n of forecast.predictedNaps.slice(1)) assert.equal(n.quality, 'low');
  }
  assert.ok(later <= total * 2);
});

test('rolling-origin backtest: no leakage and the report is produced for every profile', () => {
  const report = runBacktest({ seeds: [1, 2], evalDays: 6 });
  for (const [profile, r] of Object.entries(report)) {
    assert.equal(r.leaks, 0, profile);
    assert.ok(r.model.nsReady > 0, profile);
  }
});

const { buildSleepWaveModel, recordedDisplaySegments } = load('src/analytics/sleepWaveModel.ts');
test('Sleep Wave keeps actual and predicted apart: recorded geometry and 12 px display unchanged', () => {
  const sessions = today(), { nextSleep, forecast } = run(sessions, now);
  const plain = buildSleepWaveModel({ sessions, active: null, prediction: nextSleep, now });
  const withForecast = buildSleepWaveModel({ sessions, active: null, prediction: nextSleep, now, forecast });
  assert.ok(withForecast.predicted.length >= 2);
  // Same axis: positions of recorded sleep may only rescale with the domain, never move relative to time.
  const at = (m, ms) => (ms - m.domain.startMs) / (m.domain.endMs - m.domain.startMs);
  for (const [i, r] of withForecast.recorded.entries()) { assert.equal(r.startMs, plain.recorded[i].startMs); assert.equal(r.endMs, plain.recorded[i].endMs); assert.ok(Math.abs(r.start - at(withForecast, r.startMs)) < 1e-12); }
  const display = recordedDisplaySegments(withForecast.recorded, 320, []);
  for (const d of display) assert.ok((d.end - d.start) * 320 >= 12 - 1e-9);
  // Predicted events are after now and do not overlap recorded sleep.
  for (const p of withForecast.predicted) { assert.ok(p.onset.startMs >= now); for (const r of withForecast.recorded) assert.ok(p.onset.startMs >= r.endMs); }
});

test('forecast events are dropped (not shifted) when past, unordered, or without a next window', () => {
  const sessions = today(), { nextSleep, forecast } = run(sessions, now);
  const past = { ...forecast, predictedNaps: forecast.predictedNaps.map((n, i) => i === 1 ? { ...n, onset: { earliestMs: now - 60 * minute, typicalMs: now - 30 * minute, latestMs: now } } : n) };
  const m = buildSleepWaveModel({ sessions, active: null, prediction: nextSleep, now, forecast: past });
  assert.ok(m.predicted.every(p => p.onset.startMs >= now));
  const sleeping = buildSleepWaveModel({ sessions, active: { id: 'a', startMs: at(0, 10, 10) }, prediction: { status: 'sleeping', sampleSize: 0 }, now, forecast });
  assert.equal(sleeping.predicted.length, 0);
  const learning = buildSleepWaveModel({ sessions, active: null, prediction: { status: 'insufficient_data', sampleSize: 0 }, now, forecast });
  assert.equal(learning.predicted.length, 0);
});
