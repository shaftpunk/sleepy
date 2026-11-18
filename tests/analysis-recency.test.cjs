const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
process.env.TZ = 'Europe/Oslo';
const cache = new Map();
let uiLanguage = 'en';
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, require: name => {
    if (name === '../../i18n') return { useTranslation: () => ({ lang: uiLanguage, t: (key, params = {}) => {
      const strings = load(`src/i18n/${uiLanguage}.ts`).default;
      return key.split('.').reduce((value, part) => value[part], strings).replace(/\{\{(\w+)\}\}/g, (_, k) => params[k]);
    } }) };
    if (!name.startsWith('.')) return require(name);
    const target = path.join(path.dirname(file), name);
    return load(fs.existsSync(target + '.ts') ? target + '.ts' : fs.existsSync(target + '.tsx') ? target + '.tsx' : path.join(target, 'index.ts'));
  } });
  return exports;
}
const stats = load('src/analytics/weightedStats.ts');
const history = load('src/analytics/sleepHistory.ts');
const { computePersonalSleepProfile: profile, recentSleepEvidence } = load('src/analytics/recentSleepProfile.ts');
const overview = load('src/analytics/overview.ts');
const day = load('src/analytics/day.ts');
const insight = load('src/analytics/insights.ts');
const feed = load('src/analytics/feed.ts');
const now = new Date(2026, 10, 17, 12).getTime();
const minute = 60000;
function at(age, hour, min = 0, anchor = now) {
  const d = new Date(anchor);
  d.setDate(d.getDate() - age);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
}
function sleep(age, hour, duration, type = 'nap', min = 0, anchor = now) {
  const startMs = at(age, hour, min, anchor);
  return { id: `${startMs}-${duration}`, startMs, endMs: startMs + duration * minute,
    durationMin: duration, sleepTypeRaw: type, rate: 4, note: null };
}
const range = (n, from = 1) => Array.from({ length: n }, (_, i) => i + from);
// Two independent intervals spanning >12h; no manufactured awake intervals.
const loggedDay = (age, nap = 40, anchor = now) => [sleep(age, 1, 60, 'night', 0, anchor), sleep(age, 14, nap, 'nap', 0, anchor)];

test('shared recency table includes day 30 and excludes today, invalid ages and older days', () => {
  for (const [age, weight] of [[1, 1], [7, 1], [8, .75], [14, .75], [15, .5], [21, .5], [22, .25], [30, .25], [31, 0], [0, 0], [-1, 0], [1.5, 0], [NaN, 0]]) {
    assert.equal(history.getRecencyWeight(age), weight);
  }
  assert.equal(history.recencyWeightAt(at(30, 0), now), .25);
  assert.equal(history.recencyWeightAt(at(31, 23, 59), now), 0);
  assert.equal(history.recencyWeightAt(at(0, 0), now), 0);
});

test('weighted quantiles, mean and categorical mass handle empty, invalid and tied observations', () => {
  assert.equal(stats.weightedMedian([]), null);
  assert.equal(stats.weightedMean([{ value: NaN, weight: 1 }]), null);
  const values = [{ value: 40, weight: 1 }, { value: 100, weight: .25 }];
  assert.equal(stats.weightedMedian(values), 40);
  assert.equal(stats.weightedPercentile(values, .9), 100);
  assert.equal(stats.weightedMean(values), 52);
  assert.equal(stats.weightedDistribution([{ value: 'recent', weight: 1 }, { value: 'old', weight: .25 }, { value: 'old', weight: .25 }]).get('old'), .5);
  assert.equal(stats.weightedPercentile([{ value: 1, weight: 1 }, { value: 2, weight: 1 }], .5), 1);
});

