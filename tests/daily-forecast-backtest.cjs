/* Rolling-origin backtest of the daily sleep forecast on SYNTHETIC histories
   (tests/helpers/synthetic-sleep.cjs). For each evaluation day and checkpoint,
   only sessions that had ended by the checkpoint are visible; the forecast is
   compared with naps recorded afterwards that day. Baseline: the additive
   "median nap + median wake window" schedule starting from the same Next Sleep
   onset. Run directly for a report: node tests/daily-forecast-backtest.cjs */
process.env.TZ = 'Europe/Oslo';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { generate, MINUTE } = require('./helpers/synthetic-sleep.cjs');

function loader() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, Date, Intl, require: name => load(path.join(path.dirname(file), name) + '.ts') });
    return exports;
  }
  return load;
}
const root = path.resolve(__dirname, '..'), load = loader();
const { calculateNextSleep } = load(path.join(root, 'src/analytics/nextSleep.ts'));
const { calculateDailySleepForecast, historicalScenarios } = load(path.join(root, 'src/analytics/dailySleepForecast.ts'));
const { recordedIntervals } = load(path.join(root, 'src/analytics/sleepProbability.ts'));

const NIGHT = 180;
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const pct = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const clock = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

function baseline(history, now, first, ageDays) {
  const intervals = recordedIntervals(history, now).filter(i => i.endMs > now - 21 * 86400000 && new Date(i.endMs).toDateString() !== new Date(now).toDateString());
  const naps = intervals.filter(i => (i.endMs - i.startMs) / MINUTE < NIGHT);
  const durations = naps.map(i => (i.endMs - i.startMs) / MINUTE);
  const windows = [], lastOnsets = new Map();
  for (let i = 1; i < intervals.length; i++) {
    const a = intervals[i - 1], b = intervals[i], gap = (b.startMs - a.endMs) / MINUTE;
    if ((a.endMs - a.startMs) / MINUTE < NIGHT && (b.endMs - b.startMs) / MINUTE < NIGHT && gap <= 360) windows.push(gap);
  }
  for (const n of naps) lastOnsets.set(new Date(n.startMs).toDateString(), clock(n.startMs));
  if (durations.length < 6 || windows.length < 6) return [first];
  const [lo, hi] = ageDays < 90 ? [0.1, 0.9] : [0.2, 0.8];
  const cutoff = median([...lastOnsets.values()]);
  const out = [{ ...first, durationMinutes: { lowMin: pct(durations, lo), typicalMin: median(durations), highMin: pct(durations, hi) } }];
  for (let k = 2; k <= 4; k++) {
    const typical = out[k - 2].onset.typicalMs + (median(durations) + median(windows)) * MINUTE;
    if (clock(typical) > cutoff) break;
    out.push({ sequenceIndex: k, onset: { typicalMs: typical,
      earliestMs: out[k - 2].onset.earliestMs + (pct(durations, lo) + pct(windows, lo)) * MINUTE,
      latestMs: out[k - 2].onset.latestMs + (pct(durations, hi) + pct(windows, hi)) * MINUTE },
      durationMinutes: { lowMin: pct(durations, lo), typicalMin: median(durations), highMin: pct(durations, hi) } });
  }
  return out;
}

function emptyStats() { return { scenarioFirst: [], checkpoints: 0, nsReady: 0, n1: [], n1Cover: [], dur: [], durCover: [], later: [], laterCover: [], laterPredicted: 0, laterFalse: 0, laterMissed: 0, laterOpportunities: 0, countClaims: 0, countExact: 0, byHorizon: {} }; }

