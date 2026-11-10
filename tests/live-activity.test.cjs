const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, imports, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new vm.Script(output).runInNewContext({ exports, require: name => imports[name], console: { info() {} }, ...globals });
  return exports;
}
function fixture({ native = true, failRead = false, failBridge = false, gate } = {}) {
  const calls = [], records = new Map(), document = { hidden: false }; let generation = 0, logout;
  const bridge = { reconcile: async data => { if (failBridge) throw Error('optional failure'); calls.push(['reconcile', data]); },
    endAll: async () => { calls.push(['clear']); if (failBridge) throw Error('optional failure'); } };
  const service = load('src/services/liveActivityService.ts', {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native, getPlatform: () => 'ios', isPluginAvailable: () => true }, registerPlugin: () => bridge },
    './sleepService': { getActiveSleep: async id => { if (gate) await gate; if (failRead) throw Error('offline'); return records.get(id) ?? null; } },
    '../auth/sessionLifecycle': { registerBeforeSignOut: fn => { logout = fn; }, sessionGeneration: () => generation, isSessionGenerationCurrent: value => value === generation },
  }, { document });
  return { service, calls, records, document, invalidate: () => generation++, logout: async () => { generation++; await logout(); },
    baby: { id: 'baby', name: 'Amalie' }, sleep: { id: 'sleep', baby_id: 'baby', starttime: '2026-11-10T19:48:00Z', endtime: null, deleted_at: null } };
}
test('native reconciliation uses database identities/times and all accessible babies', async () => {
  const f = fixture(); f.records.set('baby', f.sleep); f.records.set('second', { ...f.sleep, id: 'other', baby_id: 'second' });
  await f.service.configureSleepLiveActivities('owner', [f.baby, { id: 'second', name: 'Alex' }]);
  const payload = f.calls[0][1]; assert.equal(payload.sleeps.length, 2);
  assert.equal(payload.sleeps[0].startedAt, f.sleep.starttime); assert.equal(payload.sleeps[0].sleepId, 'sleep');
  assert.deepEqual(Object.keys(payload.sleeps[0]).sort(), ['babyId','babyName','sleepId','startedAt']);
});
test('successful empty database snapshot ends presentation; failed read never becomes empty', async () => {
  const empty = fixture(); await empty.service.configureSleepLiveActivities('owner', [empty.baby]);
  assert.equal(empty.calls[0][1].sleeps.length, 0);
  const failed = fixture({ failRead: true }); await failed.service.configureSleepLiveActivities('owner', [failed.baby]); assert.equal(failed.calls.length, 0);
});
test('mismatched baby data is not treated as an authoritative empty snapshot', async () => {
  const f = fixture(); f.records.set('baby', { ...f.sleep, baby_id: 'wrong' });
  await f.service.configureSleepLiveActivities('owner', [f.baby]); assert.equal(f.calls.length, 0);
});
test('web, background, and incomplete baby loading never request an activity', async () => {
  const web = fixture({ native: false }); await web.service.configureSleepLiveActivities('owner', [web.baby]); assert.equal(web.calls.length, 0);
  const f = fixture(); f.document.hidden = true; await f.service.configureSleepLiveActivities('owner', [f.baby]); assert.equal(f.calls.length, 0);
  f.document.hidden = false; await f.service.configureSleepLiveActivities('owner', []); assert.equal(f.calls.length, 0);
  await f.service.configureSleepLiveActivities('owner', [f.baby]); assert.equal(f.calls.length, 1);
});
test('bridge failures are optional, including logout cleanup', async () => {
  const f = fixture({ failBridge: true }); await f.service.configureSleepLiveActivities('owner', [f.baby]); await f.logout();
});
test('logout during a database read fences the result before clearing activities', async () => {
  let release; const f = fixture({ gate: new Promise(resolve => { release = resolve; }) }); f.records.set('baby', f.sleep);
  const started = f.service.configureSleepLiveActivities('owner', [f.baby]); await new Promise(resolve => setImmediate(resolve));
  const stopped = f.logout(); release(); await Promise.all([started, stopped]);
  assert.equal(f.calls.filter(([operation]) => operation === 'reconcile').length, 0); assert.equal(f.calls[0][0], 'clear');
});
test('account switching clears old activities before reconciling new data', async () => {
  const f = fixture(); await f.service.configureSleepLiveActivities('A', [f.baby]);
  await f.service.configureSleepLiveActivities('B', [f.baby]);
  assert.deepEqual(f.calls.map(([name]) => name), ['reconcile', 'clear', 'reconcile']);
});
test('normal stop is reflected on the next refresh without inventing elapsed state', async () => {
  const f = fixture(); f.records.set('baby', f.sleep); await f.service.configureSleepLiveActivities('owner', [f.baby]);
  f.records.set('baby', { ...f.sleep, endtime: '2026-11-10T21:00:00Z' }); await f.service.refreshSleepLiveActivities();
  assert.equal(f.calls[1][1].sleeps.length, 0);
});
function sleepWriter({ databaseError = false, presentationError = false } = {}) {
  let notifications = 0;
  const record = { id: 'sleep', baby_id: 'baby' };
  const query = () => { const q = {};
    for (const name of ['select','eq','is','order','limit','insert','update']) q[name] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.single = async () => ({ data: record, error: databaseError ? Error('DB failed') : null });
    return q;
  };
  const notifier = load('src/services/sleepPresentationEvents.ts', {}, { Event: class {}, window: { dispatchEvent() { notifications++; if (presentationError) throw Error('UI failed'); } } });
  const service = load('src/services/sleepService.ts', {
    '../lib/supabase': { supabase: { from: query, auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) } } },
    '../stores/appStore': { useAppStore: { getState: () => ({ language: 'en' }) } }, '../i18n': { translate: (_, key) => key },
    './sleepPresentationEvents': notifier,
  });
  return { service, notifications: () => notifications, record };
}
test('successful sleep writes notify optional UI only afterward; failed writes never notify', async () => {
  const good = sleepWriter(); assert.equal(await good.service.startSleep('baby'), good.record); assert.equal(good.notifications(), 1);
  const bad = sleepWriter({ databaseError: true }); await assert.rejects(bad.service.startSleep('baby')); assert.equal(bad.notifications(), 0);
  const optional = sleepWriter({ presentationError: true }); assert.equal(await optional.service.startSleep('baby'), optional.record);
  await optional.service.stopSleep('sleep', new Date(Date.now() - 60000).toISOString()); assert.equal(optional.notifications(), 2);
});