test('recent 19:30 bedtimes overcome older 22:00 pattern; all rhythm surfaces agree', () => {
  const sessions = range(30).map(age => sleep(age, age <= 14 ? 19 : 22, 480, 'night', age <= 14 ? 30 : 0));
  const p = profile(sessions, now);
  assert.equal(p.typicalBedtime, 19 * 60 + 30);
  assert.equal(p.typicalWakeTime, 3 * 60 + 30);
  assert.equal(overview.computeRhythmCard(sessions, now).bedtimeMin, p.typicalBedtime);
  const rhythm = insight.generateInsights(sessions, now).find(i => i.id === 'typical-rhythm');
  assert.equal(rhythm.payload.bedtimeMin, p.typicalBedtime);
  assert.equal(rhythm.payload.wakeMin, p.typicalWakeTime);
});

test('day 30 contributes session statistics; day 31, current-day and unfinished sessions cannot', () => {
  const boundary = sleep(30, 12, 45);
  const p = profile([boundary, sleep(31, 12, 600), sleep(0, 9, 600), { ...sleep(1, 12, 45), endMs: now + minute }], now);
  assert.equal(p.completedSessionCount, 1);
  assert.equal(p.medianNapDuration, 45);
  assert.equal(p.typicalTotalSleepPerDay, null);
  assert.equal(p.typicalNapCountPerDay, null);
});

test('each tier changes relative influence without squaring recency weights', () => {
  // 7 * .75 = 5.25 beats 5 * 1. Squaring the older weights would reverse this.
  const sessions = [...range(5).flatMap(d => loggedDay(d, 40)), ...range(7, 8).flatMap(d => loggedDay(d, 100))];
  const p = profile(sessions, now);
  assert.equal(p.medianNapDuration, 100);
  assert.equal(p.typicalTotalSleepPerDay, 160);
  const mass = day.computeHourlyDistribution(sessions, now);
  // All recorded minutes get exactly one day's factor, not a weighted aggregate's factor.
  assert.equal(mass.totalMinutes, 5 * 100 + 7 * .75 * 160);
  for (const age of [1, 8, 15, 22, 30]) {
    const result = day.computeHourlyDistribution(loggedDay(age), now);
    assert.equal(result.totalMinutes, 100 * history.getRecencyWeight(age));
  }
});

test('isolated long nap and extreme bedtime do not distort robust profile values', () => {
  const sessions = range(8).flatMap(d => loggedDay(d, 45));
  const p = profile([...sessions, sleep(9, 14, 600)], now);
  assert.equal(p.medianNapDuration, 45);
  assert.equal(p.napDurationRange[0], 45);
  assert.equal(p.napDurationRange[1], 45);
  const timing = profile([...range(6).map(d => sleep(d, 19, 480, 'night', 30)), sleep(10, 23, 480, 'night')], now);
  assert.equal(timing.typicalBedtime, 19 * 60 + 30);
});

test('clock estimates handle midnight clusters and are independent of input order', () => {
  const values = [{ value: 1430, weight: 1 }, { value: 10, weight: 1 }, { value: 720, weight: .25 }];
  const result = stats.weightedClockMedian(values);
  assert.ok(result === 1430 || result === 10);
  assert.equal(stats.weightedClockMedian(values.reverse()), result);
});

test('fragmented nights yield one bedtime/wake pair, not a bedtime for each awakening', () => {
  const sessions = range(5, 2).flatMap(d => [sleep(d, 20, 240, 'night'), sleep(d - 1, 1, 300, 'night')]);
  const p = profile(sessions, now);
  assert.equal(p.typicalBedtime, 1200);
  assert.equal(p.typicalWakeTime, 360);
});

test('sparse session observations do not imply full-day totals, zero naps, or awake gaps', () => {
  for (const sessions of [[], [sleep(1, 12, 45)], [sleep(1, 12, 45), sleep(3, 12, 60)]]) {
    const p = profile(sessions, now);
    assert.equal(p.typicalTotalSleepPerDay, null);
    assert.equal(p.typicalNapCountPerDay, null);
    assert.equal(p.atNightPct, null);
    assert.equal(p.medianWakeWindow, null);
  }
  const one = profile(loggedDay(1), now);
  assert.equal(one.typicalTotalSleepPerDay, 100);
  assert.equal(one.typicalNapCountPerDay, 1);
  assert.equal(one.confidence, 'low');
});

