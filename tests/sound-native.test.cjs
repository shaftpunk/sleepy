const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => imports[name], Date, Math, Number, Float32Array, DOMException, ...globals });
  return exports;
}
function fixture({ native = true, platform = 'ios', secure = true, available = true, failure, pending = false, hidden = false } = {}) {
  const lifecycle = load('src/auth/sessionLifecycle.ts');
  const documentListeners = new Map(), windowListeners = new Map(), trackListeners = new Map(), contextListeners = new Map();
  let requests = 0, contexts = 0, stops = 0, closes = 0, disconnects = 0, resumed = 0, tick = null, resolve;
  let now = Date.parse('2026-11-10T10:00:00Z');
  class TestDate extends Date { static now() { return now; } }
  const track = { stop() { stops++; }, addEventListener: (key, cb) => trackListeners.set(key, cb), removeEventListener: key => trackListeners.delete(key) };
  const stream = { getTracks: () => [track] };
  const analyser = { fftSize: 0, disconnect() { disconnects++; }, getFloatTimeDomainData: buffer => buffer.fill(.2) };
  const context = { state: 'running', resume() { resumed++; return Promise.resolve(); }, close() { closes++; context.state = 'closed'; return Promise.resolve(); },
    addEventListener: (key, cb) => contextListeners.set(key, cb), removeEventListener: key => contextListeners.delete(key),
    createMediaStreamSource: () => ({ connect: target => assert.equal(target, analyser), disconnect() { disconnects++; } }), createAnalyser: () => analyser };
  function Context() { contexts++; return context; }
  const document = { hidden, addEventListener: (key, cb) => documentListeners.set(key, cb), removeEventListener: key => documentListeners.delete(key) };
  const globals = {
    Date: TestDate, AudioContext: Context, window: { isSecureContext: secure, AudioContext: Context, addEventListener: (key, cb) => windowListeners.set(key, cb), removeEventListener: key => windowListeners.delete(key) },
    navigator: { mediaDevices: available ? { getUserMedia(options) {
      requests++; assert.deepEqual(JSON.parse(JSON.stringify(options)), { audio: true });
      if (failure) return Promise.reject(new DOMException('Private hardware error', failure));
      return pending ? new Promise(r => { resolve = () => r(stream); }) : Promise.resolve(stream);
    } } : undefined }, document,
    setInterval: fn => { tick = fn; return 1; }, clearInterval: () => { tick = null; },
  };
  const service = load('src/services/soundMonitorService.ts', {
    '../sound/detector': load('src/sound/detector.ts'), '../auth/sessionLifecycle': lifecycle,
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native, getPlatform: () => platform } },
  }, globals);
  const states = [], events = [];
  const monitor = new service.SoundMonitor('medium', event => events.push(event), state => states.push(state));
  return { monitor, states, events, lifecycle, document, context, documentListeners, trackListeners, contextListeners,
    service, resolve: () => resolve(), tick: () => { now += 100; tick?.(); }, counts: () => ({ requests, contexts, stops, closes, disconnects, resumed, timer: Boolean(tick) }) };
}
test('native detection is iOS-only, not Android or a browser with an iOS platform string', () => {
  assert.equal(fixture().service.isNativeSoundIOS(), true);
  assert.equal(fixture({ native: false }).service.isNativeSoundIOS(), false);
  assert.equal(fixture({ platform: 'android' }).service.isNativeSoundIOS(), false);
});
test('web retains HTTPS gating and never requests microphone from an insecure origin', async () => {
  const f = fixture({ native: false, secure: false }); await f.monitor.start();
  assert.equal(f.states.at(-1).status, 'unsupported'); assert.equal(f.counts().requests, 0);
});
test('secure web uses the same audio-only acquisition and analyser pipeline', async () => {
  const f = fixture({ native: false }); await f.monitor.start();
  assert.equal(f.states.at(-1).status, 'listening'); assert.equal(f.counts().requests, 1);
  assert.equal(f.documentListeners.has('pause'), false); f.monitor.stop();
});
test('native local origin uses real WKWebView APIs without a browser HTTPS gate', async () => {
  const f = fixture({ secure: false }); await f.monitor.start();
  assert.equal(f.states[0].status, 'starting'); assert.equal(f.states.at(-1).status, 'listening');
  assert.equal(f.counts().requests, 1); assert.equal(f.counts().contexts, 1); f.monitor.stop();
});
test('missing WKWebView capture API reports unavailable, never browser unsupported', async () => {
  const f = fixture({ available: false, secure: false }); await f.monitor.start();
  assert.equal(f.states.at(-1).status, 'unavailable'); assert.equal(f.counts().contexts, 0);
});
for (const [failure, status] of [['NotAllowedError', 'blocked'], ['SecurityError', 'unavailable'], ['NotFoundError', 'unavailable'], ['NotReadableError', 'error'], ['AbortError', 'error']]) {
  test(`native ${failure} is safely mapped to ${status} and resources released`, async () => {
    const f = fixture({ failure }); await f.monitor.start();
    assert.equal(f.states.at(-1).status, status); assert.equal(f.counts().closes, 1);
    assert.equal(f.documentListeners.size, 0); assert.ok(!JSON.stringify(f.states).includes('Private hardware error'));
    await f.monitor.start(); assert.equal(f.counts().requests, 1); // One attempt per instance; no automatic reprompt.
  });
}
test('duplicate start during permission and after grant never creates another stream/context', async () => {
  const f = fixture({ pending: true }); const first = f.monitor.start(); await f.monitor.start();
  assert.equal(f.counts().requests, 1); f.resolve(); await first; await f.monitor.start();
  assert.equal(f.counts().contexts, 1); f.monitor.stop(); f.monitor.stop();
  assert.equal(f.counts().stops, 1); assert.equal(f.counts().closes, 1); assert.equal(f.counts().disconnects, 2);
  assert.equal(f.trackListeners.size + f.contextListeners.size + f.documentListeners.size, 0);
});
test('repeated fresh start/stop cycles release all resources', async () => {
  for (let i = 0; i < 5; i++) { const f = fixture(); await f.monitor.start(); f.monitor.stop();
    assert.equal(f.counts().timer, false); assert.equal(f.counts().stops, 1); assert.equal(f.counts().closes, 1); }
});
test('unmount/stop while permission is pending releases the late stream', async () => {
  const f = fixture({ pending: true }); const request = f.monitor.start(); f.monitor.stop(); f.resolve(); await request;
  assert.equal(f.counts().stops, 1); assert.equal(f.counts().closes, 1); assert.equal(f.counts().timer, false);
  assert.ok(!f.states.some(state => state.status === 'listening'));
});
test('logout stops capture before signOut and unregisters its cleanup handler', async () => {
  const f = fixture(); await f.monitor.start(); await f.lifecycle.prepareSignOut();
  assert.equal(f.counts().stops, 1); assert.equal(f.states.at(-1).status, 'paused');
  await f.lifecycle.prepareSignOut(); assert.equal(f.counts().stops, 1);
});
test('session/account switch cancels pending capture and stops running capture', async () => {
  const f = fixture({ pending: true }); const request = f.monitor.start();
  f.lifecycle.invalidateSessionWork(); f.resolve(); await request; assert.equal(f.counts().stops, 1);
  const running = fixture(); await running.monitor.start(); running.lifecycle.invalidateSessionWork(); running.tick();
  assert.equal(running.counts().stops, 1); assert.equal(running.states.at(-1).status, 'paused');
});
test('native pause during permission prevents late capture, even after foregrounding', async () => {
  const f = fixture({ pending: true }); const request = f.monitor.start(); f.documentListeners.get('pause')();
  f.resolve(); await request; assert.equal(f.states.at(-1).status, 'paused'); assert.equal(f.counts().stops, 1);
});
for (const event of ['pause', 'visibilitychange', 'mute', 'ended', 'statechange']) test(`${event} releases capture and never auto-resumes`, async () => {
  const f = fixture(); await f.monitor.start();
  if (event === 'visibilitychange') f.document.hidden = true;
  if (event === 'statechange') f.context.state = 'suspended';
  const listeners = ['mute', 'ended'].includes(event) ? f.trackListeners : event === 'statechange' ? f.contextListeners : f.documentListeners;
  listeners.get(event)(); assert.equal(f.states.at(-1).status, 'paused'); assert.equal(f.counts().stops, 1);
  assert.equal(f.counts().timer, false); assert.equal(f.documentListeners.has('resume'), false);
});
test('already backgrounded start does not acquire input', async () => {
  const f = fixture({ hidden: true }); await f.monitor.start(); assert.equal(f.counts().requests, 0);
  assert.equal(f.states.at(-1).status, 'paused');
});
test('only derived RMS observations leave the analysis service; no raw sample buffers', async () => {
  const f = fixture(); await f.monitor.start(); for (let i = 0; i < 30; i++) f.tick();
  assert.ok(Math.abs(f.states.at(-1).level - .2) < .00001);
  assert.deepEqual(Object.keys(f.states.at(-1)).sort(), ['level', 'status']);
  f.monitor.stop(); // No recording/file/network API exists in this fixture.
  assert.equal(f.events.length, 1);
  assert.ok(f.events.every(event => Object.keys(event).sort().join(',') === 'avg_level,ended_at,max_level,started_at'));
});
