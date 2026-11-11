const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

process.env.TZ = 'Europe/Oslo';
const root = path.resolve(__dirname, '..');
function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (overrides[file]) return overrides[file];
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const filename = path.join(root, file);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { exports, Date, console, document: { hidden: false }, require: name => {
      if (overrides[name]) return overrides[name];
      if (!name.startsWith('.')) return require(name);
      const resolved = path.resolve(path.dirname(filename), name);
      const target = fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '.tsx';
      return load(path.relative(root, target).split(path.sep).join('/'));
    } });
    return exports;
  }
  return load;
}
const load = loader();
const { classifyPersonalSleep } = load('src/analytics/personalSleepClassification.ts');
const { estimateActiveSleep } = load('src/analytics/activeSleepEstimate.ts');
const activeAt = (hour, minute = 0, type = 'sleep') => ({
  id: 'active', startMs: new Date(2026, 10, 10, hour, minute).getTime(), sleepTypeRaw: type,
});
function session(daysAgo, hour, minutes, type = 'sleep', minute = 0) {
  const startMs = new Date(2026, 10, 10 - daysAgo, hour, minute).getTime();
  return { id: `${daysAgo}-${hour}-${minute}`, startMs, endMs: startMs + minutes * 60000,
    durationMin: minutes, sleepTypeRaw: type };
}
function pattern(shortDays, longDays, shortHour, longHour) {
  return [
    ...Array.from({ length: shortDays }, (_, i) => session(i + 2, shortHour, 44)),
    ...Array.from({ length: longDays }, (_, i) => session(i + 2, longHour, 360)),
  ];
}
const knownHistory = [
  ...[617, 498, 560, 528, 526, 652, 493, 488, 455].map((minutes, index) => session(index + 1, 23, minutes)),
  ...[36, 44, 50].map((minutes, index) => session(index + 1, 13, minutes)),
  session(0, 22, 16, 'sleep', 33),
];

test('known 23:25 pattern returns long-sleep classification with nine versus one days and no wake prediction', () => {
  const result = classifyPersonalSleep(knownHistory, activeAt(23, 25));
  assert.equal(result.classification, 'LONG_SLEEP_LIKE');
  assert.equal(result.longDays, 9);
  assert.equal(result.shortDays, 1);
  assert.equal(estimateActiveSleep(knownHistory, activeAt(23, 25)).estimatedWakeTime, null);
});

test('personal patterns can support late and early naps or daytime long sleeps', () => {
  const examples = [
    [23, 25, pattern(7, 7, 23, 15), 'SHORT_SLEEP_LIKE'],
    [20, 15, pattern(6, 6, 20, 10), 'SHORT_SLEEP_LIKE'],
    [2, 10, pattern(8, 8, 13, 2), 'LONG_SLEEP_LIKE'],
    [6, 30, pattern(4, 4, 6, 19), 'SHORT_SLEEP_LIKE'],
    [14, 0, pattern(5, 5, 8, 14), 'LONG_SLEEP_LIKE'],
    [18, 55, pattern(4, 4, 19, 5), 'SHORT_SLEEP_LIKE'],
    [19, 5, pattern(4, 4, 19, 5), 'SHORT_SLEEP_LIKE'],
    [0, 15, pattern(4, 4, 23, 13), 'SHORT_SLEEP_LIKE'],
    [21, 45, pattern(3, 3, 21, 22), 'UNCERTAIN'],
    [11, 0, pattern(2, 2, 11, 23), 'UNCERTAIN'],
    [12, 0, [session(1, 12, 44), session(2, 12, 45), session(3, 12, 46)], 'UNCERTAIN'],
  ];
  for (const [hour, minute, history, expected] of examples) {
    assert.equal(classifyPersonalSleep(history, activeAt(hour, minute)).classification, expected, `${hour}:${minute}`);
  }
});

test('explicit labels work with sparse groups, and multiple sleeps on one date do not satisfy three days', () => {
  const labelled = [session(1, 23, 36, 'nap'), session(2, 23, 44, 'nap'), session(3, 23, 50, 'nap')];
  assert.equal(estimateActiveSleep(labelled, activeAt(23, 25, 'nap')).estimatedWakeTime, activeAt(23, 25).startMs + 44 * 60000);
  assert.equal(classifyPersonalSleep([], activeAt(13, 0)).classification, 'UNCERTAIN');
  const oneDay = [session(1, 8, 30, 'nap'), session(1, 12, 30, 'nap'), session(1, 17, 30, 'nap')];
  assert.equal(classifyPersonalSleep(oneDay, activeAt(12, 0, 'nap')).classification, 'UNCERTAIN');
});