function score(stats, predicted, actual) {
  const p1 = predicted[0], a1 = actual[0];
  if (a1) { stats.n1.push(Math.abs(p1.onset.typicalMs - a1.startMs) / MINUTE); stats.n1Cover.push(a1.startMs >= p1.onset.earliestMs && a1.startMs <= p1.onset.latestMs); }
  predicted.forEach((p, i) => {
    const a = actual[i];
    if (a && p.durationMinutes) { const d = (a.endMs - a.startMs) / MINUTE; stats.dur.push(Math.abs(p.durationMinutes.typicalMin - d)); stats.durCover.push(d >= p.durationMinutes.lowMin && d <= p.durationMinutes.highMin); }
    if (i === 0) return;
    stats.laterPredicted++;
    if (!a) { stats.laterFalse++; return; }
    const err = Math.abs(p.onset.typicalMs - a.startMs) / MINUTE, covered = a.startMs >= p.onset.earliestMs && a.startMs <= p.onset.latestMs;
    stats.later.push(err); stats.laterCover.push(covered);
    (stats.byHorizon[i + 1] ??= { err: [], cover: [], width: [] }).err.push(err);
    stats.byHorizon[i + 1].cover.push(covered); stats.byHorizon[i + 1].width.push((p.onset.latestMs - p.onset.earliestMs) / MINUTE);
  });
  if (actual.length >= 2) { stats.laterOpportunities++; if (predicted.length < 2) stats.laterMissed++; }
}

function runBacktest({ profiles = ['conditional', 'transition', 'newborn'], seeds = [1, 2, 3, 4, 5], evalDays = 12 } = {}) {
  const report = {};
  for (const profile of profiles) {
    const model = emptyStats(), base = emptyStats(); let leaks = 0, stopReasons = {};
    for (const seed of seeds) {
      const { sessions, dayPlans, profile: p } = generate(profile, { seed });
      for (const plan of dayPlans.slice(-evalDays - 1, -1)) {
        const logged = sessions.filter(s => s.startMs >= plan.wakeAt && s.startMs < plan.bedtime && s.durationMin < NIGHT);
        const checkpoints = [plan.wakeAt + 20 * MINUTE, ...logged.map(s => s.endMs + 10 * MINUTE)];
        for (const cp of checkpoints) {
          const history = sessions.filter(s => s.endMs <= cp);
          const actual = logged.filter(s => s.startMs > cp);
          const nextSleep = calculateNextSleep({ sessions: history, active: null, now: cp, ageDays: p.ageDays });
          model.checkpoints++; base.checkpoints++;
          if (nextSleep.status !== 'ready') continue;
          model.nsReady++; base.nsReady++;
          const forecast = calculateDailySleepForecast({ sessions: history, active: null, now: cp, nextSleep, ageDays: p.ageDays });
          if (forecast.predictedNaps.some(n => n.onset.earliestMs < cp)) leaks++;
          stopReasons[forecast.diagnostics.stopReason] = (stopReasons[forecast.diagnostics.stopReason] ?? 0) + 1;
          score(model, forecast.predictedNaps, actual);
          // Diagnostic only (Next Sleep stays authoritative): weighted median of
          // the matched scenarios' first onset, vs what actually happened.
          const { scenarios, last } = historicalScenarios(history, cp), firsts = scenarios.filter(s => s.naps.length).map(s => ({ v: s.naps[0].onsetOffsetMin, w: s.weight })).sort((a, b) => a.v - b.v);
          if (firsts.length >= 4 && actual[0]) { const half = firsts.reduce((a, x) => a + x.w, 0) / 2; let acc = 0; const m = firsts.find(x => (acc += x.w) >= half).v; model.scenarioFirst.push(Math.abs(last.endMs + m * MINUTE - actual[0].startMs) / MINUTE); }
          if (forecast.diagnostics.stopReason === 'night-likely') { model.countClaims++; if (forecast.predictedNaps.length === actual.length) model.countExact++; }
          const b = baseline(history, cp, forecast.predictedNaps[0], p.ageDays);
          score(base, b, actual); base.countClaims++; if (b.length === actual.length) base.countExact++;
        }
      }
    }
    report[profile] = { model, base, leaks, stopReasons };
  }
  return report;
}

const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
const share = a => a.length ? a.filter(Boolean).length / a.length : NaN;
const f = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '—';
const fp = v => Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—';