test('duplicates, implausible sessions and short observation spans do not inflate evidence', () => {
  const sessions = loggedDay(1);
  const original = profile(sessions, now);
  assert.equal(profile([...sessions, ...sessions, sleep(2, 1, 900)], now).typicalTotalSleepPerDay, original.typicalTotalSleepPerDay);
  assert.equal(profile([sleep(1, 12, 30), sleep(1, 13, 30)], now).typicalTotalSleepPerDay, null);
});

test('ongoing historical registrations exclude affected full-day evidence', () => {
  const sessions = range(5).flatMap(d => loggedDay(d));
  const p = profile(sessions, now, { id: 'active', startMs: at(3, 12) });
  assert.equal(p.usableDayCount, 2);
  assert.equal(day.computeHourlyDistribution(sessions, now, { id: 'active', startMs: at(3, 12) }).totalMinutes, 200);
});

test('nap count counts naps, night shares and stretches match Overview and Insight', () => {
  const sessions = range(6).flatMap(d => loggedDay(d));
  const p = profile(sessions, now), k = overview.computeKpis(sessions, now);
  assert.equal(p.typicalNapCountPerDay, 1);
  assert.equal(k.napsPerDay, 1);
  assert.equal(k.atNightPct, 60);
  assert.equal(insight.generateInsights(sessions, now).find(i => i.id === 'night-share').payload.atNightPct, k.atNightPct);
  const rows = insight.generateInsights(sessions, now);
  assert.equal(rows.find(i => i.id === 'typical-naps').payload.count, p.typicalNapCountPerDay);
  assert.equal(rows.find(i => i.id === 'typical-naps').payload.minutes, p.medianNapDuration);
  assert.equal(rows.find(i => i.id === 'typical-longest-stretch').payload.minutes, p.typicalLongestStretch);
});

test('wake windows use the same weighted observations in profile, rhythm and ordinal groups', () => {
  const sessions = range(12).flatMap(d => [sleep(d, 0, 360, 'night'), sleep(d, 8, 45), sleep(d, 11, 45), sleep(d, 14, 45), sleep(d, 20, 60, 'night')]);
  const p = profile(sessions, now), rhythm = overview.computeRhythmCard(sessions, now);
  assert.equal(rhythm.medianWakeWindowMinutes, p.medianWakeWindow);
  const groups = day.computeWakeWindowsThroughDay(sessions, now);
  assert.equal(groups.groups[0].medianMinutes, 120);
  assert.equal(insight.generateInsights(sessions, now).find(i => i.id === 'median-wake-window').payload.medianMinutes, p.medianWakeWindow);
});

test('weekly trends compare completed calendar periods without recency weighting or today', () => {
  const sessions = [...range(7).flatMap(d => loggedDay(d, 100)), ...range(7, 8).flatMap(d => loggedDay(d, 40)), ...loggedDay(0, 600)];
  const trend = overview.computeWeeklyTrend(sessions, now);
  assert.equal(trend.direction, 'more');
  assert.equal(trend.diffMinutes, 60);
  assert.equal(overview.computeWindowAverage(sessions, now, 7).avgMinutes, 160);
  assert.equal(overview.computeWeeklyTrend(loggedDay(1), now).direction, 'insufficient-history');
});

