const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, require: name => imports[name], ...globals });
  return exports;
}
const time = load('src/lib/sleepActionTime.ts');
function gesture(maximum = 60) {
  let now = 0, next = 0; const tasks = new Map(), offsets = []; let haptics = 0;
  const { createSleepHold } = load('src/lib/holdSleepAction.ts', { './sleepActionTime': time });
  const hold = createSleepHold({ maximum: () => maximum, select: n => offsets.push(n), haptic: () => haptics++,
    schedule(callback, delay) { tasks.set(++next, { at: now + delay, callback }); return next; }, clear: id => tasks.delete(id) });
  const advance = ms => { const end = now + ms;
    while (true) { const item = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!item || item[1].at > end) break; now = item[1].at; tasks.delete(item[0]); item[1].callback(); }
    now = end;
  };
  return { hold, offsets, advance, tasks, haptics: () => haptics };
}
test('normal tap is now, with no hold or haptics before the deliberate threshold', () => {
  for(const elapsed of [50,150,300,400,449]){
    const f = gesture(); f.hold.begin(); f.advance(elapsed);
    assert.equal(f.haptics(), 0); assert.equal(f.hold.release().kind, 'tap');
    f.advance(5000); assert.equal(f.tasks.size, 0); assert.equal(f.haptics(), 0);
  }
});
test('shared Start/Wake hold activates at 450ms, increments at 1050/1650/2250ms, caps and releases once', () => {
  assert.equal(time.HOLD_DELAY_MS,450);assert.equal(time.HOLD_STEP_MS,600);
  const f = gesture(); f.hold.begin(); f.advance(449);assert.equal(f.haptics(),0);f.advance(1); assert.equal(f.offsets.at(-1), 5);
  assert.equal(f.haptics(), 1, 'activation immediately selects five and emits one haptic');
  f.advance(599); assert.equal(f.offsets.at(-1), 5); assert.equal(f.haptics(), 1);
  f.advance(1); assert.equal(f.offsets.at(-1), 10); assert.equal(f.haptics(), 2);
  f.advance(600); assert.equal(f.offsets.at(-1), 15); assert.equal(f.haptics(), 3);
  f.advance(600);assert.equal(f.offsets.at(-1),20);assert.equal(f.haptics(),4);
  f.advance(600 * 30); assert.equal(f.offsets.at(-1), 60); assert.equal(f.haptics(), 12);
  const result = f.hold.release(); assert.equal(result.kind, 'hold'); assert.equal(result.minutes, 60);
  assert.equal(f.hold.release().kind, 'cancel'); assert.equal(f.tasks.size, 0);
});
test('movement, pointer cancellation, blur and unmount cancellation cannot commit; no timers leak', () => {
  for (const elapsed of [100, 450, 1500]) {
    const f = gesture(); f.hold.begin(); f.advance(elapsed); f.hold.cancel();
    f.advance(10000); assert.equal(f.hold.release().kind, 'cancel'); assert.equal(f.tasks.size, 0);
    f.hold.begin(); f.hold.dispose(); f.advance(10000); assert.equal(f.tasks.size, 0);
  }
});
test('Wake hold cannot cross sleep start; insufficient backdate space cancels instead of ending now', () => {
  assert.equal(time.maximumBackdate(600000, 0, true), 9);
  assert.equal(time.maximumBackdate(600000, 0, false), 10);
  const f = gesture(9); f.hold.begin(); f.advance(5000); assert.equal(f.hold.release().minutes, 5);
  const short = gesture(4); short.hold.begin(); short.advance(450); assert.equal(short.hold.release().kind, 'cancel');
});

test('thumb drift is measured within 20 CSS pixels of pointer-down, without accumulating jitter or permitting departure',()=>{
  const {withinSleepHoldTarget}=load('src/lib/holdSleepAction.ts',{'./sleepActionTime':time});
  const origin={x:100,y:100},bounds={left:0,right:200,top:50,bottom:150};
  assert.equal(time.HOLD_MOVE_TOLERANCE_PX,20);
  for(const point of [{x:112,y:110},{x:119,y:100},{x:95,y:100},{x:110,y:105},{x:100,y:100}])assert.equal(withinSleepHoldTarget(origin,point,bounds),true);
  assert.equal(withinSleepHoldTarget(origin,{x:120,y:100},bounds),true);
  assert.equal(withinSleepHoldTarget(origin,{x:120.1,y:100},bounds),false);
  assert.equal(withinSleepHoldTarget({x:195,y:100},{x:201,y:100},bounds),false,'leaving the button cancels even below the distance limit');
});

test('five-minute boundaries and 60-minute maximum remain unchanged; invalid holds clear feedback without a haptic',()=>{
  assert.equal(time.HOLD_MAX_MINUTES,60);
  const now=Date.now();assert.equal(time.maximumBackdate(now,now-300000,false),5);assert.equal(time.maximumBackdate(now,now-300000,true),4);
  assert.equal(time.maximumBackdate(now,null,false),60);assert.equal(time.maximumBackdate(now,now-7200000,true),60);
  const {createSleepHold}=load('src/lib/holdSleepAction.ts',{'./sleepActionTime':time});
  let callback,selection,cleared=0,haptics=0;
  const hold=createSleepHold({maximum:()=>4,select:n=>selection=n,haptic:()=>haptics++,onCancel:()=>cleared++,schedule:fn=>{callback=fn;return 1},clear:()=>{}});
  hold.begin();callback();assert.equal(hold.release().kind,'cancel');assert.equal(selection,0);assert.equal(cleared,1);assert.equal(haptics,0);
});

