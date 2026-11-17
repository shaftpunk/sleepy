const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
process.env.TZ = 'Europe/Oslo';
function loader() { const cache = new Map(); function load(file) { if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports); vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Intl, require: name => load(path.join(path.dirname(file), name) + '.ts') }); return exports; } return load; }
const load = loader();
const { calculateUpcomingDayForecast: upcoming, nightContext, calculateDailySleepForecast, FORECAST_RULES } = load('src/analytics/dailySleepForecast.ts');
const { calculateNextSleep } = load('src/analytics/nextSleep.ts');
const { buildUpcomingDayWaveModel } = load('src/analytics/sleepWaveModel.ts');
const { generate } = require('./helpers/synthetic-sleep.cjs');
const { runUpcomingBacktest } = require('./upcoming-day-backtest.cjs');
const minute = 60000;
const session = (startMs, endMs) => ({ id: `${startMs}-${endMs}`, startMs, endMs, durationMin: (endMs - startMs) / minute, rate: null, note: null, sleepTypeRaw: 'sleep' });
const clockOf = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const key = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Last generated day is the "target"; its night starts at the previous day's bedtime.
function scene(profile = 'conditional', seed = 4) {
  const { sessions, dayPlans, profile: p } = generate(profile, { seed });
  const target = dayPlans[dayPlans.length - 1], previous = dayPlans[dayPlans.length - 2];
  const atTarget = (h, m) => { const d = new Date(target.date); d.setHours(h, m, 0, 0); return d.getTime(); };
  const before = sessions.filter(s => s.startMs < previous.bedtime - minute); // history up to tonight's bedtime
  return { sessions, before, target, previous, p, atTarget };
}
const night = s => ({ id: 'night', startMs: s.previous.bedtime });

function assertSane(f, now) {
  assert.ok(f.morningWake.earliestMs >= now && f.morningWake.earliestMs <= f.morningWake.typicalMs && f.morningWake.typicalMs <= f.morningWake.latestMs);
  let previousEnd = f.morningWake.typicalMs, previousWidth = f.morningWake.latestMs - f.morningWake.earliestMs;
  for (const n of f.predictedNaps) {
    assert.ok(n.onset.earliestMs >= now && n.onset.typicalMs > previousEnd);
    const c = clockOf(n.onset.typicalMs); assert.ok(c >= FORECAST_RULES.earliestNapOnsetClock && c < FORECAST_RULES.latestNapOnsetClock);
    assert.ok(n.onset.latestMs - n.onset.earliestMs >= previousWidth - 5 * minute, 'uncertainty does not shrink');
    assert.notEqual(n.quality, 'high'); assert.equal(n.isNext, false);
    if (n.durationMinutes) assert.ok(n.durationMinutes.typicalMin < FORECAST_RULES.nightMinutes);
    previousEnd = n.wakeTime?.typicalMs ?? n.onset.typicalMs; previousWidth = n.onset.latestMs - n.onset.earliestMs;
  }
}

test('01:32 while sleeping: preliminary forecast for the coming (current calendar) day', () => {
  const s = scene(), now = s.atTarget(1, 32), f = upcoming({ sessions: s.before, active: night(s), now, ageDays: s.p.ageDays });
  assert.equal(f.status, 'ready'); assert.equal(f.targetDay, key(s.target.date));
  assert.ok(f.predictedNaps.length >= 1); assertSane(f, now);
  // The daytime engine still abstains while asleep (unchanged behaviour).
  assert.equal(calculateDailySleepForecast({ sessions: s.before, active: night(s), now, nextSleep: { status: 'sleeping', sampleSize: 0 } }).status, 'sleeping');
});

test('01:32 while awake at night: Next Sleep is untouched and the daytime forecast is separate', () => {
  const s = scene(), now = s.atTarget(1, 32), woke = s.atTarget(1, 10);
  const sessions = [...s.before, session(s.previous.bedtime, woke)];
  assert.equal(nightContext(sessions, null, now).night, true);
  const f = upcoming({ sessions, active: null, now, ageDays: s.p.ageDays });
  assert.equal(f.status, 'ready'); assertSane(f, now);
  const ns = calculateNextSleep({ sessions, active: null, now, ageDays: s.p.ageDays });
  assert.equal(JSON.stringify(calculateNextSleep({ sessions, active: null, now, ageDays: s.p.ageDays })), JSON.stringify(ns));
  // No nap is placed in the night: every preliminary event is on the daytime of the target day.
  for (const n of f.predictedNaps) assert.equal(key(n.onset.typicalMs), f.targetDay);
});