test('raw day/month totals, quality counts and recorded split stay factual', () => {
  const sessions = [...loggedDay(1), ...loggedDay(8), ...loggedDay(31), ...loggedDay(0)];
  const recorded = insight.recordedAnalysisPeriod(sessions, now);
  assert.equal(recorded.length, 4);
  assert.equal(insight.computeQualityDistribution(recorded).find(r => r.rating === 4).count, 4);
  assert.equal(insight.computeQualityDistribution([...recorded, { ...recorded[0], rate: Infinity }]).find(r => r.rating === 4).sharePct, 100);
  assert.equal(insight.computeNightVsDayBreakdown(sessions, now)[0].totalMinutes, 120);
  assert.equal(day.computeSleepPerDayLast7(sessions, now).at(-1).totalMinutes, 100);
  const month = load('src/analytics/month.ts');
  assert.equal(month.computeMonthSummary(month.computeMonthlyBars(sessions, now)).totalMinutes, 300);
});

test('recorded night/day minutes clip both boundaries while counts stay on session start dates', () => {
  const sessions = [sleep(31, 22, 480, 'night'), sleep(1, 22, 480, 'night')];
  const night = insight.computeNightVsDayBreakdown(sessions, now)[0];
  assert.equal(night.totalMinutes, 360 + 120);
  assert.equal(night.sessionCount, 1);
});

test('DST day boundaries follow local dates and histogram accounts for real minutes', () => {
  for (const [month, date, hours] of [[2, 29, 23], [9, 25, 25]]) {
    const anchor = new Date(2026, month, date + 1, 12).getTime();
    const days = history.completedLocalDays(anchor);
    assert.equal(days[0].endMs - days[0].startMs, hours * 3600000);
    assert.equal(days.length, 30);
    assert.equal(history.recencyWeightAt(at(30, 0, 0, anchor), anchor), .25);
    const sessions = [sleep(1, 0, 480, 'night', 0, anchor), sleep(1, 20, 60, 'night', 0, anchor)];
    assert.equal(day.computeHourlyDistribution(sessions, anchor).totalMinutes, 540);
    assert.equal(recentSleepEvidence(sessions, anchor).days[0].daysAgo, 1);
  }
  // 00:30 local is still yesterday in UTC; assign by the local completed date.
  assert.equal(history.recencyWeightAt(Date.parse('2026-11-15T23:30:00Z'), now), 1);
});

test('typical feeding interval shares recency tiers; feed count charts remain exact', () => {
  const feeds = [...range(5), ...range(5, 22)].flatMap(d => [0, 1, 2].map(i => ({
    id: `${d}-${i}`, startMs: at(d, 8) + i * (d <= 5 ? 60 : 180) * minute,
  })));
  assert.equal(feed.computeTypicalFeedInterval(feeds, now).medianMinutes, 60);
  assert.equal(feed.computeFeedsPerDayLast7(feeds, now).reduce((n, d) => n + d.count, 0), 15);
});

test('local-day recency follows each runtime timezone, rather than UTC or elapsed-day rounding', () => {
  try {
    for (const zone of ['UTC', 'America/New_York', 'Europe/Oslo']) {
      process.env.TZ = zone;
      const anchor = new Date(2026, 2, 31, 0, 30).getTime();
      const days = history.completedLocalDays(anchor);
      assert.equal(days[0].localDate, '2026-03-30');
      assert.equal(history.recencyWeightAt(at(30, 0, 0, anchor), anchor), .25);
      assert.equal(history.recencyWeightAt(at(31, 23, 59, anchor), anchor), 0);
      assert.equal(history.recencyWeightAt(at(0, 0, 0, anchor), anchor), 0);
    }
    // A transition at midnight must not preserve 01:00 as tomorrow's boundary.
    process.env.TZ = 'America/Havana';
    const anchor = new Date(2026, 2, 9, 12).getTime();
    const transition = history.completedLocalDays(anchor)[0];
    assert.equal(transition.localDate, '2026-03-08');
    assert.equal(transition.endMs, new Date(2026, 2, 9, 0).getTime());
    assert.equal(transition.endMs - transition.startMs, 23 * 3600000);
  } finally { process.env.TZ = 'Europe/Oslo'; }
});

