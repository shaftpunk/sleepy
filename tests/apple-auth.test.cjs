const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto, createHash } = require('node:crypto');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => imports[name], crypto: webcrypto,
    TextEncoder, Uint8Array, ...globals });
  return exports;
}
function fixture({ platform = 'ios', native = true, available = true, credential, failure, exchangeError, metadata = {}, profileName = null, profileError = null, concurrentName } = {}) {
  const calls = { apple: [], exchange: [], names: [], profiles: 0 };
  const profile = { user_id: 'user-uuid', display_name: profileName };
  const user = { id: 'user-uuid', user_metadata: metadata };
  const session = { user };
  const service = load('src/services/appleAuthService.ts', {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, isPluginAvailable: () => available } },
    '@capawesome/capacitor-apple-sign-in': {
      ErrorCode: { SignInCanceled: 'SIGN_IN_CANCELED' }, SignInScope: { Email: 'EMAIL', FullName: 'FULL_NAME' },
      AppleSignIn: { signIn: async options => { calls.apple.push(options); if (failure) throw failure;
        return credential ?? { idToken: 'test-token', givenName: null, familyName: null }; } },
    },
    '../lib/supabase': { supabase: {
      auth: {
        signInWithIdToken: async input => { calls.exchange.push(input); return { data: { user, session }, error: exchangeError }; },
        updateUser: async input => { calls.names.push(input); return { error: null }; },
      },
      from: table => {
        assert.equal(table, 'profiles');
        calls.profiles++;
        return { update: values => {
          assert.equal(typeof values.updated_at, 'string');
          return { eq: (column, value) => {
            assert.equal(column, 'user_id');
            assert.equal(value, user.id);
            return { or: async filter => {
              assert.equal(filter, 'display_name.is.null,display_name.eq.');
              if (concurrentName !== undefined) profile.display_name = concurrentName;
              if (!profileError && (profile.display_name === null || profile.display_name === '')) {
                profile.display_name = values.display_name;
              }
              return { error: profileError };
            } };
          } };
        } };
      },
    } },
  });
  return { service, calls, session, profile };
}
test('only native iOS with installed plugin is supported', () => {
  assert.equal(fixture().service.appleSignInSupported(), true);
  for (const options of [{ native: false }, { platform: 'web' }, { platform: 'android' }, { available: false }]) {
    assert.equal(fixture(options).service.appleSignInSupported(), false);
  }
});
test('unsupported platforms never start Apple auth', async () => {
  const { service, calls } = fixture({ platform: 'web' });
  await assert.rejects(service.signInWithApple(), /unavailable/);
  assert.equal(calls.apple.length, 0);
});
test('cancellation returns null and never exchanges a token', async () => {
  const { service, calls } = fixture({ failure: { code: 'SIGN_IN_CANCELED' } });
  assert.equal(await service.signInWithApple(), null);
  assert.equal(calls.exchange.length, 0);
});
test('real Apple failures are sanitized, not treated as cancellation', async () => {
  const { service } = fixture({ failure: { code: 'FAILED', message: 'sensitive detail' } });
  await assert.rejects(service.signInWithApple(), /^Error: Apple sign-in failed/);
});
test('missing identity token never calls Supabase', async () => {
  const { service, calls } = fixture({ credential: { idToken: '' } });
  await assert.rejects(service.signInWithApple(), /identity token/);
  assert.equal(calls.exchange.length, 0);
});
test('Apple receives one SHA-256 hash and Supabase receives the original unique nonce', async () => {
  const { service, calls, session } = fixture();
  const result = await service.signInWithApple();
  assert.equal(result.session, session);
  await service.signInWithApple();
  for (let i = 0; i < 2; i++) {
    assert.equal(calls.exchange[i].provider, 'apple');
    assert.equal(calls.exchange[i].token, 'test-token');
    assert.match(calls.exchange[i].nonce, /^[a-f0-9]{64}$/);
    assert.equal(calls.apple[i].nonce, createHash('sha256').update(calls.exchange[i].nonce).digest('hex'));
  }
  assert.notEqual(calls.exchange[0].nonce, calls.exchange[1].nonce);
});
test('Supabase errors prevent profile writes and are sanitized', async () => {
  const { service, calls } = fixture({ exchangeError: { message: 'sensitive' } });
  await assert.rejects(service.signInWithApple(), /establish/);
  assert.equal(calls.profiles, 0);
});
test('first Apple name is saved; existing name and returning empty name are preserved', async () => {
  const credential = { idToken: 'test', givenName: 'Test', familyName: 'Parent' };
  const first = fixture({ credential });
  await first.service.signInWithApple();
  assert.equal(first.calls.names[0].data.display_name, 'Test Parent');
  assert.equal(first.profile.display_name, 'Test Parent');
  const existing = fixture({ credential, metadata: { display_name: 'Existing' } });
  await existing.service.signInWithApple();
  assert.equal(existing.calls.names.length, 0);
  const returning = fixture();
  await returning.service.signInWithApple();
  assert.equal(returning.calls.names.length, 0);
  assert.equal(returning.calls.profiles, 0);
});
test('profile updates preserve every existing nonempty name, including relay/email fallback', async () => {
  for (const profileName of ['Existing parent', 'relay-prefix', 'ordinary-email-prefix']) {
    const result = fixture({ profileName, credential: { idToken: 'test', givenName: 'Apple', familyName: 'Name' } });
    await result.service.signInWithApple();
    assert.equal(result.profile.display_name, profileName);
  }
});
test('first-consent name fills a blank profile once and remains intact on repeat login', async () => {
  const result = fixture({ profileName: '', credential: { idToken: 'test', givenName: 'Apple', familyName: 'Parent' } });
  await result.service.signInWithApple();
  assert.equal(result.profile.display_name, 'Apple Parent');
  await result.service.signInWithApple();
  assert.equal(result.profile.display_name, 'Apple Parent');
});
test('a concurrent nonempty profile edit is preserved by the conditional update', async () => {
  const result = fixture({ concurrentName: 'Edited elsewhere', credential: { idToken: 'test', givenName: 'Apple' } });
  await result.service.signInWithApple();
  assert.equal(result.profile.display_name, 'Edited elsewhere');
});
test('authenticated profile update errors are sanitized without fallback inserts or RPC', async () => {
  const result = fixture({ profileError: { message: 'private error details' }, credential: { idToken: 'test', givenName: 'Apple' } });
  await assert.rejects(result.service.signInWithApple(), /^Error: Signed in, but your profile name could not be saved\.$/);
  assert.equal(result.profile.display_name, null);
});
test('logout invalidates pending registration before authenticated cleanup; hook can detach', async () => {
  const lifecycle = load('src/auth/sessionLifecycle.ts');
  const before = lifecycle.sessionGeneration();
  let detached = 0;
  const remove = lifecycle.registerBeforeSignOut(async () => {
    assert.equal(lifecycle.isSessionGenerationCurrent(before), false);
    detached++;
  });
  await lifecycle.prepareSignOut();
  assert.equal(detached, 1);
  remove();
  await lifecycle.prepareSignOut();
  assert.equal(detached, 1);
});
test('failed authenticated detach rejects so the caller can retry before signing out', async () => {
  const lifecycle = load('src/auth/sessionLifecycle.ts');
  lifecycle.registerBeforeSignOut(async () => { throw new Error('offline'); });
  await assert.rejects(lifecycle.prepareSignOut(), /offline/);
});
test('account reset clears baby data and selection without removing shared records', () => {
  const storage = new Map([['sleepy_current_baby_id', 'old-baby']]);
  let state;
  const store = load('src/stores/appStore.ts', {
    zustand: { create: init => { state = init(update => { state = { ...state, ...update }; }); return {}; } },
  }, { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  assert.ok(store.useAppStore);
  state.clearAccountState();
  assert.equal(state.currentBabyId, null);
  assert.equal(state.babies.length, 0);
  assert.equal(storage.has('sleepy_current_baby_id'), false);
});