function summarize(report) {
  const rows = [];
  for (const [profile, { model, base, leaks, stopReasons }] of Object.entries(report)) {
    rows.push(`\n## ${profile}  (checkpoints ${model.checkpoints}, Next Sleep ready ${model.nsReady}, leaks ${leaks})`);
    rows.push(`stop reasons: ${JSON.stringify(stopReasons)}`);
    rows.push('metric | conditional model | baseline');
    rows.push(`next-nap onset MAE (shared Next Sleep) | ${f(mean(model.n1))} min, cover ${fp(share(model.n1Cover))} | same`);
    rows.push(`  diagnostic: scenario-median next onset MAE | ${f(mean(model.scenarioFirst))} min (n=${model.scenarioFirst.length}) | (Next Sleep ${f(mean(model.n1))} min)`);
    rows.push(`nap duration MAE / interval cover | ${f(mean(model.dur))} min (n=${model.dur.length}) / ${fp(share(model.durCover))} | ${f(mean(base.dur))} min (n=${base.dur.length}) / ${fp(share(base.durCover))}`);
    rows.push(`later-nap onset MAE | ${f(mean(model.later))} min (n=${model.later.length}) | ${f(mean(base.later))} min (n=${base.later.length})`);
    rows.push(`later-nap onset interval cover | ${fp(share(model.laterCover))} | ${fp(share(base.laterCover))}`);
    rows.push(`later naps predicted that did not occur | ${model.laterFalse}/${model.laterPredicted} | ${base.laterFalse}/${base.laterPredicted}`);
    rows.push(`abstained when ≥1 later nap occurred | ${model.laterMissed}/${model.laterOpportunities} | ${base.laterMissed}/${base.laterOpportunities}`);
    rows.push(`remaining nap count exact (claims) | ${model.countExact}/${model.countClaims} | ${base.countExact}/${base.countClaims}`);
    for (const k of Object.keys({ ...model.byHorizon, ...base.byHorizon }).sort()) {
      const m = model.byHorizon[k], b = base.byHorizon[k];
      rows.push(`  horizon nap ${k}: MAE ${f(mean(m?.err ?? []))} / ${f(mean(b?.err ?? []))} min, cover ${fp(share(m?.cover ?? []))} / ${fp(share(b?.cover ?? []))}, width ${f(mean(m?.width ?? []))} / ${f(mean(b?.width ?? []))} min`);
    }
  }
  return rows.join('\n');
}

module.exports = { runBacktest, summarize };
if (require.main === module) console.log(summarize(runBacktest()));

// Active checkpoints reveal only the start of the ongoing nap, never its end.
function runActiveBacktest({ seeds=[1,2,3,4,5], evalDays=12 }={}) {
 const report={};
 for(const profile of ['conditional','transition','newborn']){
  let checkpoints=0,forecasted=0,events=0,covered=0,error=0,matched=0,falseEvents=0,leaks=0;
  for(const seed of seeds){const {sessions,dayPlans,profile:p}=generate(profile,{seed});
   for(const plan of dayPlans.slice(-evalDays-1,-1)){
    const naps=sessions.filter(s=>s.startMs>=plan.wakeAt&&s.startMs<plan.bedtime&&s.durationMin<NIGHT);
    for(const activeNap of naps)for(const elapsed of [10,30,60,120]){
     const now=activeNap.startMs+elapsed*MINUTE;if(now>=activeNap.endMs)continue;
     checkpoints++;const history=sessions.filter(s=>s.endMs<=now),active={id:activeNap.id,startMs:activeNap.startMs};
     const nextSleep=calculateNextSleep({sessions:history,active,now,ageDays:p.ageDays});
     const f=calculateDailySleepForecast({sessions:history,active,now,nextSleep,ageDays:p.ageDays});
     if(f.predictedNaps.length)forecasted++;
     const actual=naps.filter(s=>s.startMs>now);
     f.predictedNaps.forEach((n,i)=>{events++;if(n.onset.earliestMs<now)leaks++;if(!actual[i]){falseEvents++;return;}matched++;error+=Math.abs(n.onset.typicalMs-actual[i].startMs)/MINUTE;if(actual[i].startMs>=n.onset.earliestMs&&actual[i].startMs<=n.onset.latestMs)covered++;});
    }
   }
  }
  report[profile]={checkpoints,forecasted,events,matched,falseEvents,leaks,maeMinutes:matched?error/matched:null,coverage:matched?covered/matched:null};
 }
 return report;
}
module.exports.runActiveBacktest=runActiveBacktest;
if(require.main===module)console.log(JSON.stringify({active:runActiveBacktest()},null,2));
