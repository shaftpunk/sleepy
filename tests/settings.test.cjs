const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
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
