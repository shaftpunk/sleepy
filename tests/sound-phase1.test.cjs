// No test dependency added. Transpile these pure TS modules with the project's
// TypeScript and evaluate using Node's built-in test runner.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, globals = {}, imports = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require: (name) => imports[name], Date, Math, Number,
    Float32Array, DOMException, setInterval, clearInterval, ...globals });
  return exports;
}
const detector = load('src/sound/detector.ts');
const { SoundDetector, THRESHOLDS } = detector;
const base = Date.parse('2026-09-08T10:00:00Z');
function setup() { const events = []; return { events, d: new SoundDetector(THRESHOLDS.medium, e => events.push(e)) }; }
function sample(d, level, from, to) { for (let t = from; t <= to; t += 100) d.sample(level, base + t); }

test('quiet produces no events', () => {
  const { d, events } = setup(); sample(d, 0.01, 0, 10000); d.flush(base + 10000); assert.equal(events.length, 0);
});
test('short noises do not accumulate into sustained sound', () => {
  const { d, events } = setup(); sample(d, .2, 0, 1900); d.sample(0, base + 2000);
  sample(d, .2, 2100, 4000); d.flush(base + 4000); assert.equal(events.length, 0);
});
test('two seconds starts; 2.5 seconds quiet closes one event', () => {
  const { d, events } = setup(); sample(d, .2, 0, 2000); assert.equal(d.detected, true);
  sample(d, 0, 2100, 4500); assert.equal(events.length, 0); d.sample(0, base + 4600);
  assert.equal(events.length, 1); assert.equal(events[0].started_at, new Date(base).toISOString());
  assert.equal(events[0].ended_at, new Date(base + 2100).toISOString());
  assert.ok(events[0].avg_level > 0 && events[0].avg_level <= .2); assert.equal(events[0].max_level, .2);
});
test('brief quiet bridges a single event', () => {
  const { d, events } = setup(); sample(d, .2, 0, 2500); sample(d, 0, 2600, 3500);
  sample(d, .3, 3600, 5000); d.flush(base + 5000); assert.equal(events.length, 1); assert.equal(events[0].max_level, .3);
});
test('stop flushes once, but drops unconfirmed sound', () => {
  const { d, events } = setup(); sample(d, .2, 0, 2300); d.flush(base + 2300); d.flush(base + 2400);
  sample(d, .2, 2500, 3000); d.flush(base + 3000); assert.equal(events.length, 1);
});
test('sampling gaps never manufacture long events', () => {
  const { d, events } = setup(); sample(d, .2, 0, 2300); d.sample(.2, base + 60000);
  assert.equal(events.length, 1); assert.equal(events[0].ended_at, new Date(base + 2300).toISOString());
  d.flush(base + 60000); assert.equal(events.length, 1);
});
test('sensitivity levels are ordered; invalid samples ignored', () => {
  assert.ok(THRESHOLDS.low > THRESHOLDS.medium && THRESHOLDS.medium > THRESHOLDS.high);
  const { d, events } = setup(); d.sample(NaN, base); d.sample(.2, NaN); d.flush(base); assert.equal(events.length, 0);
});
test('separate sustained sounds produce separate events', () => {
  const { d, events } = setup(); sample(d, .2, 0, 2200); sample(d, 0, 2300, 5000);
  sample(d, .3, 5100, 7400); sample(d, 0, 7500, 10200); assert.equal(events.length, 2);
});

function browser(getMedia, contextState = 'running') {
  let stops = 0, closes = 0, disconnects = 0;
  let interval = null;
  const listeners = new Map();
  const track = { stop() { stops++; }, addEventListener() {}, removeEventListener() {} };
  class Context {
    state = contextState;
    resume() { return Promise.resolve(); }
    close() { closes++; this.state = 'closed'; return Promise.resolve(); }
    addEventListener() {} removeEventListener() {}
    createMediaStreamSource() { return { connect() {}, disconnect() { disconnects++; } }; }
    createAnalyser() { return { fftSize: 2048, disconnect() { disconnects++; }, getFloatTimeDomainData(buf) { buf.fill(0); } }; }
  }
  const globals = {
    AudioContext: Context,
    window: { isSecureContext: true, AudioContext: Context, addEventListener() {}, removeEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: () => getMedia({ getTracks: () => [track] }) } },
    document: { hidden: false, addEventListener(n, f) { listeners.set(n, f); }, removeEventListener(n) { listeners.delete(n); } },
    setInterval(fn) { interval = fn; return 1; }, clearInterval() { interval = null; },
  };
  const { SoundMonitor } = load('src/services/soundMonitorService.ts', globals, { '../sound/detector': detector });
  const states = []; const monitor = new SoundMonitor('medium', () => {}, state => states.push(state));
  return { monitor, states, globals, counts: () => ({ stops, closes, disconnects, interval, listeners: listeners.size }) };
}
test('stop releases tracks/context/timer/listeners exactly once', async () => {
  const b = browser(stream => Promise.resolve(stream)); await b.monitor.start();
  assert.equal(b.states.at(-1).status, 'listening'); b.monitor.stop(); b.monitor.stop();
  assert.deepEqual(b.counts(), { stops: 1, closes: 1, disconnects: 2, interval: null, listeners: 0 });
});
test('permission denied is caught; context cleaned', async () => {
  const b = browser(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));
  await b.monitor.start(); assert.equal(b.states.at(-1).status, 'blocked'); assert.equal(b.counts().closes, 1);
});
test('late permission grant after unmount releases the acquired track', async () => {
  let resolve; const b = browser(stream => new Promise(r => { resolve = () => r(stream); }));
  const pending = b.monitor.start(); b.monitor.stop(); resolve(); await pending;
  assert.equal(b.counts().stops, 1); assert.equal(b.counts().closes, 1); assert.equal(b.counts().interval, null);
});
test('suspended audio never reports listening', async () => {
  const b = browser(stream => Promise.resolve(stream), 'suspended'); await b.monitor.start();
  assert.equal(b.states.at(-1).status, 'paused'); assert.equal(b.counts().stops, 1);
});