test('nearby evidence needs the proposed two-to-one dominance, including mixed days', () => {
  const history = [session(1, 19, 44, 'nap'), session(2, 19, 44, 'nap'), session(3, 19, 44, 'nap'),
    session(1, 21, 360, 'night'), session(2, 21, 360, 'night')];
  assert.equal(classifyPersonalSleep(history, activeAt(20)).classification, 'UNCERTAIN');
  history.push(session(4, 19, 44, 'nap'));
  assert.equal(classifyPersonalSleep(history, activeAt(20)).classification, 'SHORT_SLEEP_LIKE');
});

test('cleaning, future rows and outside-window history cannot create support and input order does not change the result', () => {
  const valid = pattern(5, 5, 13, 23);
  const history = [...valid, session(15, 13, 44), session(-1, 13, 44), session(0, 23, 500),
    session(1, 13, 900), { ...session(2, 13, 44), id: 'overlap' }, session(1, 11, 0)];
  const first = classifyPersonalSleep(history, activeAt(13));
  const reversed = classifyPersonalSleep([...history].reverse(), activeAt(13));
  assert.equal(first.classification, 'SHORT_SLEEP_LIKE');
  assert.equal(first.shortDays, 5);
  assert.equal(reversed.classification, first.classification);
  assert.deepEqual(Array.from(reversed.shortSamples, s => s.id), Array.from(first.shortSamples, s => s.id));
});

function uiLoad(language) {
  const resources = load(`src/i18n/${language}.ts`).default;
  return loader({ '../i18n': { useTranslation: () => ({ lang: language,
    t: (key, values = {}) => key.split('.').reduce((part, field) => part[field], resources)
      .replace(/\{\{(\w+)\}\}/g, (_, name) => values[name]),
  }) } })('src/components/ActiveSleepEstimate.tsx').default;
}

for (const language of ['en', 'no']) {
  test(`${language}: Home renders all three presentation states, and long/uncertain never leak a date`, () => {
    const Component = uiLoad(language);
    const started = activeAt(13).startMs;
    const at = new Date(started + 100 * 60000).toISOString();
    const render = (classification, now = started + 65 * 60000) => renderToStaticMarkup(React.createElement(Component, {
      presentation: { classification, estimatedWakeTime: at }, sleepStartedAt: new Date(started).toISOString(), now,
    }));
    const long = render('LONG_SLEEP_LIKE');
    assert.match(long, language === 'no' ? /Trolig nattsøvn/ : /Likely night sleep/);
    assert.doesNotMatch(long, /<progress|remaining|igjen|13:|14:/);
    const short = render('SHORT_SLEEP_LIKE');
    assert.match(short, /<progress value="0.65"/);
    assert.match(short, language === 'no' ? /~35 min igjen/ : /~35 min remaining/);
    assert.equal(render('UNCERTAIN'), '');
    const past = render('SHORT_SLEEP_LIKE', started + 150 * 60000);
    assert.match(past, /<progress value="1"/);
    assert.match(past, language === 'no' ? /Forbi estimert oppvåkning/ : /Past estimated wake time/);
  });
}

test('existing history read feeds one shared Home and bridge result, with no extra server calls and account isolation', async () => {
  let generation = 0, databaseReads = 0;
  const bridgeCalls = [];
  const active = { id: 'active', baby_id: 'baby', starttime: new Date(activeAt(23, 25).startMs).toISOString(),
    sleep_type: 'sleep', endtime: null, deleted_at: null };
  const app = loader({
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => true },
      registerPlugin: () => ({ setEnabled: async () => {}, reconcile: async payload => bridgeCalls.push(['reconcile', payload]),
        updatePresentation: async payload => bridgeCalls.push(['update', payload]), endAll: async () => {} }) },
    'src/auth/sessionLifecycle.ts': { sessionGeneration: () => generation, isSessionGenerationCurrent: n => n === generation, registerBeforeSignOut() {} },
    'src/services/sleepService.ts': { getActiveSleep: async () => { databaseReads++; return active; } },
  });
  const historyService = app('src/services/sleepEstimateService.ts');
  const live = app('src/services/liveActivityService.ts');
  await live.configureSleepLiveActivities('owner', [{ id: 'baby', name: 'Amalie' }]);
  assert.equal(bridgeCalls[0][1].sleeps[0].classification, 'UNCERTAIN');
  const rows = knownHistory.map(s => ({ id: s.id, baby_id: 'baby', starttime: new Date(s.startMs).toISOString(),
    endtime: new Date(s.endMs).toISOString(), durationminutes: s.durationMin, sleep_type: s.sleepTypeRaw, rate: null, deleted_at: null }));
  historyService.publishSleepEstimateHistory('baby', rows, activeAt(23, 25).startMs - 35 * 86400000, activeAt(23, 25).startMs, generation);
  await live.refreshSleepLiveActivityEstimates();
  const presentation = await historyService.getActiveSleepEstimate(active);
  assert.equal(presentation.classification, 'LONG_SLEEP_LIKE');
  assert.equal(presentation.estimatedWakeTime, null);
  const native = bridgeCalls.find(([name]) => name === 'update')[1];
  assert.equal(native.classification, presentation.classification);
  assert.equal(native.estimatedWakeTime, presentation.estimatedWakeTime);
  const html = renderToStaticMarkup(React.createElement(uiLoad('no'), { presentation, sleepStartedAt: active.starttime, now: activeAt(23, 25).startMs }));
  assert.match(html, /Trolig nattsøvn/);
  assert.equal(databaseReads, 1, 'history notifications do not re-read active sleep');
  generation++;
  assert.equal((await historyService.getActiveSleepEstimate(active)).classification, 'UNCERTAIN');
  historyService.publishSleepEstimateHistory('baby', rows, 0, Date.now(), generation - 1);
  assert.equal((await historyService.getActiveSleepEstimate(active)).classification, 'UNCERTAIN');
});

