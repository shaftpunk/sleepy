const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, imports, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace('import.meta.env.VITE_VAPID_PUBLIC_KEY', '"test-vapid"');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => imports[name], crypto: webcrypto,
    TextEncoder, TextDecoder, Uint8Array, AbortSignal, btoa, atob,
    window: { setTimeout, clearTimeout }, ...globals });
  return exports;
}
function setup(options = {}) {
  const events = new Map();
  const storage = options.storage ?? new Map();
  let generation = 0, cleanup;
  let permission = options.permission ?? 'granted';
  const calls = { register: 0, unregister: 0, request: 0, rpc: [] };
  const rows = new Map();
  const plugin = {
    addListener: async (name, callback) => { events.set(name, callback); return { remove: async () => {} }; },
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => { calls.request++; permission = options.requestResult ?? 'granted'; return { receive: permission }; },
    register: async () => {
      calls.register++;
      if (options.registrationError) events.get('registrationError')({ error: 'private detail' });
      else if (!options.manual) events.get('registration')({ value: 'a'.repeat(64) });
    },
    unregister: async () => { calls.unregister++; },
  };
  const supabase = { rpc: async (name, args) => {
    assert.equal(name, 'set_native_push_registration');
    calls.rpc.push(args);
    if (options.writeGate && args.p_enabled) await options.writeGate;
    if (options.failDetach && !args.p_enabled) return { data: null, error: {} };
    if (options.failWrite) return { data: null, error: { message: 'private detail' } };
    const old = rows.get(args.p_installation_id);
    if (old && old.p_revision >= args.p_revision) return { data: false, error: null };
    rows.set(args.p_installation_id, args);
    return { data: true, error: null };
  } };
  const imports = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => options.platform !== 'web',
      getPlatform: () => options.platform ?? 'ios', isPluginAvailable: () => true } },
    '@capacitor/push-notifications': { PushNotifications: plugin },
    '../lib/supabase': { supabase },
    '../auth/sessionLifecycle': { sessionGeneration: () => generation,
      isSessionGenerationCurrent: value => value === generation,
      registerBeforeSignOut: handler => { cleanup = handler; } },
  };
  const service = load('src/services/nativePushService.ts', imports, {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  return { service, calls, rows, storage, events, imports, logout: async () => { generation++; await cleanup(); } };
}
test('only native iOS routes to APNs', () => {
  assert.equal(setup().service.isNativeIOS(), true);
  assert.equal(setup({ platform: 'web' }).service.isNativeIOS(), false);
  assert.equal(setup({ platform: 'android' }).service.isNativeIOS(), false);
});
test('permission dialog grants permission before registering and persisting', async () => {
  const f = setup({ permission: 'prompt' });
  await f.service.setNativePushUser('account-A');
  await f.service.enableNativePush();
  assert.equal(f.calls.request, 1);
  assert.equal(f.calls.register, 1);
  assert.equal(f.calls.rpc[0].p_device_token, 'a'.repeat(64));
  assert.equal(f.service.nativePushState(), 'enabled');
});
test('denied permission never registers or writes a token', async () => {
  const f = setup({ permission: 'prompt', requestResult: 'denied' });
  await f.service.setNativePushUser('account-A');
  await assert.rejects(f.service.enableNativePush(), /denied/);
  assert.equal(f.calls.register, 0);
  assert.equal(f.calls.rpc.length, 0);
  assert.equal(f.service.nativePushState(), 'denied');
});
test('registrationError is sanitized and reflected in settings', async () => {
  const f = setup({ registrationError: true });
  await f.service.setNativePushUser('account-A');
  await assert.rejects(f.service.enableNativePush(), /registration failed/);
  assert.equal(f.service.nativePushState(), 'failed');
  assert.equal(f.calls.rpc.length, 0);
});
test('backend failure never reports enabled', async () => {
  const f = setup({ failWrite: true });
  await f.service.setNativePushUser('account-A');
  await assert.rejects(f.service.enableNativePush(), /registration failed/);
  assert.equal(f.service.nativePushState(), 'failed');
});
test('repeat registration and token rotation update one installation', async () => {
  const f = setup();
  await f.service.setNativePushUser('account-A');
  await f.service.enableNativePush();
  await f.service.enableNativePush();
  f.events.get('registration')({ value: 'b'.repeat(64) });
  await tick();
  assert.equal(f.rows.size, 1);
  assert.equal([...f.rows.values()][0].p_device_token, 'b'.repeat(64));
  assert.ok(f.calls.rpc[2].p_revision > f.calls.rpc[1].p_revision);
});
test('logout detaches before signOut and late callbacks cannot reattach', async () => {
  const f = setup();
  await f.service.setNativePushUser('account-A');
  await f.service.enableNativePush();
  await f.logout();
  assert.equal(f.calls.rpc.at(-1).p_enabled, false);
  const count = f.calls.rpc.length;
  f.events.get('registration')({ value: 'b'.repeat(64) });
  await tick();
  assert.equal(f.calls.rpc.length, count);
  assert.equal(f.service.nativePushState(), 'not-requested');
});
test('logout waits for in-flight persistence then sends a newer detach revision', async () => {
  let release;
  const f = setup({ writeGate: new Promise(resolve => { release = resolve; }) });
  await f.service.setNativePushUser('account-A');
  const enabling = f.service.enableNativePush();
  const rejected = assert.rejects(enabling, /cancelled/);
  await tick();
  const logout = f.logout();
  release();
  await logout; await rejected;
  assert.equal(f.calls.rpc.at(-1).p_enabled, false);
  assert.ok(f.calls.rpc.at(-1).p_revision > f.calls.rpc[0].p_revision);
  assert.equal([...f.rows.values()][0].p_enabled, false);
});
test('offline detach rejects logout for retry', async () => {
  const f = setup({ failDetach: true });
  await f.service.setNativePushUser('account-A'); await f.service.enableNativePush();
  await assert.rejects(f.logout(), /could not be saved/);
  assert.equal(f.service.nativePushState(), 'failed');
});
test('switching accounts detaches and requires explicit new opt-in', async () => {
  const f = setup();
  await f.service.setNativePushUser('account-A'); await f.service.enableNativePush();
  await f.service.setNativePushUser('account-B');
  assert.equal(f.service.nativePushState(), 'not-requested');
  assert.equal(f.calls.rpc.at(-1).p_enabled, false);
  assert.equal(f.calls.register, 1);
  await f.service.enableNativePush();
  assert.equal(f.calls.register, 2);
  assert.equal(f.rows.size, 1);
});
test('new install logout does not require the undeployed backend', async () => {
  const f = setup();
  await f.service.setNativePushUser('account-A'); await f.logout();
  assert.equal(f.calls.rpc.length, 0);
});
test('foreground events are received and taps only route to allowlisted pages', async () => {
  const f = setup();
  await f.service.setNativePushUser('account-A'); await f.service.enableNativePush();
  f.events.get('pushNotificationReceived')({ data: {} });
  f.events.get('pushNotificationActionPerformed')({ notification: { data: { url: 'https://evil.example' } } });
  assert.equal(f.service.consumeNativePushPath(), undefined);
  f.events.get('pushNotificationActionPerformed')({ notification: { data: { url: '/history' } } });
  assert.equal(f.service.consumeNativePushPath(), '/history');
  assert.equal(f.service.consumeNativePushPath(), undefined);
});
test('web enable still uses permission, service worker, PushManager and push_subscriptions', async () => {
  let requested = 0, subscribed = 0, written = 0;
  const subscription = { toJSON: () => ({ endpoint: 'https://push.example', keys: { p256dh: 'key', auth: 'auth' } }) };
  const imports = {
    '../lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'web-user' } } }) },
      from: table => { assert.equal(table, 'push_subscriptions'); return { upsert: async value => {
        assert.equal(value.user_id, 'web-user'); assert.equal(value.endpoint, 'https://push.example'); written++; return { error: null };
      } }; },
    } },
    '../stores/appStore': { useAppStore: { getState: () => ({ language: 'en' }) } },
    '../i18n': { translate: (_lang, key) => key },
    './nativePushService': { isNativeIOS: () => false },
  };
  const service = load('src/services/pushService.ts', imports, {
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => null, subscribe: async () => { subscribed++; return subscription; },
    } }) } },
    Notification: { requestPermission: async () => { requested++; return 'granted'; } },
    window: { PushManager: {}, Notification: {}, atob },
  });
  await service.enablePushNotifications('Hamar');
  assert.equal(requested, 1); assert.equal(subscribed, 1); assert.equal(written, 1);
});

