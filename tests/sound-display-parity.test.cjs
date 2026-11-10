const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vectors = require('../scripts/sound-parity-vectors.cjs');
const display = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/sound/displayLevel.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(display);
test('Swift parity fixtures equal the actual unchanged TypeScript detector results', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, '../ios/NativeSoundCore/Tests/NativeSoundCoreTests/Fixtures/detector-vectors.json'), 'utf8'));
  assert.deepEqual(saved, vectors);
});
test('display dBFS mapping is monotonic, clamped, and never changes input values', () => {
  const db = [-90, -70, -60, -45, -30, -20, -10, 0];
  const values = db.map(value => display.soundDisplayTarget(10 ** (value / 20)));
  assert.ok(values.every((value, i) => value >= 0 && value <= 1 && (i === 0 || value >= values[i - 1])));
  assert.ok(values[2] < values[3] && values[3] < values[4] && values[4] < values[5]);
  assert.equal(values[6], 1); assert.equal(display.soundDisplayTarget(NaN), 0); assert.equal(display.soundDisplayTarget(0), 0);
  assert.equal(display.soundDisplayTarget(-1), 0);
});
test('visual envelope attacks faster than it decays and remains bounded at 60ms cadence', () => {
  const envelope = new display.SoundDisplayEnvelope(); const peak = envelope.update(1, 60);
  const decayed = envelope.update(0, 60);
  assert.ok(peak > .9); assert.ok(peak - decayed < peak);
  assert.ok(decayed > .5 && decayed < peak);
  for (let i = 0; i < 100; i++) assert.ok(envelope.update(i % 2 ? 0 : 1, 60) <= 1);
});
