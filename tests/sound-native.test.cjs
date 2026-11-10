const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, imports, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: name => imports[name], crypto: webcrypto, Date, Math, Number,
    console: { info() {} }, ...globals }); return exports;
}
function fixture({ failSave = false, writeGate, startGate, native = true, leaseFail = false } = {}) {
  const events = new Map(), queue = [], writes = [], acks = [];
  let authUser = 'A', now = 1700000000000, fail = failSave;
  const calls = { starts: 0, stops: 0 };
  let actual = { active: false, running: false, status: 'off', queueCount: 0 };
  let cleanup, generation = 0;
  const document = { hidden: false };
  class Clock extends Date { static now() { return now; } }
  const plugin = {
    addListener: async (name, callback) => { events.set(name, callback); return { remove: async () => events.delete(name) }; },
    getState: async () => ({ ...actual, queueCount: queue.length }),
    start: async options => { calls.starts++; actual = { ...options, active: true, running: true, status: 'starting' }; if (startGate) await startGate; },
    stop: async options => { assert.equal(options.runId, actual.runId); calls.stops++; actual = { ...actual, active: false, running: false, status: 'off' }; },
    getEvents: async ({ userId }) => ({ events: queue.filter(e => e.created_by_user_id === userId).slice(0, 20) }),
    acknowledge: async ({ userId, ids }) => { acks.push(...ids); for (let i = queue.length - 1; i >= 0; i--) if (queue[i].created_by_user_id === userId && ids.includes(queue[i].id)) queue.splice(i, 1); },
  };
  const imports = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native, getPlatform: () => native ? 'ios' : 'web' } },
    './nativeSoundInput': { nativeSoundMeter: plugin },
    '../sound/detector': { THRESHOLDS: { low: .12, medium: .06, high: .025 } },
    '../sound/displayLevel': load('src/sound/displayLevel.ts', {}),
    '../lib/supabase': { supabase: { auth: { getUser: async () => ({ data: { user: authUser ? { id: authUser } : null }, error: null }) },
      functions: { invoke: async () => ({ data: leaseFail ? null : { url: 'https://example.supabase.co/functions/v1/sound-monitor-status', token: 'test-lease', expiresAt: now + 86400000 }, error: leaseFail ? {} : null }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'sleep', baby_id: 'baby', endtime: calls.sleepEnded ? 'ended' : null }, error: null }) }) }) }) } },
    './soundEventService': { createSoundEvent: async event => { if (writeGate) await writeGate; if (fail) throw Error('offline'); writes.push(event); } },
    '../auth/sessionLifecycle': { sessionGeneration: () => generation, isSessionGenerationCurrent: value => value === generation,
      registerBeforeSignOut: handler => { cleanup = handler; } },
  };
  const service = load('src/services/nativeSoundMonitoring.ts', imports, { document, Date: Clock });
  const options = { userId: 'A', babyId: 'baby', sleepId: 'sleep', sensitivity: 'medium' };
  return { service, calls, writes, acks, queue, document, events, options,
    setUser: value => { authUser = value; }, setOffline: value => { fail = value; },
    advance: (ms = 60) => { now += ms; }, state: () => actual,
    level: rms => events.get('level')?.({ runId: actual.runId, rms, displayRms: rms, dbFS: 20 * Math.log10(Math.max(rms, .000001)), detected: false }),
    logout: async () => { generation++; await cleanup(); },
    addEvent: (user = 'A', id = 'stable-event') => queue.push({ id, created_by_user_id: user, baby_id: 'baby', sleep_id: 'sleep', startMs: now - 3000, endMs: now, avg_level: .1, max_level: .2 }),
  };
}
async function start(f) { await f.service.reconcileNativeSound('A', 'baby', true); await f.service.startNativeSound(f.options); }
test('native start is explicit; raw detector threshold is unchanged and listeners are process scoped', async () => {
  const f = fixture(); await f.service.reconcileNativeSound('A', 'baby', true);
  assert.equal(f.calls.starts, 0); await f.service.startNativeSound(f.options);
  assert.equal(f.state().threshold, .06); assert.equal(f.events.size, 4);
  await f.service.reconcileNativeSound('A', 'baby', true); assert.equal(f.calls.starts, 1); assert.equal(f.events.size, 4);
});
test('display subscribers receive changing native levels every 60ms without scroll; cleanup and Stop fence updates', async () => {
  const f = fixture(); await start(f);
  const samples = [];
  const unsubscribe = f.service.subscribeNativeSound(() => samples.push(f.service.nativeSoundSnapshot().level));
  for (const rms of [.001, .01, .1, .7, .01]) { f.advance(60); f.level(rms); }
  assert.equal(samples.length, 5);
  assert.ok(samples[0] < samples[1] && samples[1] < samples[2] && samples[2] < samples[3]);
  assert.ok(samples[4] < samples[3]);
  unsubscribe(); f.advance(60); f.level(.8); assert.equal(samples.length, 5);
  await f.service.stopNativeSound();
  const stopped = f.service.nativeSoundSnapshot().level;
  f.advance(60); f.level(1); assert.equal(f.service.nativeSoundSnapshot().level, stopped);
  assert.equal(stopped, 0);
});

