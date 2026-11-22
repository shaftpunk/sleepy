const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, globals = {}, imports = {}) {
  const exports = {};
  const source = read(file).replace(/import\.meta\.env/g, '__env');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports, __env: {}, URL, ...globals,
    require(name) {
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name.endsWith('.css')) return {};
      return { __esModule: true, default: () => React.createElement('div', null, name) };
    },
  });
  return exports;
}

const translate = { useTranslation: () => ({ lang:'en', t:key=>key }) };
const link = { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) };

test('Settings index has exactly six destinations and no inline controls or diagnostics', () => {
  const Settings = load('src/pages/Settings.tsx', {}, { '../i18n':translate, 'react-router-dom':link }).default;
  const html = renderToStaticMarkup(React.createElement(Settings));
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]),
    ['family','notifications','appearance','plus','account','about']);
  assert.doesNotMatch(html, /RevenueCat|sandbox|Analysis|input|select|plus-test-panel|role="tab"/i);
});

test('about shows the version and only configured HTTPS destinations', () => {
  const mocks = {
    '../i18n': translate,
    './Settings': { SettingsScreen: ({ children }) => React.createElement('main', null, children) },
  };
  const render = env => renderToStaticMarkup(React.createElement(load('src/pages/About.tsx', {__env:env}, mocks).default));
  assert.match(render({}), /AppVersion/);
  assert.doesNotMatch(render({}), /href=|Analysis/);
  const html = render({ VITE_SLEEPY_PRIVACY_URL:'https://example.test/privacy', VITE_SLEEPY_TERMS_URL:'javascript:alert(1)',
    VITE_SLEEPY_SUPPORT_URL:'http://example.test/insecure' });
  assert.match(html, /href="https:\/\/example.test\/privacy"/);
  assert.doesNotMatch(html, /alert\(1\)|insecure|settings.terms|settings.support/);
});

test('production entitlement status and internal tools are separate', () => {
  for (const flag of [undefined,'true','TRUE','1',true]) {
    for (const [verificationState,isPlus,key] of [['verified',false,'plusFree'],['verified',true,'plusActive'],['unknown',false,'plusUnknown']]) {
      const mocks = {
        '../i18n':translate, 'react-router-dom':link, '../auth/AuthProvider':{useAuth:()=>({user:null,loading:false})},
        '../households/HouseholdContextProvider':{useHouseholdContext:()=>({})},
        '../entitlements/EntitlementProvider':{useEntitlements:()=>({verificationState,isPlus})},
        '../services/revenueCatService':{revenueCatAvailable:()=>true},
      };
      const Plus = load('src/components/SleepyPlusSettings.tsx', {__env:{VITE_ENABLE_PURCHASE_TEST_PANEL:flag}}, mocks).default;
      const html = renderToStaticMarkup(React.createElement(Plus));
      assert.ok(html.includes('settings.' + key));
      assert.equal(html.includes('settings.internalPurchases'),flag === 'true');
      assert.doesNotMatch(html,/RevenueCat|sandbox|evidence|plus-test-panel/);
    }
  }
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

test('family member roster reads only roles in the supplied household under caller RLS', async () => {
  const calls = [];
  let denied = false;
  const { getHouseholdMemberRoles } = load('src/services/householdService.ts', {}, {
    '../lib/supabase': { supabase: { from(table) {
      calls.push(table);
      return { select(fields) {
        calls.push(fields);
        return { async eq(column, value) {
          calls.push([column, value]);
          return denied ? { error: new Error('forbidden') }
            : { data: [{ role: 'owner' }, { role: 'viewer' }, { role: 'unexpected' }] };
        } };
      } };
    } } },
  });
  assert.deepEqual(Array.from(await getHouseholdMemberRoles('family')), ['owner', 'viewer']);
  assert.deepEqual(calls, ['household_members', 'role', ['household_id', 'family']]);
  denied = true;
  await assert.rejects(getHouseholdMemberRoles('inaccessible'), /forbidden/);
});
