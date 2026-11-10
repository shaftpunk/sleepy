const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../src/components/NativeSoundLevelMeter.tsx'), 'utf8');
new Function('exports', 'require', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(exportsObject, require);
const Meter = exportsObject.default;

test('native meter presents the actual display sample with matching accessible value', () => {
  for (const level of [0, .02, .25, .8, 1]) {
    const html = renderToStaticMarkup(createElement(Meter, { level, label: 'Lydnivå' }));
    assert.ok(html.includes('role="meter"'));
    assert.ok(html.includes('aria-label="Lydnivå"'));
    assert.ok(html.includes(`aria-valuenow="${level}"`));
    assert.ok(html.includes(`translateZ(0) scaleX(${level})`));
    assert.ok(!html.includes('<meter'));
  }
});

test('invalid or out-of-range visual samples cannot break meter geometry', () => {
  for (const [level, expected] of [[NaN, 0], [Infinity, 0], [-1, 0], [2, 1]]) {
    const html = renderToStaticMarkup(createElement(Meter, { level, label: 'Sound level' }));
    assert.ok(html.includes(`scaleX(${expected})`));
    assert.ok(html.includes(`aria-valuenow="${expected}"`));
  }
});
