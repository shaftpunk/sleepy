const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
process.env.TZ='Europe/Oslo';
function loader(mocks={}){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,Date,Intl,require:name=>{if(name in mocks)return mocks[name];if(name==='react'||name==='react/jsx-runtime')return require(name);
      const p=path.join(path.dirname(file),name);return load(fs.existsSync(p+'.ts')?p+'.ts':p+'.tsx');}});return exports;}return load;}
const load=loader(),timeline=load('src/analytics/sleepTimeline.ts'),probability=load('src/analytics/sleepProbability.ts');
const now=new Date(2026,10,13,12).getTime(),iso=value=>Date.parse(value);
const session=(start,end)=>({id:start,startMs:iso(start),endMs:iso(end),durationMin:(iso(end)-iso(start))/60000,rate:null,note:null,sleepTypeRaw:'sleep'});
const plain=value=>JSON.parse(JSON.stringify(value));
test('timeline contains seven completed local dates oldest first, including empty rows, excluding today',()=>{
  const rows=timeline.buildSleepTimelineRows([],now);assert.equal(rows.length,7);
  assert.deepEqual(Array.from(rows,r=>r.day),['2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12']);
  assert.ok(rows.every(r=>r.segments.length===0&&r.recordedSessions===0));
});
test('same-day/multiple sessions use local clock positions and duplicate registrations do not inflate counts',()=>{
  const first=session('2026-11-10T10:00:00+01:00','2026-11-10T11:00:00+01:00');
  const second=session('2026-11-10T14:30:00+01:00','2026-11-10T15:00:00+01:00');
  const row=timeline.buildSleepTimelineRows([first,second,first],now).find(r=>r.day==='2026-11-10');
  assert.equal(row.recordedSessions,2);assert.deepEqual(plain(row.segments.slice(0,2)),[{startMinute:600,endMinute:660},{startMinute:870,endMinute:900}]);
});
test('22:30 to 01:20 is split across both calendar dates, with 24:00 at the first day end',()=>{
  const rows=timeline.buildSleepTimelineRows([session('2026-11-10T22:30:00+01:00','2026-11-11T01:20:00+01:00')],now);
  assert.deepEqual(plain(rows.find(r=>r.day==='2026-11-10').segments),[{startMinute:1350,endMinute:1440}]);
  assert.deepEqual(plain(rows.find(r=>r.day==='2026-11-11').segments),[{startMinute:0,endMinute:80}]);
});
test('history shows actual long completed records while ignoring invalid/future/open records',()=>{
  const rows=timeline.buildSleepTimelineRows([session('2026-11-10T02:00:00+01:00','2026-11-10T20:00:00+01:00'),
    {startMs:NaN,endMs:now}, {startMs:now-86400000,endMs:now+86400000}, {startMs:now-86400000,endMs:null}],now);
  assert.equal(rows.reduce((n,r)=>n+r.recordedSessions,0),1);
  assert.deepEqual(plain(rows.find(r=>r.day==='2026-11-10').segments),[{startMinute:120,endMinute:1200}]);
});
test('spring DST splits at the missing hour rather than painting it as recorded sleep',()=>{
  const rows=timeline.buildSleepTimelineRows([session('2026-03-29T01:30:00+01:00','2026-03-29T03:30:00+02:00')],new Date(2026,2,31,12).getTime());
  const row=rows.find(r=>r.day==='2026-03-29');
  assert.deepEqual(plain(row.segments),[{startMinute:90,endMinute:120},{startMinute:180,endMinute:210}]);
  assert.deepEqual(plain(row.clockChanges),[{startMinute:120,endMinute:180,kind:'missing'}]);
  assert.equal(rows[rows.indexOf(row)+1].startMs-row.startMs,23*3600000);
});
test('autumn DST repetition creates correct positive-width clock segments and keeps seven calendar rows',()=>{
  const rows=timeline.buildSleepTimelineRows([session('2026-10-25T02:45:00+02:00','2026-10-25T02:15:00+01:00')],new Date(2026,9,27,12).getTime());
  const row=rows.find(r=>r.day==='2026-10-25');assert.equal(rows.length,7);
  assert.deepEqual(plain(row.segments),[{startMinute:165,endMinute:180},{startMinute:120,endMinute:135}]);
  assert.deepEqual(plain(row.clockChanges),[{startMinute:120,endMinute:180,kind:'repeated'}]);
  assert.equal(rows[rows.indexOf(row)+1].startMs-row.startMs,25*3600000);
});
test('96 probability buckets delegate to the shared engine without changing window, weights, coverage or minimum sample',()=>{
  const sessions=[];for(let day=1;day<=6;day++){
    const date=new Date(now);date.setDate(date.getDate()-day);const at=h=>{const d=new Date(date);d.setHours(h,0,0,0);return d.toISOString();};
    sessions.push(session(at(0),at(7)),session(at(20),at(23)));
  }
  const calls=[];const helper=loader({'./sleepProbability':{calculateSleepProbability:(...args)=>{calls.push(args);return probability.calculateSleepProbability(...args);}}})('src/analytics/sleepTimeline.ts');
  const buckets=helper.buildSleepProbabilityBuckets(sessions,now);assert.equal(calls.length,96);assert.equal(buckets.length,96);
  for(let i=0;i<96;i++){assert.equal(calls[i][0],sessions);assert.equal(calls[i][2],now);assert.equal(calls[i][3],null);
    assert.equal(buckets[i].percentage,probability.calculateSleepProbability(sessions,calls[i][1],now).weightedPercentage);}
  assert.equal(buckets[24].percentage,100);assert.equal(buckets[24].band,'strong');assert.equal(buckets[40].percentage,0);assert.equal(buckets[40].band,'none');
});
test('insufficient history has no pattern background, and visual band boundaries are centralized',()=>{
  const buckets=timeline.buildSleepProbabilityBuckets([],now);assert.ok(buckets.every(b=>b.percentage===null&&b.band==='none'));
  for(const [n,band] of [[null,'none'],[0,'none'],[39,'none'],[40,'weak'],[59,'weak'],[60,'moderate'],[79,'moderate'],[80,'strong'],[100,'strong'],[NaN,'none']])assert.equal(timeline.sleepPatternBand(n),band);
});
test('pointer positions map to local time and snap to 15 minutes, with safe edges',()=>{
  assert.equal(timeline.timelinePositionToTime(160,40,240),'12:00');
  assert.equal(timeline.timelinePositionToTime(602,0,1440),'10:00');assert.equal(timeline.timelinePositionToTime(608,0,1440),'10:15');
  assert.equal(timeline.timelinePositionToTime(-1,0,1440),'00:00');assert.equal(timeline.timelinePositionToTime(1440,0,1440),'23:45');
  assert.equal(timeline.timelinePositionToTime(10,0,0),null);assert.equal(timeline.timelinePositionToTime(NaN,0,100),null);
});
test('EN/NO rendering distinguishes recorded blocks, pattern and unrecorded periods; selection has one owner',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  for(const lang of ['en','no']){
    const strings=load(`src/i18n/${lang}.ts`).default,t=(key,params={})=>key.split('.').reduce((s,k)=>s[k],strings).replace(/\{\{(\w+)\}\}/g,(_,k)=>params[k]);
    const Timeline=loader({'../../i18n':{useTranslation:()=>({t,locale:lang==='no'?'nb-NO':'en-GB'})}})('src/components/analysis/SleepRhythmTimeline.tsx').default;
    const html=renderToStaticMarkup(React.createElement(Timeline,{sessions:[],active:null,now,selectedTime:'10:00',onSelectTime(){}}));
    assert.equal((html.match(/class="sleep-rhythm-track"/g)||[]).length,7);assert.ok(html.includes(strings.sleepTimeline.emptyExplanation));
    assert.ok(html.includes(strings.sleepTimeline.noRecordedSleep));assert.ok(!html.includes('sleep-rhythm-pattern none'));
    assert.match(html,/aria-label=/);assert.match(html,/aria-describedby=/);
  }
  const card=fs.readFileSync('src/components/analysis/SleepProbabilityCard.tsx','utf8'),component=fs.readFileSync('src/components/analysis/SleepRhythmTimeline.tsx','utf8');
  assert.match(card,/selectedTime=\{selectedTime\} onSelectTime=\{setSelectedTime\}/);assert.equal((card.match(/useState\(/g)||[]).length,1);
  assert.doesNotMatch(component,/useState|supabase|fetch\(|setInterval/);assert.match(component,/useMemo\(\(\) => buildSleepProbabilityBuckets/);
});