test('missing validity endpoint/network prevents capture with a session-specific error', async () => {
  const f = fixture({ leaseFail: true }); await f.service.reconcileNativeSound('A', 'baby', true);
  await assert.rejects(f.service.startNativeSound(f.options));
  assert.equal(f.calls.starts, 0); assert.equal(f.service.nativeSoundSnapshot().status, 'validation-error');
});
test('background/lock stops display updates, not monitoring; foreground adopts native state', async () => {
  const f = fixture(); await start(f); f.level(.01); const before = f.service.nativeSoundSnapshot().level;
  f.document.hidden = true; f.advance(); f.level(.6);
  assert.equal(f.service.nativeSoundSnapshot().level, before); assert.equal(f.calls.stops, 0);
  f.addEvent(); await f.service.synchronizeNativeSoundEvents(); assert.equal(f.writes.length, 0);
  f.document.hidden = false; await f.service.validateNativeSoundSleep();
  assert.equal(f.calls.starts, 1); assert.equal(f.writes.length, 1); assert.equal(f.queue.length, 0);
});
test('60ms visual coalescing does not mutate RMS or detector input', async () => {
  const f = fixture(); await start(f); f.level(.001); const first = f.service.nativeSoundSnapshot();
  f.advance(10); f.level(.5); assert.equal(f.service.nativeSoundSnapshot(), first);
  f.advance(50); f.level(.5); assert.equal(f.service.nativeSoundSnapshot().rms, .5);
  assert.ok(f.service.nativeSoundSnapshot().level > first.level);
});
test('write succeeds before acknowledgement; repeated synchronization cannot duplicate events', async () => {
  const f = fixture(); await start(f); f.addEvent();
  await Promise.all([f.service.synchronizeNativeSoundEvents(), f.service.synchronizeNativeSoundEvents()]);
  await f.service.synchronizeNativeSoundEvents(); assert.equal(f.writes.length, 1); assert.deepEqual(f.acks, ['stable-event']);
  assert.deepEqual(Object.keys(f.writes[0]).sort(), ['avg_level','baby_id','created_by_user_id','ended_at','event_type','id','max_level','sleep_id','started_at']);
});
test('offline persistence keeps native metadata unacknowledged for idempotent retry', async () => {
  const f = fixture({ failSave: true }); await start(f); f.addEvent();
  await assert.rejects(f.service.synchronizeNativeSoundEvents()); assert.equal(f.queue.length, 1); assert.equal(f.acks.length, 0);
  f.setOffline(false); await f.service.synchronizeNativeSoundEvents(); assert.equal(f.writes[0].id, 'stable-event'); assert.equal(f.queue.length, 0);
});
test('manual Stop, sleep end, settings disable and account switch stop native capture', async () => {
  for (const reason of ['manual', 'ended', 'disabled', 'account']) {
    const f = fixture(); await start(f);
    if (reason === 'manual') await f.service.stopNativeSound();
    if (reason === 'ended') { f.calls.sleepEnded = true; await f.service.validateNativeSoundSleep(); }
    if (reason === 'disabled') await f.service.reconcileNativeSound('A', 'baby', false);
    if (reason === 'account') { f.setUser('B'); await f.service.reconcileNativeSound('B', 'baby', true); }
    assert.equal(f.calls.stops, 1); assert.equal(f.service.nativeSoundSnapshot().active, false);
  }
});
test('logout stops before signOut; another account cannot drain prior metadata', async () => {
  const f = fixture(); await start(f); f.addEvent(); await f.logout(); assert.equal(f.calls.stops, 1);
  f.addEvent('A', 'old-account'); f.setUser('B'); await f.service.reconcileNativeSound('B', 'baby', true);
  assert.equal(f.queue[0].id, 'old-account'); assert.ok(f.writes.every(event => event.id !== 'old-account'));
});
test('cancelled pending start cannot restore microphone after Stop/logout', async () => {
  let release; const f = fixture({ startGate: new Promise(resolve => { release = resolve; }) });
  await f.service.reconcileNativeSound('A', 'baby', true);
  const pending = f.service.startNativeSound(f.options); await tick();
  await f.service.stopNativeSound(); release(); await pending;
  assert.equal(f.service.nativeSoundSnapshot().active, false); assert.equal(f.state().active, false);
});
test('native interruption retains session; native resume restores UI without another user start', async () => {
  const f = fixture(); await start(f);
  f.events.get('state')({ ...f.state(), status: 'paused', running: false });
  assert.equal(f.service.nativeSoundSnapshot().active, true); assert.equal(f.service.nativeSoundSnapshot().status, 'paused');
  f.events.get('state')({ ...f.state(), status: 'listening', running: true });
  assert.equal(f.service.nativeSoundSnapshot().running, true); assert.equal(f.calls.starts, 1);
});
test('Web/PWA never calls native reconcile/start APIs during lifecycle', async () => {
  const f = fixture({ native: false }); await f.service.reconcileNativeSound('A', 'baby', true); assert.equal(f.calls.starts, 0); assert.equal(f.events.size, 0);
});