test('profile card safely renders sparse and usable data in both languages with revised method copy', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Card = load('src/components/analysis/PersonalSleepProfileCard.tsx').default;
  for (const language of ['en', 'no']) {
    uiLanguage = language;
    const sparse = renderToStaticMarkup(React.createElement(Card, { sessions: [sleep(1, 12, 45)], now, guideline: null }));
    assert.ok(!sparse.includes('NaN'));
    assert.ok(!sparse.includes('mini-stats'));
    const html = renderToStaticMarkup(React.createElement(Card, { sessions: range(5).flatMap(d => loggedDay(d)), now, guideline: null }));
    assert.ok(html.includes('mini-stats'));
    assert.ok(!html.includes('NaN'));
    assert.ok(html.includes(language === 'en' ? 'Recent sleep weighs more' : 'Nylig søvn teller mest'));
  }
});

test('forecast compatibility profile retains its original 14-day unweighted behavior', () => {
  const { computeForecastSleepProfile } = load('src/analytics/personalSleepProfile.ts');
  const sessions = [...range(4).flatMap(d => loggedDay(d, 40)), ...range(4, 8).flatMap(d => loggedDay(d, 100))];
  const legacy = computeForecastSleepProfile(sessions, now);
  assert.equal(legacy.historyDays, 8);
  assert.equal(legacy.medianNapDuration, 70);
  assert.equal(legacy.averageTotalSleepPerDay, 130);
  assert.equal(profile(sessions, now).medianNapDuration, 40);
});

test('Insights curate sparse evidence and reuse the weekly comparison only for substantial changes', () => {
  const ids = rows => Array.from(rows, row => row.id);
  assert.deepEqual(ids(insight.generateInsights(loggedDay(1), now)), []);
  const recent = range(3).flatMap(d => loggedDay(d, 100));
  const older = range(3, 8).flatMap(d => loggedDay(d, 40));
  assert.ok(!ids(insight.generateInsights([...recent, ...older.slice(0, 4)], now)).includes('weekly-sleep-change'));
  const rows = insight.generateInsights([...recent, ...older, ...loggedDay(31, 500), sleep(4, 14, 500)], now);
  assert.deepEqual(ids(rows), ['typical-rhythm', 'typical-naps', 'night-share', 'typical-longest-stretch', 'weekly-sleep-change']);
  assert.equal(rows.at(-1).payload.minutes, 60);
  assert.equal(rows.find(row => row.id === 'typical-naps').payload.minutes, 100);
  const smallChange = [...recent, ...range(3, 8).flatMap(d => loggedDay(d, 80))];
  assert.ok(!ids(insight.generateInsights(smallChange, now)).includes('weekly-sleep-change'));
});

test('Insights tab leads with all six curated rows in English and Norwegian', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Tab = load('src/pages/analysis/InsightTab.tsx').default;
  const rows = html => Array.from(html.matchAll(/data-insight="([^"]+)"/g), match => match[1]);
  const sessions = range(14).flatMap(d => [
    sleep(d, 1, 300, 'night'), sleep(d, 9, 40), sleep(d, 14, 40),
    sleep(d, 20, d <= 7 ? 120 : 60, 'night'),
  ]);
  for (const lang of ['en', 'no']) {
    uiLanguage = lang;
    const html = renderToStaticMarkup(React.createElement(Tab, { sessions, now }));
    assert.deepEqual(rows(html), ['typical-rhythm', 'median-wake-window', 'typical-naps',
      'night-share', 'typical-longest-stretch', 'weekly-sleep-change']);
    assert.ok(html.indexOf('data-insight=') < html.indexOf('class="bar-list"'));
    const phrases = lang === 'en'
      ? [/Usually falls asleep/, /Typically awake/, /Usually 2 naps/, /of recorded sleep is at night/, /longest sleep stretch on a typical/, /more sleep per logged day/]
      : [/Sovner vanligvis/, /Er vanligvis v.ken/, /Vanligvis 2 lurer/, /registrerte s.vnen om natten/, /lengste s.vn.kten p. en typisk/, /mer s.vn per registrerte dag/];
    for (const phrase of phrases) assert.match(html, phrase);
    assert.ok(!html.includes('{{'));
    const sparse = renderToStaticMarkup(React.createElement(Tab, { sessions: sessions.slice(0, 4), now }));
    assert.ok(rows(sparse).length < 6);
    const empty = renderToStaticMarkup(React.createElement(Tab, { sessions: [], now }));
    assert.deepEqual(rows(empty), []);
  }
});