test('23:30 before midnight targets tomorrow with an explicit date', () => {
  const s = scene(), bed = new Date(s.previous.bedtime), now = new Date(bed); now.setHours(23, 30, 0, 0);
  const f = upcoming({ sessions: s.before, active: night(s), now: now.getTime(), ageDays: s.p.ageDays });
  assert.equal(f.targetDay, key(s.target.date)); assert.notEqual(f.targetDay, key(now.getTime()));
  assert.equal(f.status, 'ready'); assertSane(f, now.getTime());
  const model = buildUpcomingDayWaveModel(f);
  assert.equal(key(model.domain.startMs + 60 * minute), f.targetDay, 'own axis on the target day');
  assert.ok(model.ticks.every(t => key(t.instant) === f.targetDay));
});

test('morning wake-up hands over to the daytime forecast, which uses the actual wake time', () => {
  const s = scene(), wake = s.target.wakeAt, sessions = [...s.before, session(s.previous.bedtime, wake)];
  const after = wake + 45 * minute;
  assert.equal(upcoming({ sessions, active: null, now: after, ageDays: s.p.ageDays }).status, 'not_applicable');
  const ns = calculateNextSleep({ sessions, active: null, now: after, ageDays: s.p.ageDays });
  const daily = calculateDailySleepForecast({ sessions, active: null, now: after, nextSleep: ns, ageDays: s.p.ageDays });
  assert.ok(['ready', 'partial'].includes(daily.status));
  assert.ok(ns.earliestStart >= wake, 'anchored on the recorded wake-up');
});

test('transition sequence across the night and morning', () => {
  const s = scene(), states = [];
  for (const [label, now, active, sessions] of [
    ['21:00 asleep', s.previous.bedtime + 60 * minute, night(s), s.before],
    ['03:00 asleep', s.atTarget(3, 0), night(s), s.before],
    ['05:50 asleep', s.atTarget(5, 50), night(s), s.before],
    ['after wake', s.target.wakeAt + 10 * minute, null, [...s.before, session(s.previous.bedtime, s.target.wakeAt)]],
  ]) states.push([label, upcoming({ sessions, active, now, ageDays: s.p.ageDays })]);
  assert.deepEqual(states.map(([l, f]) => [l, f.status === 'not_applicable' ? 'day' : 'night']), [['21:00 asleep', 'night'], ['03:00 asleep', 'night'], ['05:50 asleep', 'night'], ['after wake', 'day']]);
  // Later in the night, scenarios that had already woken by now are excluded: the wake window narrows from below.
  const at3 = states[1][1], at550 = states[2][1];
  if (at550.status === 'ready') assert.ok(at550.morningWake.earliestMs >= at3.morningWake.earliestMs);
});

test('awake before 06:00 after a full night counts as the morning, not night', () => {
  const s = scene(), early = s.atTarget(4, 50), sessions = [...s.before, session(s.previous.bedtime, early)];
  assert.equal(nightContext(sessions, null, s.atTarget(5, 10)).night, false);
});

test('overnight split by a short waking stays one night; tonight is never used as history', () => {
  const s = scene(), now = s.atTarget(2, 0);
  const split = [...s.before, session(s.previous.bedtime, s.atTarget(0, 40)), session(s.atTarget(0, 55), s.atTarget(1, 50))];
  const f = upcoming({ sessions: split, active: null, now, ageDays: s.p.ageDays });
  assert.ok(['ready', 'insufficient_data'].includes(f.status));
  assert.equal(f.status, 'ready', JSON.stringify(f.diagnostics)); assertSane(f, now);
});

test('DST night keeps local clock times and real durations', () => {
  const { sessions, profile } = generate('conditional', { seed: 9, endDate: new Date(2026, 9, 25), days: 30 });
  const lastBed = Math.max(...sessions.filter(s => s.durationMin >= 180).map(s => s.startMs));
  const cutoff = new Date(2026, 9, 25, 1, 30).getTime();
  const before = sessions.filter(s => s.startMs < lastBed - minute && s.endMs <= cutoff);
  const f = upcoming({ sessions: before, active: { id: 'n', startMs: lastBed }, now: cutoff, ageDays: profile.ageDays });
  assert.equal(f.targetDay, '2026-10-25');
  assert.equal(f.status, 'ready', JSON.stringify(f.diagnostics));
  for (const n of f.predictedNaps) if (n.wakeTime) assert.equal(n.wakeTime.typicalMs - n.onset.typicalMs, n.durationMinutes.typicalMin * minute);
});

