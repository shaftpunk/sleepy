const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
process.env.TZ='Europe/Oslo';
function loader(mocks={}){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,Date,Intl,require:name=>{if(name in mocks)return mocks[name];if(name==='react'||name==='react/jsx-runtime')return require(name);
      const p=path.join(path.dirname(file),name);return load(fs.existsSync(p+'.ts')?p+'.ts':p+'.tsx');}});return exports;}return load;}
const load=loader(),{calculateSleepProbability:calculate,getUsableHistoricalDays,localClockInstant,isSleepAtLocalTime,getRecencyWeight}=load('src/analytics/sleepProbability.ts');
const now=new Date(2026,10,13,12).getTime(),minute=60000;
function dayAt(daysAgo,hour,minutes=0,anchor=now){const d=new Date(anchor);d.setDate(d.getDate()-daysAgo);d.setHours(hour,minutes,0,0);return d.getTime();}
function session(startMs,endMs,id=String(startMs)){return {id,startMs,endMs,durationMin:(endMs-startMs)/minute,rate:null,note:null,sleepTypeRaw:'sleep'};}
function history(days,asleep=()=>true,anchor=now){return days.flatMap(d=>[
  session(dayAt(d+1,23,30,anchor),dayAt(d,7,0,anchor)),
  session(dayAt(d,asleep(d)?9:11,30,anchor),dayAt(d,asleep(d)?10:12,30,anchor)),
  session(dayAt(d,23,30,anchor),dayAt(d-1,7,0,anchor)),
]);}
const range=(n,start=1)=>Array.from({length:n},(_,i)=>i+start);

