const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');

function load(file, language = 'no') {
  const filename = path.resolve(__dirname, '..', file);
  const exports = {};
  const translate = (key, params = {}) => {
    const resource = load(`src/i18n/${language}.ts`).default;
    const value = key.split('.').reduce((value, part) => value[part], resource);
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key]);
  };
  const i18n = { LOCALES: { no: 'nb-NO', en: 'en-GB' }, translate: (_, key, params) => translate(key, params),
    useTranslation: () => ({ lang: language, t: translate }) };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', 'require', output)(exports, name => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/i18n')) return i18n;
    if (!name.startsWith('.')) return require(name);
    const target = path.resolve(path.dirname(filename), name);
    return load(path.relative(path.resolve(__dirname, '..'), fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`), language);
  });
  return exports;
}
const { sleepClockDetails } = load('src/components/history/sleepClockDetails.ts');
const { computeSleepClock } = load('src/analytics/sleepClock.ts');
const now = new Date(2026, 10, 10, 8, 0).getTime();
const minute = 60000;
const session = (id, start, end) => ({ id, startMs: now + start * minute, endMs: now + end * minute,
  durationMin: end - start, rate: null, note: null, sleepTypeRaw: '' });

test('empty window has zero sessions, unchanged zero total and full ring', () => {
  assert.equal(sleepClockDetails([], null, now).length, 0);
  const clock = computeSleepClock([], null, now);
  assert.equal(clock.totalSleepMinutes, 0);
  assert.equal(clock.segments.length, 1);
  assert.equal(clock.segments[0].endAngle - clock.segments[0].startAngle, 360);
});
test('one sleep retains exact times, duration and original cell-based total', () => {
  const record = session('one', -98, -49);
  const [detail] = sleepClockDetails([record], null, now);
  assert.equal(detail.startMs, record.startMs);
  assert.equal(detail.endMs, record.endMs);
  assert.equal(detail.durationMinutes, 49);
  assert.equal(computeSleepClock([record], null, now).totalSleepMinutes, 50);
});
test('many very short sleeps remain independently selectable even below cell resolution', () => {
  const sessions = Array.from({ length: 20 }, (_, i) => session(`${i}`, -600 + i * 20, -598 + i * 20));
  const details = sleepClockDetails(sessions, null, now);
  assert.equal(details.length, 20);
  assert.equal(new Set(details.map(detail => detail.key)).size, 20);
  assert.ok(details.every(detail => detail.durationMinutes === 2));
});
test('midnight crossing remains one session with unmodified chronological endpoints', () => {
  const record = session('overnight', -600, -120);
  const [detail] = sleepClockDetails([record], null, now);
  assert.notEqual(new Date(detail.startMs).getDate(), new Date(detail.endMs).getDate());
  assert.equal(detail.durationMinutes, 480);
});
test('pre-window sleep clips geometry only; old/future/nonpositive intervals are excluded', () => {
  const records = [session('long', -1500, -1380), session('old', -1600, -1440), session('future', 1, 10), session('zero', -10, -10)];
  const [detail, ...others] = sleepClockDetails(records, null, now);
  assert.equal(others.length, 0);
  assert.equal(detail.visibleStartMs, now - 1440 * minute);
  assert.equal(detail.startMs, now - 1500 * minute);
  assert.equal(detail.durationMinutes, 120);
});
test('active sleep advances with now without changing its identity or start time', () => {
  const active = { id: 'active', startMs: now - 82 * minute };
  const [first] = sleepClockDetails([], active, now);
  const [later] = sleepClockDetails([], active, now + minute);
  assert.equal(first.isActive, true);
  assert.equal(first.durationMinutes, 82);
  assert.equal(later.durationMinutes, 83);
  assert.equal(first.key, later.key);
});
for (const language of ['no', 'en']) test(`${language}: accessible ring, exact labels, active state, picker and no hands/duplicate legend`, () => {
  const SleepClock = load('src/components/history/SleepClock.tsx', language).default;
  const html = renderToStaticMarkup(React.createElement(SleepClock, {
    sessions: [session('completed', -500, -451)], active: { id: 'active', startMs: now - 82 * minute }, now,
  }));
  assert.equal((html.match(/role="button"/g) || []).length, 2);
  assert.ok(html.includes('aria-controls='));
  assert.ok(html.includes('<select'));
  assert.ok(html.includes(language === 'no' ? 'Sover nå' : 'Sleeping now'));
  assert.ok(html.includes(language === 'no' ? '2 økter' : '2 sessions'));
  // Keep Sleepy's existing localized duration formatter ("49m").
  assert.ok(html.includes('49m'));
  assert.ok(!html.includes('sleep-clock-hand'));
  assert.ok(!html.includes('sleep-clock-legend'));
  for (const hour of ['00', '03', '06', '09', '12', '15', '18', '21']) assert.ok(html.includes(`>${hour}</text>`));
});
