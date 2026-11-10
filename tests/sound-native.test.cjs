const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => imports[name], Date, Math, Number, Float32Array, DOMException,
    crypto: webcrypto, console: { info() {}, warn() {} }, ...globals });
  return exports;
}
function fixture({ native = true, platform = 'ios', secure = true, available = true, failure, pending = false, hidden = false, noLevels = false, listenerGate } = {}) {
  const lifecycle = load('src/auth/sessionLifecycle.ts');
  const listeners = new Map(), documentListeners = new Map();
  const calls = { start: 0, stop: 0, removed: 0, webCapture: 0, contexts: 0, registeredName: '' };
  const logs = [];
  let now = Date.parse('2026-11-10T10:00:00Z'), timer, runId, resolve;
  class Clock extends Date { static now() { return now; } }
  const level = (rms = .2, changes = {}) => listeners.get('level')?.({ runId, rms, peak: Math.max(.3, rms), dbFS: -14,
    sampleRate: 48000, channels: 1, frameCount: 2048, bufferCount: 1, ...changes });
  const plugin = {
    async addListener(name, callback) {
      if (listenerGate) await listenerGate;
      listeners.set(name, callback);
      return { async remove() { calls.removed++; listeners.delete(name); } };
    },
    async start(options) {
      assert.equal(listeners.size, 2, 'Both listeners must exist before native start');
      runId = options.runId; calls.start++;
      if (pending) await new Promise(r => { resolve = r; });
      if (failure) throw { code: failure, message: 'Private hardware details' };
      if (!noLevels) level();
    },
    async stop(options) { if (options.runId === runId) { calls.stop++; calls.stopReason = options.reason; } },
  };
  const document = { hidden, addEventListener: (name, cb) => documentListeners.set(name, cb), removeEventListener: name => documentListeners.delete(name) };
  const globals = { Date: Clock, document, console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    window: { isSecureContext: secure, addEventListener() {}, removeEventListener() {} },
    navigator: { mediaDevices: { async getUserMedia() { calls.webCapture++; throw new Error('Must not capture on native'); } } },
    setInterval: callback => { timer = callback; return 1; }, clearInterval: () => { timer = null; } };
  const nativeModule = load('src/services/nativeSoundInput.ts', { '@capacitor/core': { registerPlugin: name => { calls.registeredName = name; return plugin; } } }, globals);
  const service = load('src/services/soundMonitorService.ts', {
    '../sound/detector': load('src/sound/detector.ts'), '../auth/sessionLifecycle': lifecycle,
    './nativeSoundInput': nativeModule,
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, isPluginAvailable: () => available } },
  }, globals);
  const states = [], events = [];
  const monitor = new service.SoundMonitor('medium', event => events.push(event), state => states.push(state));
  return { monitor, states, events, lifecycle, document, documentListeners, listeners, calls, service, level, logs,
    resolve: () => resolve(), advance: (ms = 100) => { now += ms; timer?.(); }, hasTimer: () => Boolean(timer),
    stoppedEvent: (reason = 'interrupted') => listeners.get('stopped')?.({ runId, reason }),
    input: new nativeModule.NativeSoundInput() };
}