test('raw 9/12 remains separate from recency-weighted 79 percent',()=>{
  const r=calculate(history(range(12),d=>d<=9),'10:00',now);
  assert.equal(r.sleepingDays,9);assert.equal(r.usableDays,12);assert.equal(r.rawPercentage,75);
  assert.equal(r.weightedSleep,8.5);assert.equal(r.weightedTotal,10.75);assert.equal(r.weightedPercentage,79);assert.equal(r.insufficientData,false);
});
test('recent sleeping versus recent non-sleep observations move estimate in both directions',()=>{
  const days=[...range(5),...range(5,22)];
  const recentSleep=calculate(history(days,d=>d<=5),'10:00',now),recentAwake=calculate(history(days,d=>d>=22),'10:00',now);
  assert.equal(recentSleep.rawPercentage,50);assert.equal(recentSleep.weightedPercentage,80);
  assert.equal(recentAwake.rawPercentage,50);assert.equal(recentAwake.weightedPercentage,20);
});
test('all recency boundaries and excluded ages are explicit',()=>{
  for(const [age,weight] of [[1,1],[7,1],[8,.75],[14,.75],[15,.5],[21,.5],[22,.25],[30,.25],[31,0],[0,0],[-1,0],[1.5,0]])assert.equal(getRecencyWeight(age),weight);
});
test('fewer than five usable days hides percentage while keeping sample counts and weights',()=>{
  const r=calculate(history(range(3)),'10:00',now);assert.equal(r.sleepingDays,3);assert.equal(r.usableDays,3);
  assert.equal(r.weightedPercentage,null);assert.equal(r.insufficientData,true);assert.equal(r.weightedTotal,3);
  assert.equal(calculate(history(range(5)),'10:00',now).weightedPercentage,100);
  assert.equal(calculate([],'10:00',now).rawPercentage,null);
});
test('overnight intervals count on both correct local days instead of grouping by start date',()=>{
  const s=session(new Date('2026-11-10T23:30:00+01:00').getTime(),new Date('2026-11-11T01:15:00+01:00').getTime());
  assert.equal(isSleepAtLocalTime(s,'2026-11-11','00:30'),true);assert.equal(isSleepAtLocalTime(s,'2026-11-10','23:45'),true);
  assert.equal(isSleepAtLocalTime(s,'2026-11-10','00:30'),false);
  const rows=history(range(6));assert.equal(calculate(rows,'00:30',now).sleepingDays,6);assert.equal(calculate(rows,'23:45',now).sleepingDays,6);
});
test('UTC dates/hours are not local calendar dates/hours',()=>{
  const s=session(Date.parse('2026-11-10T23:10:00Z'),Date.parse('2026-11-11T00:10:00Z'));
  assert.equal(isSleepAtLocalTime(s,'2026-11-11','00:30'),true);
  assert.equal(isSleepAtLocalTime(s,'2026-11-10','23:30'),false);
});
test('DST gap and repeated clock times abstain; unique wall times remain correct',()=>{
  assert.equal(localClockInstant('2026-03-29','02:30'),null);assert.equal(localClockInstant('2026-10-25','02:30'),null);
  assert.equal(localClockInstant('2026-03-29','10:00'),Date.parse('2026-03-29T10:00:00+02:00'));
  assert.equal(localClockInstant('2026-10-25','10:00'),Date.parse('2026-10-25T10:00:00+01:00'));
  for(const anchor of [new Date(2026,2,31,12).getTime(),new Date(2026,9,27,12).getTime()]){
    const days=getUsableHistoricalDays(history(range(6),()=>true,anchor),'10:00',anchor);
    assert.equal(days.length,6);assert.deepEqual(Array.from(days,d=>d.daysAgo),range(6));
    assert.equal(getUsableHistoricalDays(history(range(6),()=>true,anchor),'02:30',anchor).length,5);
  }
});
test('sparse logging, short spans and unbracketed times do not add non-sleep observations or weight',()=>{
  const base=history(range(5)),sparse=range(5,10).map(d=>session(dayAt(d,11),dayAt(d,12)));
  const r=calculate([...base,...sparse],'10:00',now);assert.equal(r.usableDays,5);assert.equal(r.weightedTotal,5);assert.equal(r.weightedPercentage,100);
  const shortSpan=range(5).flatMap(d=>[7,10,13].map(h=>session(dayAt(d,h),dayAt(d,h,30))));
  assert.equal(calculate(shortSpan,'10:00',now).usableDays,0);
  const unbracketed=range(5).flatMap(d=>[2,8,15].map(h=>session(dayAt(d,h),dayAt(d,h,30))));
  assert.equal(calculate(unbracketed,'23:00',now).usableDays,0);
});
test('two consolidated intervals qualify by coverage, for both sleep and non-sleep observations',()=>{
  const rows=range(5).flatMap(d=>[
    session(dayAt(d,0),dayAt(d,7)),session(dayAt(d,20),dayAt(d,23)),
  ]);
  const asleep=calculate(rows,'06:00',now),gap=calculate(rows,'10:00',now);
  assert.equal(asleep.usableDays,5);assert.equal(asleep.sleepingDays,5);assert.equal(asleep.weightedPercentage,100);
  assert.equal(gap.usableDays,5);assert.equal(gap.sleepingDays,0);assert.equal(gap.weightedTotal,5);
  assert.equal(calculate(rows,'23:30',now).usableDays,0); // outside observed span, not inferred awake
});
test('one long interval or duplicates cannot qualify; two close intervals still lack observation span',()=>{
  const long=range(5).map(d=>session(dayAt(d,0),dayAt(d,12)));
  for(const rows of [long,[...long,...long]]){
    const r=calculate(rows,'10:00',now);assert.equal(r.usableDays,0);assert.equal(r.weightedTotal,0);assert.equal(r.weightedPercentage,null);
  }
  const close=range(5).flatMap(d=>[session(dayAt(d,9),dayAt(d,10)),session(dayAt(d,11),dayAt(d,12))]);
  assert.equal(calculate(close,'10:30',now).usableDays,0);
  const short=range(5).flatMap(d=>[session(dayAt(d,0),dayAt(d,1)),session(dayAt(d,11),dayAt(d,11,59))]);
  assert.equal(calculate(short,'06:00',now).usableDays,0);
  const boundary=range(5).flatMap(d=>[session(dayAt(d,0),dayAt(d,1)),session(dayAt(d,11),dayAt(d,12))]);
  assert.equal(calculate(boundary,'06:00',now).usableDays,5);
});
test('multiple, duplicate, overlapping and split sessions cannot inflate days or weights',()=>{
  const base=history(range(5)),duplicates=[...base,...base,...base.map(s=>({...s,id:'copy-'+s.id,startMs:s.startMs+minute}))];
  const r=calculate(duplicates,'10:00',now);assert.equal(r.sleepingDays,5);assert.equal(r.usableDays,5);assert.equal(r.weightedTotal,5);
  const split=range(5).flatMap(d=>[9,10,11].map(h=>session(dayAt(d,h),dayAt(d,h+1))));
  assert.equal(calculate(split,'10:00',now).usableDays,0);
});
test('containment is start-inclusive/end-exclusive even at exact minute boundaries',()=>{
  const rows=history(range(5));assert.equal(calculate(rows,'09:30',now).sleepingDays,5);assert.equal(calculate(rows,'10:30',now).sleepingDays,0);
});
test('current day, future completions, active historical days and out-of-window days cannot contribute',()=>{
  const rows=history([...range(30),0,31]);
  const r=calculate(rows,'10:00',now);assert.equal(r.usableDays,30);assert.equal(r.weightedTotal,18);
  const days=getUsableHistoricalDays(rows,'10:00',now,{id:'open',startMs:dayAt(2,20)});
  assert.equal(days.length,28);assert.ok(days.every(d=>d.daysAgo>=3&&d.daysAgo<=30));
  assert.equal(calculate(history([31]),'10:00',now).usableDays,0);
});
test('shared normalization excludes active/broken rows; probability guards corrupted timestamps/durations without changing classifier',()=>{
  const {normalizeSleepRows}=load('src/analytics/normalize.ts');
  const raw=[{id:'open',starttime:new Date(dayAt(1,20)).toISOString(),endtime:null},{id:'broken',starttime:'bad',endtime:'bad'}];
  assert.equal(normalizeSleepRows(raw).sessions.length,0);
  const corrupt=[session(NaN,Infinity),session(dayAt(8,0),dayAt(7,0)),{...session(dayAt(9,9),dayAt(9,10)),durationMin:-1}];
  assert.equal(calculate([...history(range(5)),...corrupt],'10:00',now).usableDays,5);
  for(const clock of ['25:00','10:60','bad',''])assert.equal(calculate(history(range(5)),clock,now).usableDays,0);
});
test('EN/NO real card renders clock, raw sample count and weighted estimate; insufficient sample hides percentage',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  for(const lang of ['en','no']){
    const strings=load(`src/i18n/${lang}.ts`).default,t=(key,params={})=>key.split('.').reduce((s,k)=>s[k],strings).replace(/\{\{(\w+)\}\}/g,(_,k)=>params[k]);
    const Card=loader({'../../i18n':{useTranslation:()=>({t,locale:lang==='no'?'nb-NO':'en-GB'})}})('src/components/analysis/SleepProbabilityCard.tsx').default;
    const html=renderToStaticMarkup(React.createElement(Card,{sessions:history(range(12),d=>d<=9),active:null,now}));
    assert.ok(html.includes(strings.sleepProbability.title));assert.ok(html.includes(t('sleepProbability.recorded',{sleeping:9,usable:12})));
    assert.match(html,/79/);assert.match(html,/type="time"/);assert.match(html,/step="900"/);assert.match(html,/value="10:00"/);assert.match(html,/<label for=/);
    const empty=renderToStaticMarkup(React.createElement(Card,{sessions:history(range(3)),active:null,now}));
    assert.ok(empty.includes(strings.sleepProbability.insufficient));assert.ok(!empty.includes('sleep-probability-estimate'));
  }
  assert.match(fs.readFileSync('src/pages/analysis/OverviewTab.tsx','utf8'),/<SleepProbabilityCard sessions=\{sessions\} active=\{active\} now=\{now\}/);
  assert.doesNotMatch(fs.readFileSync('src/components/analysis/SleepProbabilityCard.tsx','utf8'),/supabase|fetch\(|canUse|useEntitlements/);
});
