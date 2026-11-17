const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function renderSettings(flag, tab = 'account') {
  const exports = {};
  let panelMounts = 0;
  const state = { babies: [], currentBabyId: null, language: 'en', theme: 'light', visualTheme: 'default' };
  const source = read('src/pages/Settings.tsx').replace(/import\.meta\.env/g, '__env');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, __env: { VITE_ENABLE_PURCHASE_TEST_PANEL: flag }, require(name) {
    if (name === 'react') return { useState: initial => [initial === 'baby' ? tab : initial, () => {}] };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '../stores/appStore') return { useAppStore: select => select(state) };
    if (name === '../auth/AuthProvider') return { useAuth: () => ({ user: { email: 'family@example.com' }, signOut() {} }) };
    if (name === '../i18n') return { useTranslation: () => ({ t: key => key }) };
    if (name === '../components/SleepyPlusTestPanel') return { __esModule: true, default: () => {
      panelMounts++;
      return React.createElement('section', { className: 'plus-test-panel' }, 'purchase-test-surface');
    } };
    if (name.startsWith('../components/')) return { __esModule: true, default: () => React.createElement('div', null, name) };
    if (name === '../analytics/localDate' || name === '../services/householdService' || name.endsWith('.css')) return {};
    throw Error(`Unexpected Settings dependency: ${name}`);
  } });
  return { html: renderToStaticMarkup(React.createElement(exports.default)), panelMounts };
}

for (const flag of [undefined, 'false', 'true', 'TRUE', '1', true, ' true ']) {
  test(`Account purchase test panel requires exactly string true: ${String(flag)} (${typeof flag})`, () => {
    const { html, panelMounts } = renderSettings(flag);
    assert.equal(panelMounts, flag === 'true' ? 1 : 0);
    assert.equal(html.includes('purchase-test-surface'), flag === 'true');
    for (const control of ['family@example.com', 'settings.appearanceTitle', 'settings.visualThemeTitle',
      'settings.languageTitle', 'settings.logoutButton', '../components/AppVersion']) assert.ok(html.includes(control), control);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  });
}

test('purchase panel stays in Account and normal Settings tabs remain available', () => {
  for (const [tab, control] of [['baby', 'AddChildSettings'], ['sleep', 'SoundMonitoringSettings'], ['notifications', 'NotificationSettings']]) {
    const { html, panelMounts } = renderSettings('true', tab);
    assert.equal(panelMounts, 0);
    assert.ok(html.includes(`../components/${control}`));
  }
});

function load(file, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, ...globals });
  return exports;
}

test('Settings defines exactly four localized top-level tabs with baby/family, sound and account controls reachable', () => {
  const source = read('src/pages/Settings.tsx');
  const tabs = [...source.matchAll(/\["(\w+)", t\("settings\.(tab\w+)"\)\]/g)];
  assert.deepEqual(tabs.map(match => match[1]), ['baby', 'sleep', 'notifications', 'account']);
  for (const [lang, expected] of [['en', ['Baby', 'Sleep', 'Notifications', 'Account']], ['no', ['Baby', 'Søvn', 'Varsler', 'Konto']]]) {
    const strings = load(`src/i18n/${lang}.ts`).default;
    assert.deepEqual(tabs.map(match => strings.settings[match[2]]), expected);
    assert.doesNotMatch(JSON.stringify(strings.settings), /2\.2\.0|migration|migrering/);
  }
  const baby = source.slice(source.indexOf('{activeTab === "baby"'), source.indexOf('{activeTab === "sleep"'));
  assert.match(baby, /<AddChildSettings/); assert.match(baby, /<FamilySettings/); assert.match(baby, /handleSaveBirthDate/);
  const sleep = source.slice(source.indexOf('{activeTab === "sleep"'), source.indexOf('{activeTab === "notifications"'));
  assert.match(sleep, /<LiveActivitySettings/); assert.match(sleep, /<SoundMonitoringSettings/);
  const account = source.slice(source.indexOf('{activeTab === "account"'));
  for (const control of ['toggleTheme', 'setVisualTheme', 'setLanguage', 'AppVersion', 'handleLogout']) assert.ok(account.includes(control));
});

test('production Settings has no test-notification action and backend error details cannot reach its error labels', () => {
  assert.doesNotMatch(read('src/components/NotificationSettings.tsx'), /sendTestNotification|sendTestButton|handleTestNotification/);
  for (const file of ['src/pages/Settings.tsx', ...['AddChildSettings', 'FamilySettings', 'NotificationSettings', 'SleepEventNotificationSettings'].map(name => `src/components/${name}.tsx`)]) {
    assert.doesNotMatch(read(file), /\b(?:err|error|loadError|saveError)\.message/);
  }
});

test('device preference reports storage failure and does not falsely publish a saved value', () => {
  let fail = false; const saved = new Map();
  const globals = { localStorage: { getItem: key => saved.get(key) ?? null,
    setItem(key, value) { if (fail) throw Error('Storage denied'); saved.set(key, value); } } };
  const preference = load('src/services/liveActivityPreference.ts', globals);
  let changes = 0; preference.subscribeLiveActivityPreference(() => changes++);
  assert.equal(preference.liveActivityEnabled(), true);
  fail = true; assert.throws(() => preference.saveLiveActivityEnabled(false));
  assert.equal(preference.liveActivityEnabled(), true); assert.equal(changes, 0);
  fail = false; preference.saveLiveActivityEnabled(false);
  assert.equal(changes, 1);
  assert.equal(load('src/services/liveActivityPreference.ts', globals).liveActivityEnabled(), false);
});

test('native OFF changes presentation only and blocks all request paths without clearing microphone state', () => {
  const swift = read('ios/App/App/SleepLiveActivity.swift');
  const off = swift.slice(swift.indexOf('func setEnabled('), swift.indexOf('var ownerID:'));
  assert.match(off, /defaults\.set\(value/); assert.match(off, /if !value \{ await endAll\(\) \}/);
  assert.doesNotMatch(off, /sound|Sound|rpc|Wake|stop/);
  for (const signature of ['func reconcile(ownerId:', 'func start(ownerId:', 'private func request(']) {
    assert.match(swift.slice(swift.indexOf(signature), swift.indexOf(signature) + 180), /guard enabled else/);
  }
  const endAll = swift.slice(swift.indexOf('func endAll()'), swift.indexOf('private func finish('));
  assert.doesNotMatch(endAll, /sound\.removeAll|stop|end_sleep|SleepWake/);
  assert.match(swift, /CAPPluginMethod\(name: "setEnabled", returnType: CAPPluginReturnPromise\)/);
  assert.match(swift, /@objc public func setEnabled\(_ call: CAPPluginCall\)/);
});

test('version comes from native bundle or web package, without another version constant', () => {
  const source = read('src/components/AppVersion.tsx');
  assert.match(source, /packageInfo\.version/); assert.match(source, /liveActivityBridge\.getAppInfo\(\)/);
  assert.doesNotMatch(source, /2\.2\.0/);
  const swift = read('ios/App/App/SleepLiveActivity.swift');
  assert.match(swift, /CFBundleShortVersionString/); assert.match(swift, /CFBundleVersion/);
});