test('native routing is iOS-only; plugin name matches Swift/bridge registration', () => {
  const f = fixture(); assert.equal(f.service.isNativeSoundIOS(), true);
  assert.equal(f.calls.registeredName, 'SleepySoundMeter');
  assert.equal(fixture({ native: false }).service.isNativeSoundIOS(), false);
  assert.equal(fixture({ platform: 'android' }).service.isNativeSoundIOS(), false);
});
test('native listeners precede capture and native never uses Web Audio or browser capture', async () => {
  const f = fixture({ secure: false }); await f.monitor.start();
  assert.equal(f.calls.start, 1); assert.equal(f.calls.webCapture, 0);
  assert.equal(f.states.at(-1).status, 'listening'); assert.equal(f.states.at(-1).level, .2);
  f.monitor.stop(); await tick(); assert.equal(f.listeners.size, 0);
});
test('missing native input plugin fails safely with native unavailable message', async () => {
  const f = fixture({ available: false }); await f.monitor.start();
  assert.equal(f.states.at(-1).status, 'unavailable'); assert.equal(f.calls.start, 0);
});
test('engine-start result alone is not a listening state; no events triggers explicit error', async () => {
  const f = fixture({ noLevels: true }); await f.monitor.start();
  assert.equal(f.states.at(-1).status, 'starting'); f.advance(3100);
  assert.equal(f.states.at(-1).status, 'error'); assert.equal(f.hasTimer(), false);
});
for (const [failure, status] of [['PERMISSION_DENIED', 'blocked'], ['UNAVAILABLE', 'unavailable'], ['START_FAILED', 'error'], ['CANCELLED', 'paused']]) {
  test(`${failure} maps to ${status}, releases listeners and does not automatically retry`, async () => {
    const f = fixture({ failure }); await f.monitor.start();
    assert.equal(f.states.at(-1).status, status); assert.equal(f.listeners.size, 0);
    await f.monitor.start(); assert.equal(f.calls.start, 1);
    assert.ok(!JSON.stringify(f.states).includes('Private hardware details'));
  });
}
test('quiet, speech and clap metadata reach state without RMS normalization or dB conversion', async () => {
  const f = fixture(); await f.monitor.start();
  for (const rms of [.0001, .025, .6]) { f.advance(300); f.level(rms); assert.equal(f.states.at(-1).level, rms); }
  f.monitor.stop();
});
test('same native values reach unchanged detector thresholds and metadata-only persistence callback', async () => {
  const f = fixture(); await f.monitor.start();
  for (let i = 0; i < 30; i++) { f.advance(); f.level(.2); }
  assert.equal(f.states.at(-1).status, 'detected'); f.monitor.stop();
  assert.equal(f.events.length, 1);
  assert.ok(Math.abs(f.events[0].avg_level - .2) < 1e-12); assert.equal(f.events[0].max_level, .2);
  assert.deepEqual(Object.keys(f.events[0]).sort(), ['avg_level', 'ended_at', 'max_level', 'started_at']);
});
test('brief clap survives UI throttling without turning a short noise into a sustained event', async () => {
  const f = fixture({ noLevels: true }); await f.monitor.start(); f.level(.001);
  f.advance(); f.level(.5); f.advance(); f.level(.001); f.advance(); f.level(.001);
  assert.equal(f.states.at(-1).level, .5); // Display-only peak within the UI update window.
  f.advance(300); f.level(.001); assert.equal(f.states.at(-1).level, .001);
  f.monitor.stop(); assert.equal(f.events.length, 0);
});
test('subthreshold native levels do not become events despite expanded visual amplitude', async () => {
  const f = fixture({ noLevels: true }); await f.monitor.start();
  for (let i = 0; i < 30; i++) { f.advance(); f.level(.01); }
  f.monitor.stop(); assert.equal(f.events.length, 0);
});
test('stale run IDs are ignored; invalid level data stops input instead of poisoning the meter', async () => {
  const f = fixture(); await f.monitor.start(); f.advance(300);
  f.level(.9, { runId: webcrypto.randomUUID() }); assert.equal(f.states.at(-1).level, .2);
  f.level(NaN); assert.equal(f.states.at(-1).status, 'paused');
  await tick(); assert.equal(f.listeners.size, 0);
});
test('zero-valued valid buffers are quiet, not a missing stream or invalid data', async () => {
  const f = fixture({ noLevels: true }); await f.monitor.start(); f.level(0);
  assert.equal(f.states.at(-1).status, 'listening'); assert.equal(f.states.at(-1).level, 0); f.monitor.stop();
});
test('duplicate start and stop remain idempotent; repeated fresh captures remove all listeners', async () => {
  for (let i = 0; i < 4; i++) {
    const f = fixture(); await f.monitor.start(); await f.monitor.start(); f.monitor.stop(); f.monitor.stop(); await tick();
    assert.equal(f.calls.start, 1); assert.equal(f.calls.stop, 1); assert.equal(f.calls.removed, 2);
    assert.equal(f.listeners.size + f.documentListeners.size, 0); assert.equal(f.hasTimer(), false);
  }
});
test('stop/unmount while permission is pending prevents any late state update', async () => {
  const f = fixture({ pending: true }); const request = f.monitor.start(); await tick();
  f.monitor.stop(); const count = f.states.length; f.resolve(); await request;
  assert.equal(f.states.length, count); assert.equal(f.listeners.size, 0); assert.equal(f.hasTimer(), false);
});
test('stop during async listener setup removes late handles and never starts capture', async () => {
  let release; const f = fixture({ listenerGate: new Promise(resolve => { release = resolve; }) });
  const request = f.input.start(() => assert.fail('Unexpected level'), () => {});
  await f.input.stop(); release(); await request;
  assert.equal(f.calls.start, 0); assert.equal(f.listeners.size, 0);
});
test('logout stops input before signOut; account switching invalidates pending/running input', async () => {
  const f = fixture(); await f.monitor.start(); await f.lifecycle.prepareSignOut(); await tick();
  assert.equal(f.states.at(-1).status, 'paused'); assert.equal(f.listeners.size, 0);
  const other = fixture(); await other.monitor.start(); other.lifecycle.invalidateSessionWork(); other.advance();
  assert.equal(other.states.at(-1).status, 'paused');
});
for (const event of ['pause', 'native-interruption', 'missing-events']) {
  test(`${event} stops foreground-only monitoring with no automatic resume`, async () => {
    const f = fixture(); await f.monitor.start();
    if (event === 'pause') f.documentListeners.get('pause')();
    if (event === 'native-interruption') f.stoppedEvent();
    if (event === 'missing-events') f.advance(1100);
    assert.equal(f.states.at(-1).status, 'paused'); await tick();
    assert.equal(f.listeners.size, 0); assert.equal(f.hasTimer(), false); assert.equal(f.documentListeners.has('resume'), false);
  });
}
test('native WebView hidden/inactive indication alone does not cancel healthy capture or permission startup', async () => {
  const f = fixture({ hidden: true }); await f.monitor.start();
  assert.equal(f.calls.start, 1); assert.equal(f.states.at(-1).status, 'listening');
  f.documentListeners.get('visibilitychange')(); f.advance(300); f.level(.025);
  assert.equal(f.states.at(-1).status, 'listening'); assert.equal(f.states.at(-1).level, .025);
  f.documentListeners.get('pause')(); // Actual background still stops.
  assert.equal(f.states.at(-1).status, 'paused'); assert.equal(f.calls.stopReason, 'capacitor-pause-background');
});
test('native stop reason survives the bridge into service diagnostics and cleanup', async () => {
  const f = fixture(); await f.monitor.start(); f.stoppedEvent('input-route-changed');
  assert.equal(f.states.at(-1).status, 'paused'); assert.equal(f.calls.stopReason, 'native:input-route-changed');
  assert.ok(f.logs.some(([message]) => message === '[Sleepy sound] stop requested reason=native:input-route-changed'));
});
test('unknown native stop reason is not logged verbatim', async () => {
  const f = fixture(); await f.monitor.start(); f.stoppedEvent('private unexpected data');
  assert.equal(f.calls.stopReason, 'native:unknown-native-stop');
  assert.ok(!JSON.stringify(f.logs).includes('private unexpected data'));
});
test('delayed first level before the existing timeout becomes active; permission wait is outside timeout', async () => {
  const f = fixture({ pending: true, noLevels: true }); const request = f.monitor.start(); await tick();
  f.advance(15000); assert.equal(f.hasTimer(), false); // No capture timeout during permission dialog.
  f.resolve(); await request; f.advance(2900); assert.equal(f.states.at(-1).status, 'starting');
  f.level(.025); f.advance(300); assert.equal(f.states.at(-1).status, 'listening');
  assert.ok(!f.logs.some(([message]) => message === '[Sleepy sound] startup timeout')); f.monitor.stop();
});
test('missing first level reports startup timeout/error, not paused or an engine-start failure', async () => {
  const f = fixture({ noLevels: true }); await f.monitor.start(); f.advance(3100);
  assert.equal(f.states.at(-1).status, 'error'); assert.equal(f.calls.stopReason, 'startup-timeout');
  assert.ok(f.logs.some(([message]) => message === '[Sleepy sound] startup timeout'));
});
test('browser keeps its secure-context gate and never enters the native bridge', async () => {
  const f = fixture({ native: false, secure: false }); await f.monitor.start();
  assert.equal(f.states.at(-1).status, 'unsupported'); assert.equal(f.calls.start, 0);
});