test('history from a different baby, a partial window or an older request cannot replace the current snapshot', async () => {
  let generation = 1;
  const app = loader({ 'src/auth/sessionLifecycle.ts': { sessionGeneration: () => generation } });
  const service = app('src/services/sleepEstimateService.ts');
  const start = activeAt(23, 25).startMs;
  const active = { id: 'active', baby_id: 'baby', starttime: new Date(start).toISOString(), sleep_type: 'sleep' };
  const rows = knownHistory.map(s => ({ id: s.id, baby_id: 'baby', starttime: new Date(s.startMs).toISOString(),
    endtime: new Date(s.endMs).toISOString(), durationminutes: s.durationMin, sleep_type: s.sleepTypeRaw, rate: null }));
  service.publishSleepEstimateHistory('baby', rows, start - 86400000, start, generation);
  assert.equal((await service.getActiveSleepEstimate(active)).classification, 'UNCERTAIN');
  service.publishSleepEstimateHistory('baby', rows, start - 35 * 86400000, start + 1000, generation);
  assert.equal((await service.getActiveSleepEstimate(active)).classification, 'LONG_SLEEP_LIKE');
  service.publishSleepEstimateHistory('baby', [], start - 35 * 86400000, start, generation);
  assert.equal((await service.getActiveSleepEstimate(active)).classification, 'LONG_SLEEP_LIKE');
  service.publishSleepEstimateHistory('baby', rows.map(row => ({ ...row, baby_id: 'other' })), 0, start + 2000, generation);
  assert.equal((await service.getActiveSleepEstimate(active)).classification, 'LONG_SLEEP_LIKE');
  generation++;
  assert.equal((await service.getActiveSleepEstimate(active)).classification, 'UNCERTAIN');
});

test('native presentation gates, localization, Wake up button and sound presentation are preserved', () => {
  const file = 'ios/App/SleepyWidgets/SleepLiveActivityWidget.swift';
  const widget = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  assert.match(widget, /presentationClassification == \.longSleepLike\s*\{\s*Label\("likely_night_sleep", systemImage: "moon.fill"\)/);
  assert.match(widget, /presentationClassification == \.shortSleepLike,[\s\S]*?SleepNapProgress\(/);
  const view = name => widget.split(`private struct ${name}: View {`)[1].split('\nprivate struct ')[0];
  assert.doesNotMatch(view('SleepWakeButton'), /classification|estimatedWakeTime/);
  assert.match(view('SleepWakeButton'), /Button\(intent: WakeSleepIntent/);
  assert.doesNotMatch(view('SleepSoundStatus'), /classification|estimatedWakeTime/);
  assert.match(view('SleepSoundStatus'), /active && !stale \? "mic.fill" : "mic.slash.fill"/);
  assert.match(view('SleepElapsed'), /Text\(timerInterval: attributes.startedAt\.\.\.attributes.presentationEndsAt, countsDown: false/);
  assert.match(view('SleepNapProgress'), /ProgressView\(timerInterval: start\.\.\.wake, countsDown: false\)/);
  assert.doesNotMatch(view('SleepNapProgress'), /Date\(\)|Date.now|timeIntervalSinceNow/);
  for (const [locale, copy] of [['en','Likely night sleep'], ['nb','Trolig nattsøvn']]) {
    const strings = fs.readFileSync(path.join(root, `ios/App/SleepyWidgets/${locale}.lproj/Localizable.strings`), 'utf8');
    assert.ok(strings.includes(`"likely_night_sleep" = "${copy}";`));
  }
});