test('each press uses its current Start/Wake boundary instead of the initial mount boundary',()=>{
  const f=gesture(60);f.hold.begin(()=>4);f.advance(450);assert.equal(f.hold.release().kind,'cancel');assert.equal(f.haptics(),0);
  f.hold.begin(()=>10);f.advance(1050);assert.equal(f.hold.release().minutes,10);assert.equal(f.haptics(),2);
});
test('explicit local datetime selection uses whole-minute commands and enforces future/start/overlap bounds', () => {
  const now = Date.parse('2026-11-11T13:30:40Z');
  const five = time.localDateTimeInput(now - 5 * 60000);
  assert.equal(time.minutesBeforeNow(five, now, null, false), 5);
  assert.equal(time.minutesBeforeNow('invalid', now, null, false), null);
  assert.equal(time.minutesBeforeNow(time.localDateTimeInput(now + 60000), now, null, false), null);
  assert.equal(time.minutesBeforeNow(five, now, now - 60000, true), null);
  assert.equal(time.minutesBeforeNow(five, now, now - 60000, false), null);
});
test('manual picker uses local date/time through DST and timezone changes, rather than subtracting clock hours', () => {
  const old = process.env.TZ;
  try { for (const zone of ['Europe/Oslo', 'America/New_York', 'UTC']) {
    process.env.TZ = zone;
    for (const date of ['2026-03-29T01:30:00Z', '2026-10-25T02:30:00Z']) {
      const now = Date.parse(date), selected = time.localDateTimeInput(now - 10 * 60000);
      assert.equal(time.minutesBeforeNow(selected, now, now - 3 * 3600000, true), 10);
    }
  } } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('haptics are optional on web, missing plugins, and rejecting or synchronously failing bridges', async () => {
  for (const [native, available, failure] of [[false, true, false], [true, false, false], [true, true, true], [true, true, 'sync']]) {
    let calls = 0;
    const feedback = load('src/services/interactionFeedback.ts', { '@capacitor/core': {
      Capacitor: { isNativePlatform: () => native, getPlatform: () => 'ios', isPluginAvailable: () => available },
      registerPlugin: () => ({ selection() { calls++; if (failure === 'sync') throw Error('No bridge'); return Promise.reject(Error('No haptics')); } }),
    } });
    feedback.selectionFeedback(); await Promise.resolve(); assert.equal(calls, native && available ? 1 : 0);
  }
});
test('Home keeps the shared predictors, Today calculator, authoritative writes and a synchronous duplicate guard', () => {
  const home = fs.readFileSync('src/pages/Home.tsx', 'utf8');
  for (const name of ['computeNextSleepHint', 'getActiveSleepEstimate', 'computeTodayTotals', 'await startSleep(', 'await stopSleep(', 'sleepActionBusy.current = true']) assert.ok(home.includes(name));
  assert.doesNotMatch(home, /<SleepStartOptions|<SleepStopOptions|stars\(todayStats/);
  const action = fs.readFileSync('src/components/SleepPrimaryAction.tsx', 'utf8');
  for (const behavior of ['onPointerCancel', 'onLostPointerCapture', 'onPointerMove', 'visibilitychange', 'gesture.dispose()', 'suppressClick', 'busy.current = true', 'SleepTimeSheet']) assert.ok(action.includes(behavior));
});
test('haptic plugin is registered as an app-only source', () => {
  const project = require('xcode').project(path.resolve('ios/App/App.xcodeproj/project.pbxproj')); project.parseSync();
  const o = project.hash.project.objects;
  assert.equal(o.PBXFileReference.A76000000000000000000002.path, 'App/SleepyFeedback.swift');
  const sourceRefs = target => o.PBXNativeTarget[target].buildPhases.map(p => o.PBXSourcesBuildPhase[p.value]).filter(Boolean).flatMap(p => p.files.map(f => f.value));
  assert.ok(sourceRefs('504EC3031FED79650016851F').includes('A76000000000000000000001'));
  assert.ok(!sourceRefs('A74000000000000000000013').includes('A76000000000000000000001'));
  const source = fs.readFileSync('ios/App/App/SleepyFeedback.swift', 'utf8');
  assert.match(source, /UISelectionFeedbackGenerator\(\)\.selectionChanged\(\)/);
  assert.match(source, /pluginMethods: \[CAPPluginMethod\]/);
});
test('Home durations are calm, localized and minute based without changing calculator values', () => {
  const resources = { en: load('src/i18n/en.ts').default, no: load('src/i18n/no.ts').default };
  const { formatHomeDuration } = load('src/lib/homePresentation.ts', { '../i18n': { translate: (lang, key, values) =>
    key.split('.').reduce((value, field) => value[field], resources[lang]).replace(/\{\{(\w+)\}\}/g, (_, field) => values[field]) } });
  assert.equal(formatHomeDuration(18, 'en'), '18 min');
  assert.equal(formatHomeDuration(72, 'en'), '1 h 12 min');
  assert.equal(formatHomeDuration(72, 'no'), '1 t 12 min');
  assert.equal(formatHomeDuration(0, 'no'), '0 min');
});