test('Data Basis matches profile coverage and clock-specific Probability eligibility', () => {
  const summarize = load('src/analytics/dataBasis.ts').summarizeDataBasis;
  const probability = load('src/analytics/sleepProbability.ts');
  const empty = summarize([], null, now, '10:00');
  assert.equal(empty.days.length, 30);
  assert.ok(empty.days.every(day => day.state === 'empty'));
  assert.equal(empty.profileReady, false);
  assert.equal(empty.insightsReady, false);
  assert.equal(empty.probabilityDaysNeeded, probability.MIN_SLEEP_PROBABILITY_DAYS);
  const sparse = summarize([sleep(1, 14, 40)], null, now, '10:00');
  assert.equal(sparse.days.at(-1).state, 'partial');
  assert.equal(sparse.usableSessions, 1);
  assert.equal(sparse.profileReady, false);
  const sessions = [...range(30).flatMap(d => loggedDay(d)), sleep(31, 14, 40), sleep(0, 7, 30)];
  const active = { id: 'active', startMs: at(1, 23) };
  const summary = summarize(sessions, active, now, '10:00');
  assert.equal(summary.recordedSessions, 60);
  assert.equal(summary.usableSessions, 60);
  assert.equal(summary.usableDays, profile(sessions, now, active).usableDayCount);
  assert.equal(summary.days.at(-1).state, 'partial');
  assert.equal(summary.probability.usableDays, probability.calculateSleepProbability(sessions, '10:00', now, active).usableDays);
  assert.equal(summary.probabilityDaysNeeded, 0);
  assert.equal(summary.profileReady, true);
  assert.equal(summary.insightsReady, true);
  assert.equal(summarize(sessions, null, now, '23:00').probabilityDaysNeeded, probability.MIN_SLEEP_PROBABILITY_DAYS);
});

test('Data Basis follows completed local days through the autumn clock change', () => {
  const anchor = new Date(2026, 9, 26, 12).getTime();
  const summary = load('src/analytics/dataBasis.ts').summarizeDataBasis(loggedDay(1, 40, anchor), null, anchor, '02:30');
  const yesterday = summary.days.at(-1);
  assert.equal(yesterday.endMs - yesterday.startMs, 25 * 3600000);
  assert.equal(yesterday.state, 'usable');
  assert.equal(summary.probability.usableDays, 0);
});

test('Data Basis renders the localized coverage legend and model availability', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Tab = load('src/pages/analysis/DataBasisTab.tsx').default;
  for (const lang of ['en', 'no']) {
    uiLanguage = lang;
    const props = { sessions: range(6).flatMap(d => loggedDay(d)), active: null, now, birthDate: null };
    const html = renderToStaticMarkup(React.createElement(Tab, props));
    assert.equal((html.match(/<li data-state=/g) ?? []).length, 30);
    assert.match(html, lang === 'en' ? /6 usable days at this time/ : /6 brukbare dager på dette tidspunktet/);
    assert.match(html, lang === 'en' ? /Next Sleep on Home/ : /Neste søvn på Hjem/);
    const empty = renderToStaticMarkup(React.createElement(Tab, { ...props, sessions: [] }));
    assert.match(empty, lang === 'en' ? /Not enough data/ : /Ikke nok data/);
  }
});
