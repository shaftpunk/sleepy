const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, language = 'en') {
  const filename = path.resolve(__dirname, '..', file), exports = {};
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', 'require', output)(exports, name => {
    if (name.endsWith('.css') || name.endsWith('/soundEventService')) return {};
    if (name.endsWith('/i18n')) return { useTranslation: () => ({ locale: language === 'no' ? 'nb-NO' : 'en-GB',
      t: (key, params = {}) => key.split('.').reduce((v, k) => v[k], load(`src/i18n/${language}.ts`, language).default)
        .replace(/\{\{(\w+)\}\}/g, (_, k) => params[k]) }) };
    if (!name.startsWith('.')) return require(name);
    return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name)) + '.ts', language);
  });
  return exports;
}
const { soundActivityTimeline: timeline, soundActivityIntensity: intensity } = load('src/sound/activityTimeline.ts');
const base = Date.parse('2026-11-10T22:00:00Z'), iso = n => new Date(base + n).toISOString();
const minute = 60000;
const sleep = { id: 'sleep', baby_id: 'baby', starttime: iso(0), endtime: iso(600 * minute) };
function event(id, start, end, max = .1) {
  return { id, sleep_id: 'sleep', baby_id: 'baby', started_at: iso(start), ended_at: iso(end),
    avg_level: .01, max_level: max, event_type: 'sound', created_at: iso(end), created_by_user_id: 'user' };
}
test('proportional positioning across midnight and an overnight sleep', () => {
  const result = timeline(sleep, [event('one', 150 * minute, 300 * minute)], 400);
  assert.equal(result.items[0].left, 25); assert.equal(result.items[0].width, 25);
  assert.equal(result.items[0].durationMs, 150 * minute); assert.equal(result.markers.length, 5);
  assert.equal(result.start, base); assert.equal(result.end, base + 600 * minute);
});
test('edited boundaries clip geometry/summary only; original objects and measurements stay untouched', () => {
  const events = [event('before', -minute, minute), event('after', 599 * minute, 602 * minute), event('outside', -3 * minute, -minute)];
  const original = JSON.stringify(events), result = timeline(sleep, events);
  assert.equal(result.items.length, 2); assert.equal(result.totalMs, 2 * minute);
  assert.equal(result.items[0].from, base - minute); assert.equal(result.items[0].displayStart, base);
  assert.equal(result.items[1].displayEnd, base + 600 * minute);
  assert.equal(result.items[0].durationMs, 2 * minute); assert.equal(JSON.stringify(events), original);
});
test('overlap union includes nested/chained intervals exactly once, without merging event identities', () => {
  const result = timeline(sleep, [event('a', 0, 3 * minute), event('b', minute, 2 * minute),
    event('c', 2 * minute, 4 * minute), event('d', 5 * minute, 6 * minute)]);
  assert.equal(result.totalMs, 5 * minute); assert.equal(result.items.length, 4);
  assert.notEqual(result.items[0].lane, result.items[1].lane);
});
test('isolated intensity mapping has stable calibration boundaries', () => {
  assert.equal(intensity(0), 'low'); assert.equal(intensity(.079), 'low');
  assert.equal(intensity(.08), 'medium'); assert.equal(intensity(.199), 'medium');
  assert.equal(intensity(.2), 'high'); assert.equal(intensity(1), 'high');
});
test('short events have contained minimum visual width and independent usable hit regions', () => {
  const result = timeline(sleep, [event('left', 0, 100), event('right', 600 * minute - 100, 600 * minute)], 200);
  for (const item of result.items) {
    assert.ok(item.width >= 2.5); assert.ok(item.left >= 0); assert.ok(item.left + item.width <= 100);
    assert.ok(item.hitWidth >= 14); assert.ok(item.hitLeft + item.hitWidth <= 100);
  }
  assert.equal(result.totalMs, 200); // Minimum painted widths never inflate duration.
});
test('empty, invalid, wrong-session and non-overlapping events cannot fabricate observations', () => {
  assert.equal(timeline(sleep, []).totalMs, 0);
  assert.equal(timeline({ ...sleep, endtime: null }, []).valid, false);
  assert.equal(timeline(sleep, [{ ...event('wrong', 0, minute), sleep_id: 'other' }, event('zero', 0, 0),
    { ...event('bad', 0, minute), started_at: 'invalid' }]).items.length, 0);
});
test('very short nap and long overnight sessions use elapsed time without rounding geometry', () => {
  const result = timeline({ ...sleep, endtime: iso(1000) }, [event('tiny', 250, 750)], 200);
  assert.equal(result.items[0].left, 25); assert.equal(result.items[0].width, 50);
  assert.equal(result.totalMs, 500); assert.equal(result.markers.length, 2);
  const long = timeline({ ...sleep, endtime: iso(18 * 3600000) }, [event('later', 17 * 3600000, 18 * 3600000)]);
  assert.equal(long.totalMs, 3600000); assert.ok(long.items[0].left > 94);
});
for (const language of ['en', 'no']) test(`${language}: empty copy and accessible selectable events expose no audio/RMS claims`, () => {
  const { SoundActivityTimeline } = load('src/components/SleepSoundActivity.tsx', language);
  const render = events => renderToStaticMarkup(React.createElement(SoundActivityTimeline, { sleep, events }));
  const empty = render([]);
  assert.ok(empty.includes(language === 'en' ? 'No sound events recorded for this sleep.' : 'Ingen lydhendelser registrert for denne søvnen.'));
  const html = render([event('one', minute, 2 * minute, .21), event('two', 4 * minute, 5 * minute)]);
  assert.equal((html.match(/class="sound-activity-event/g) || []).length, 2);
  assert.ok(html.includes('aria-controls=')); assert.ok(html.includes('<details')); assert.ok(html.includes('aria-pressed="false"'));
  assert.ok(html.includes(language === 'en' ? 'High activity' : 'Høy aktivitet'));
  assert.ok(!html.includes('max_level')); assert.ok(!html.includes('0.21')); assert.ok(!html.includes('<audio'));
});
