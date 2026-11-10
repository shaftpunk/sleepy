const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function load(name, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src/services', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: key => imports[key] });
  return exports;
}

test('session sync copies only access token and clears native storage before sign-out', async () => {
  const calls = [];
  let beforeSignOut;
  const service = load('nativeSleepSession', {
    './liveActivityService': { liveActivitiesSupported: () => true, liveActivityBridge: {
      setAuthSession: async data => calls.push({ ...data }), clearAuthSession: async () => calls.push('clear'),
    } },
    '../auth/sessionLifecycle': { registerBeforeSignOut: cb => { beforeSignOut = cb; } },
    '../lib/supabase': { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-key' },
  });
  const session = { user: { id: 'owner' }, access_token: 'access', refresh_token: 'never-copy', expires_at: 123 };
  await service.synchronizeNativeSleepSession(session);
  assert.deepEqual(calls, [{ userId: 'owner', accessToken: 'access', expiresAt: 123, url: 'https://example.supabase.co', anonKey: 'public-key' }]);
  const queuedRefresh = service.synchronizeNativeSleepSession({ ...session, access_token: 'rotated' });
  await beforeSignOut();
  await queuedRefresh;
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'clear');
});

test('React command notifies only for the exact confirmed ended sleep', async () => {
  const at = '2026-11-10T16:00:00Z';
  let result = { data: { id: 'sleep', endtime: at }, error: null }, notified = 0;
  const command = load('endSleepCommand', {
    '../lib/supabase': { supabase: { rpc: (name, args) => {
      assert.equal(name, 'end_sleep'); assert.equal(args.p_sleep_id, 'sleep'); assert.equal(args.p_ended_at, at);
      return { single: async () => result };
    } } },
    './sleepPresentationEvents': { notifySleepPresentationChanged: () => { notified++; } },
  });
  assert.equal((await command.endSleep('sleep', at)).endtime, at);
  for (const error of [Error('offline'), Error('expired auth'), Error('server error')]) {
    result = { error, data: null };
    await assert.rejects(command.endSleep('sleep', at), error);
  }
  for (const data of [{ id: 'other', endtime: at }, { id: 'sleep', endtime: null }]) {
    result = { data, error: null };
    await assert.rejects(command.endSleep('sleep', at), /not confirmed/);
  }
  assert.equal(notified, 1);
});