test('sparse history shows the learning state, not a guess', () => {
  const s = scene(), recent = s.before.filter(x => x.startMs > s.previous.bedtime - 4 * 86400000);
  const f = upcoming({ sessions: recent, active: night(s), now: s.atTarget(1, 32), ageDays: s.p.ageDays });
  assert.equal(f.status, 'insufficient_data'); assert.equal(f.predictedNaps.length, 0); assert.equal(f.morningWake, null);
  assert.equal(buildUpcomingDayWaveModel(f), null);
});

test('irregular newborn: conservative, low quality, still never at night', () => {
  const { sessions, dayPlans, profile } = generate('newborn', { seed: 6 });
  for (const plan of dayPlans.slice(-6)) {
    const now = new Date(plan.date); now.setHours(1, 30, 0, 0);
    const f = upcoming({ sessions: sessions.filter(x => x.endMs <= now.getTime()), active: null, now: now.getTime(), ageDays: profile.ageDays });
    for (const n of f.predictedNaps) { assert.equal(n.quality, 'low'); const c = clockOf(n.onset.typicalMs); assert.ok(c >= 360 && c < 1200); }
  }
});

test('no future information: sessions after now cannot change the forecast; baby switching is pure', () => {
  const s = scene(), now = s.atTarget(1, 32), base = upcoming({ sessions: s.before, active: night(s), now, ageDays: s.p.ageDays });
  const withFuture = upcoming({ sessions: s.sessions, active: night(s), now, ageDays: s.p.ageDays });
  assert.equal(JSON.stringify(withFuture), JSON.stringify(base));
  upcoming({ sessions: scene('transition', 2).before, active: null, now, ageDays: 270 });
  assert.equal(JSON.stringify(upcoming({ sessions: s.before, active: night(s), now, ageDays: s.p.ageDays })), JSON.stringify(base));
});

test('daytime is unaffected: no preliminary forecast while it is day', () => {
  const s = scene();
  for (const [h, m] of [[9, 0], [13, 30], [19, 30]]) assert.equal(upcoming({ sessions: s.before, active: null, now: s.atTarget(h, m), ageDays: s.p.ageDays }).status, 'not_applicable');
  // A daytime nap in progress is not a night.
  assert.equal(nightContext(s.before, { id: 'nap', startMs: s.atTarget(12, 30) }, s.atTarget(13, 0)).night, false);
});

test('night backtest: no leakage into the past', () => {
  const report = runUpcomingBacktest({ seeds: [1, 2], evalDays: 6 });
  for (const [profile, r] of Object.entries(report)) { assert.equal(r.leaks, 0, profile); assert.ok(r.m.n > 0); }
});

test('perfectly regular history: valid forecast with honest minimum-width windows, no evening nap', () => {
  const now = new Date(2026, 10, 16, 1, 32).getTime();
  const at = (d, h, m = 0) => { const x = new Date(now); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.getTime(); };
  const sessions = [];
  for (let d = 12; d >= 1; d--) sessions.push(session(at(d + 1, 22), at(d, 6)), session(at(d, 9, 15), at(d, 10, 5)), session(at(d, 12, 55), at(d, 13, 35)), session(at(d, 16, 10), at(d, 16, 50)), session(at(d, 20), at(d, 21)));
  const f = upcoming({ sessions, active: { id: 'a', startMs: now - 42 * minute }, now, ageDays: 180 });
  assert.equal(f.status, 'ready', JSON.stringify(f.diagnostics));
  assert.ok(f.morningWake.latestMs - f.morningWake.earliestMs >= 30 * minute);
  assert.equal(JSON.stringify(f.predictedNaps.map(n => clockOf(n.onset.typicalMs))), JSON.stringify([9 * 60 + 15, 12 * 60 + 55, 16 * 60 + 10]));
  assert.equal(f.diagnostics.stopReason, 'evening');
});
