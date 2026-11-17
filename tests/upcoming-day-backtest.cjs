/* Rolling-origin backtest of the preliminary upcoming-day forecast on SYNTHETIC
   histories. Checkpoint: 01:30 local during the night sleep (active, start
   known, end unknown); only sessions ended by then are visible. Compared with
   the morning wake and naps recorded later that day. Baseline: median morning
   wake + repeated (median nap + median wake window).
   Run: node tests/upcoming-day-backtest.cjs */
process.env.TZ = 'Europe/Oslo';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { generate, MINUTE } = require('./helpers/synthetic-sleep.cjs');
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Intl, require: name => load(path.join(path.dirname(file), name) + '.ts') });
  return exports;
}
const { calculateUpcomingDayForecast } = load(path.join(root, 'src/analytics/dailySleepForecast.ts'));
const NIGHT = 180;
const median = v => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const pct = (v, q) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

function baseline(plans, ageDays, targetStart) {
  const wakes = plans.map(p => (p.wakeAt - p.date) / MINUTE), naps = plans.flatMap(p => p.loggedNaps.map(n => (n.endMs - n.startMs) / MINUTE));
  const windows = plans.flatMap(p => p.loggedNaps.slice(1).map((n, i) => (n.startMs - p.loggedNaps[i].endMs) / MINUTE).filter(g => g <= 360));
  const first = plans.flatMap(p => p.loggedNaps.length ? [(p.loggedNaps[0].startMs - p.wakeAt) / MINUTE] : []);
  const lastOnset = median(plans.flatMap(p => p.loggedNaps.length ? [(p.loggedNaps.at(-1).startMs - p.date) / MINUTE] : []));
  const [lo, hi] = ageDays < 90 ? [0.1, 0.9] : [0.2, 0.8], out = [];
  let typical = targetStart + (median(wakes) + median(first)) * MINUTE, early = targetStart + (pct(wakes, lo) + pct(first, lo)) * MINUTE, late = targetStart + (pct(wakes, hi) + pct(first, hi)) * MINUTE;
  for (let k = 1; k <= 4 && (typical - targetStart) / MINUTE <= lastOnset; k++) {
    out.push({ onset: { earliestMs: early, typicalMs: typical, latestMs: late } });
    typical += (median(naps) + median(windows)) * MINUTE; early += (pct(naps, lo) + pct(windows, lo)) * MINUTE; late += (pct(naps, hi) + pct(windows, hi)) * MINUTE;
  }
  return { wake: { earliestMs: targetStart + pct(wakes, lo) * MINUTE, typicalMs: targetStart + median(wakes) * MINUTE, latestMs: targetStart + pct(wakes, hi) * MINUTE }, naps: out };
}

function runUpcomingBacktest({ profiles = ['conditional', 'transition', 'newborn'], seeds = [1, 2, 3, 4, 5], evalDays = 12 } = {}) {
  const report = {};
  for (const profile of profiles) {
    const s = { m: { wakeErr: [], wakeCover: [], err: [], cover: [], falseNaps: 0, predicted: 0, ready: 0, n: 0, countExact: 0 }, b: { wakeErr: [], wakeCover: [], err: [], cover: [], falseNaps: 0, predicted: 0, countExact: 0 }, leaks: 0 };
    for (const seed of seeds) {
      const { sessions, dayPlans, profile: p } = generate(profile, { seed });
      for (let i = dayPlans.length - evalDays - 1; i < dayPlans.length; i++) {
        const target = dayPlans[i], previous = dayPlans[i - 1];
        const cp = new Date(target.date); cp.setHours(1, 30, 0, 0);
        const now = cp.getTime(); if (previous.bedtime >= now) continue;
        const visible = sessions.filter(x => x.endMs <= now && x.startMs < previous.bedtime - MINUTE);
        const actualNaps = sessions.filter(x => x.startMs >= target.wakeAt && x.startMs < target.bedtime && x.durationMin < NIGHT);
        const f = calculateUpcomingDayForecast({ sessions: visible, active: p.fragmentedNight ? null : { id: 'night', startMs: previous.bedtime }, now, ageDays: p.ageDays });
        s.m.n++;
        if ([f.morningWake, ...f.predictedNaps.map(n => n.onset)].some(x => x && x.earliestMs < now)) s.leaks++;
        const history = dayPlans.slice(Math.max(0, i - 21), i).map(d => ({ ...d, loggedNaps: sessions.filter(x => x.startMs >= d.wakeAt && x.startMs < d.bedtime && x.durationMin < NIGHT) }));
        const b = baseline(history, p.ageDays, target.date);
        const score = (stats, wake, naps) => {
          if (wake) { stats.wakeErr.push(Math.abs(wake.typicalMs - target.wakeAt) / MINUTE); stats.wakeCover.push(target.wakeAt >= wake.earliestMs && target.wakeAt <= wake.latestMs); }
          naps.forEach((n, k) => { stats.predicted++; const a = actualNaps[k]; if (!a) { stats.falseNaps++; return; }
            stats.err.push(Math.abs(n.onset.typicalMs - a.startMs) / MINUTE); stats.cover.push(a.startMs >= n.onset.earliestMs && a.startMs <= n.onset.latestMs); });
          if (naps.length === actualNaps.length) stats.countExact++;
        };
        if (f.status === 'ready') { s.m.ready++; score(s.m, f.morningWake, f.predictedNaps); score(s.b, b.wake, b.naps); }
      }
    }
    report[profile] = s;
  }
  return report;
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN, share = a => a.length ? a.filter(Boolean).length / a.length : NaN;
const f0 = v => Number.isFinite(v) ? v.toFixed(0) : '—', fp = v => Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—';
function summarizeUpcoming(report) {
  return Object.entries(report).map(([profile, { m, b, leaks }]) => [
    `\n## ${profile} (01:30 checkpoints ${m.n}, ready ${m.ready}, leaks ${leaks})`,
    'metric | preliminary model | baseline (same checkpoints)',
    `morning wake MAE / cover | ${f0(mean(m.wakeErr))} min / ${fp(share(m.wakeCover))} | ${f0(mean(b.wakeErr))} min / ${fp(share(b.wakeCover))}`,
    `nap onset MAE / cover | ${f0(mean(m.err))} min (n=${m.err.length}) / ${fp(share(m.cover))} | ${f0(mean(b.err))} min (n=${b.err.length}) / ${fp(share(b.cover))}`,
    `predicted naps that did not occur | ${m.falseNaps}/${m.predicted} | ${b.falseNaps}/${b.predicted}`,
    `nap count exact | ${m.countExact}/${m.ready} | ${b.countExact}/${m.ready}`].join('\n')).join('\n');
}
module.exports = { runUpcomingBacktest, summarizeUpcoming };
if (require.main === module) console.log(summarizeUpcoming(runUpcomingBacktest()));