test('APNs JWT is a verifiable ES256 token and transport forces HTTP/2 production', async () => {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  const env = { APNS_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----`,
    APNS_KEY_ID: 'test-key-id', APNS_TEAM_ID: 'test-team', APNS_TOPIC: 'no.strandeconsulting.sleepy' };
  let closed = false;
  const service = load('supabase/functions/_shared/apns.ts', {}, {
    Deno: { env: { get: key => env[key] }, createHttpClient: options => {
      assert.equal(options.http2, true); assert.equal(options.http1, false); return { close: () => { closed = true; } };
    } },
    fetch: async (url, options) => {
      assert.equal(url, `https://api.push.apple.com/3/device/${'a'.repeat(64)}`);
      assert.equal(options.headers['apns-topic'], 'no.strandeconsulting.sleepy');
      assert.equal(options.headers['apns-push-type'], 'alert');
      assert.equal(JSON.parse(options.body).aps.alert.title, 'Sleepy');
      return { status: 200, text: async () => '' };
    },
  });
  const jwt = await service.apnsAuthorization();
  const [header, payload, signature] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, 'test-team');
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey,
    Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)), true);
  assert.equal(await service.sendApns('a'.repeat(64), { title: 'Sleepy', body: 'Test', url: '/' }), 200);
  assert.equal(closed, true);
});
