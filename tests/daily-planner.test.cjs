// History daily planner: a second view of the Sleep Wave model (same forecast,
// linear vertical geometry), the rolling 24-hour list, and the page wiring.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');process.env.TZ='Europe/Oslo';
function loader(mocks={}){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,Intl,require:name=>{if(name.endsWith('.css'))return {};if(name in mocks)return mocks[name];if(name==='react'||name==='react/jsx-runtime')return require(name);const p=path.join(path.dirname(file),name);return load(fs.existsSync(p+'.ts')?p+'.ts':p+'.tsx');}});return exports;}return load;}
const load=loader();
const {buildDailyPlannerModel:plan,PLANNER_FRAME}=load('src/analytics/dailyPlannerModel.ts');
const {buildSleepWaveModel:wave}=load('src/analytics/sleepWaveModel.ts');
const minute=60000,at=(h,m=0,d=16)=>new Date(2026,10,d,h,m).getTime(),now=at(12,8);
const session=(startMs,endMs,id=String(startMs))=>({id,startMs,endMs,durationMin:(endMs-startMs)/minute,rate:null,note:null,sleepTypeRaw:'sleep'});
const prediction={status:'ready',earliestStart:at(12,45),likelyStart:at(12,55),latestStart:at(13,5),sampleSize:10};
const iv=(e,t,l)=>({earliestMs:e,typicalMs:t,latestMs:l});
const nap=(k,onset,wake,isNext=false)=>({id:'nap-'+k,sequenceIndex:k,isNext,onset,...(wake?{wakeTime:wake,durationMinutes:{lowMin:30,typicalMin:40,highMin:50}}:{}),quality:'medium',evidenceCount:6,effectiveEvidence:5});
const forecast={status:'ready',lastUpdated:now,diagnostics:{},predictedNaps:[
  nap(1,iv(at(12,45),at(12,55),at(13,5)),iv(at(13,25),at(13,35),at(13,45)),true),
  nap(2,iv(at(16),at(16,10),at(16,20)),iv(at(16,40),at(16,50),at(17))),
  nap(3,iv(at(18,30),at(18,40),at(19,10)),null)]};
const sessions=[session(at(20,9,15),at(6,53),'night'),session(at(9,15),at(10,5),'nap')];
const base={sessions,active:null,prediction,forecast,upcoming:null,now};
const all=m=>m.days.flatMap(d=>d.events),kind=(m,k)=>all(m).filter(e=>e.kind===k);
// Values built inside the vm context have their own Array prototype.
const same=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);
const sleeping={status:'sleeping',sampleSize:0},noData={status:'insufficient_data',sampleSize:0};

test('today shows recorded sleep with true times, session ids and linear heights',()=>{
  const m=plan(base),[night,napEvent]=kind(m,'recorded');
  assert.equal(m.days.length,1);assert.equal(m.days[0].mode,'today');
  assert.equal(napEvent.sessionId,'nap');assert.equal(napEvent.startMs,at(9,15));assert.equal(napEvent.height,50);
  assert.equal(night.sessionId,'night');
  // One linear scale: positions are elapsed minutes from the frame start.
  assert.equal(napEvent.top,(at(9,15)-m.days[0].frameStartMs)/minute);
  const next=kind(m,'next')[0];assert.equal(next.endMs-next.startMs,20*minute);
});

test('overnight sleep crossing midnight keeps its real start but does not stretch the day',()=>{
  const d=plan(base).days[0],night=d.events.find(e=>e.sessionId==='night');
  assert.equal(night.startMs,at(20,9,15));assert.equal(night.endMs,at(6,53));assert.ok(night.clippedStart);
  assert.ok(d.frameStartMs>=at(0)&&d.frameStartMs<=at(PLANNER_FRAME.morningHour));assert.equal(d.frameStartMs,at(5));
  assert.ok(d.frameEndMs>=at(21));assert.ok(d.minutes<=17*60);
});

test('forecast windows are exactly the Sleep Wave windows (single source of truth)',()=>{
  const m=plan(base),w=wave({sessions,active:null,prediction,forecast,now});
  const next=kind(m,'next');assert.equal(next.length,1);
  assert.equal(next[0].startMs,w.forecasts[0].startMs);assert.equal(next[0].endMs,w.forecasts[0].endMs);
  const later=kind(m,'later');
  same(later.map(e=>[e.startMs,e.endMs]),w.predicted.filter(p=>!p.isNext).map(p=>[p.onset.startMs,p.onset.endMs]));
  assert.ok(later.length>=2&&later.length<=3);
});

test('estimated sleep only when the forecast supplies a wake time; onset-only stays a window',()=>{
  const m=plan(base),next=kind(m,'next')[0],[second,third]=kind(m,'later');
  same(next.sleep,{startMs:at(12,55),endMs:at(13,35)});
  same(second.sleep,{startMs:at(16,10),endMs:at(16,50)});
  assert.equal(third.sleep,null);assert.equal(third.endMs-third.startMs,40*minute);
  const onsetOnly=plan({...base,forecast:{...forecast,predictedNaps:forecast.predictedNaps.map(n=>({...n,wakeTime:undefined}))}});
  assert.ok(all(onsetOnly).every(e=>e.sleep===null));
});

test('no forecast: no predicted events, nothing invented, learning note flagged',()=>{
  const m=plan({...base,prediction:noData,forecast:null});
  assert.equal(all(m).filter(e=>e.kind!=='recorded').length,0);assert.ok(m.days[0].noForecast);
  const empty=plan({...base,sessions:[],prediction:noData,forecast:null});
  assert.equal(all(empty).length,0);assert.equal(empty.days[0].awake.length,0);
});

test('active sleep runs to now and suppresses the next onset window',()=>{
  const m=plan({...base,active:{id:'live',startMs:at(11,30)},prediction:sleeping,forecast:null});
  const a=kind(m,'active');assert.equal(a.length,1);assert.equal(a[0].endMs,now);assert.equal(a[0].sessionId,'live');
  assert.equal(kind(m,'next').length,0);assert.equal(m.status,'sleeping');
});

test('awake periods only between actual sleep; forecasts never overlap recorded sleep',()=>{
  const d=plan(base).days[0];
  same(d.awake.map(a=>[a.startMs,a.endMs,a.untilNow]),[[at(6,53),at(9,15),false],[at(10,5),now,true]]);
  const rec=d.events.filter(e=>e.kind==='recorded'),pred=d.events.filter(e=>e.kind==='next'||e.kind==='later');
  for(const p of pred)for(const r of rec)assert.ok(p.startMs>=r.endMs);
  // Overlapping predicted spans sit in separate lanes, never on top of each other.
  const lanes=plan({...base,forecast:{...forecast,predictedNaps:[forecast.predictedNaps[0],nap(2,iv(at(13,20),at(13,40),at(13,50)),null)]}})
    .days[0].events.filter(e=>e.kind!=='recorded');
  assert.equal(lanes.length,2);assert.equal(lanes[0].lanes,2);assert.notEqual(lanes[0].lane,lanes[1].lane);
});

const upcoming=target=>({status:'ready',targetDay:'x',targetDayStartMs:target,
  morningWake:iv(target+6*60*minute,target+6.5*60*minute,target+7*60*minute),
  predictedNaps:[nap(1,iv(target+9.5*60*minute,target+9.75*60*minute,target+10*60*minute),iv(target+10.5*60*minute,target+10.75*60*minute,target+11*60*minute))],
  lastUpdated:0,diagnostics:{}});

test('night before midnight: today keeps actual sleep, the coming day gets its own dated preliminary calendar',()=>{
  const m=plan({...base,now:at(22),sessions:[session(at(9,15),at(10,5))],active:{id:'live',startMs:at(20,9)},prediction:sleeping,forecast,upcoming:upcoming(at(0,0,17))});
  assert.ok(m.night);assert.equal(m.days.length,2);
  assert.equal(m.days[0].mode,'today');assert.ok(m.days[0].events.every(e=>e.kind==='recorded'||e.kind==='active'));
  assert.equal(m.days[1].mode,'upcoming');assert.ok(m.days[1].preliminary);assert.equal(m.days[1].now,null);
  assert.equal(m.days[1].dayStartMs,at(0,0,17));same(m.days[1].events.map(e=>e.kind),['wake','later']);
  // The remaining-day forecast is replaced at night, never shown alongside.
  assert.ok(m.days.every(d=>d.events.every(e=>e.kind!=='next')));
});

test('night after midnight: one preliminary calendar for today with the ongoing sleep',()=>{
  const n=at(1,30,17),input={...base,now:n,sessions:[],active:{id:'live',startMs:at(20,9)},prediction:sleeping,forecast:null};
  const m=plan({...input,upcoming:upcoming(at(0,0,17))});
  assert.equal(m.days.length,1);assert.ok(m.days[0].preliminary);assert.ok(m.days[0].now!==null);
  const a=m.days[0].events.find(e=>e.kind==='active');assert.equal(a.startMs,at(20,9));assert.ok(a.clippedStart);
  const learning=plan({...input,upcoming:{status:'insufficient_data',targetDay:'x',targetDayStartMs:at(0,0,17),morningWake:null,predictedNaps:[],lastUpdated:0,diagnostics:{}}});
  assert.ok(learning.days[0].noForecast);assert.equal(all(learning).filter(e=>e.kind==='wake'||e.kind==='later').length,0);
});

test('DST: heights are elapsed minutes and hour lines follow local clock hours',()=>{
  const n=Date.parse('2026-10-25T12:00:00+01:00'),s=session(Date.parse('2026-10-25T01:30:00+02:00'),Date.parse('2026-10-25T03:30:00+01:00'));
  const d=plan({sessions:[s],active:null,prediction:noData,forecast:null,upcoming:null,now:n}).days[0];
  assert.equal(d.events[0].height,180);assert.equal(d.minutes,(d.frameEndMs-d.frameStartMs)/minute);
  for(const h of d.hours)assert.equal(new Date(h.instant).getMinutes(),0);
  assert.equal(new Set(d.hours.map(h=>h.top)).size,d.hours.length);
});

test('baby switch: a fresh model carries nothing over from the previous baby',()=>{
  const first=plan(base),second=plan({...base,sessions:[],prediction:noData,forecast:null});
  assert.ok(all(first).length>0);assert.equal(all(second).length,0);
});

const translate=(lang,key,params={})=>key.split('.').reduce((v,k)=>v[k],load('src/i18n/'+lang+'.ts').default).replace(/\{\{(\w+)\}\}/g,(_,k)=>params[k]);
const {sleepsInLast24Hours:last24,sleepDayLabel}=loader({'../i18n':{LOCALES:{en:'en-GB',no:'nb-NO'},translate}})('src/lib/recentSleeps.ts');
const row=(start,end,extra={})=>({id:String(start),baby_id:'b',starttime:new Date(start).toISOString(),endtime:end?new Date(end).toISOString():null,
  durationminutes:end?(end-start)/minute:null,deleted_at:null,...extra});

test('rolling 24 hours: overlap with now-24h..now, overnight included, newest first, deleted and future excluded',()=>{
  const rows=[row(at(10,0,15),at(12,0,15)),row(at(11,0,15),at(12,10,15)),row(at(20,9,15),at(6,53)),row(at(9,15),at(10,5)),row(at(8),at(8,30),{deleted_at:'x'}),row(at(13),at(14))];
  same(last24(rows,now).map(r=>r.id),[String(at(9,15)),String(at(20,9,15)),String(at(11,0,15))]);
});

test('day labels: today, yesterday, and a date range across midnight in both languages',()=>{
  assert.equal(sleepDayLabel(at(9,15),at(10,5),now,'en'),'Today');assert.equal(sleepDayLabel(at(9,15),at(10,5),now,'no'),'I dag');
  assert.equal(sleepDayLabel(at(16,10,15),at(16,50,15),now,'no'),'I går');
  assert.equal(sleepDayLabel(at(20,9,15),at(6,53),now,'no'),'15.–16. nov.');
  const en=sleepDayLabel(at(20,9,15),at(6,53),now,"en");assert.ok(en.startsWith("15")&&en.endsWith("16 Nov")&&en.includes("–"),en);
});

function render(lang,input){
  const strings=load('src/i18n/'+lang+'.ts').default;
  const t=(key,params={})=>key.split('.').reduce((v,k)=>v[k],strings).replace(/\{\{(\w+)\}\}/g,(_,k)=>params[k]);
  const format=loader({'../i18n':{LOCALES:{en:'en-GB',no:'nb-NO'},translate:(l,k,p)=>t(k,p)}})('src/lib/format.ts');
  const view=loader({'../../i18n':{LOCALES:{en:'en-GB',no:'nb-NO'},useTranslation:()=>({t,lang})},'../../lib/format':format})('src/components/history/DailySleepPlanner.tsx');
  return renderToStaticMarkup(React.createElement(view.default,input));
}

test('planner renders in Norwegian and English, distinguishes actual and predicted, and only records are editable',()=>{
  for(const [lang,title,onset] of [['no','Dagens søvnplan','Mulig innsovning'],['en','Today&#x27;s sleep plan','Possible sleep onset']]){
    const html=render(lang,{...base,editableIds:new Set(['nap']),onSelectSession:()=>{}});
    assert.ok(html.includes(title),lang);assert.ok(html.includes(onset));assert.ok(html.includes('12:45–13:05'));assert.ok(html.includes('09:15–10:05'));
    assert.equal((html.match(/data-planner-event="recorded"/g)||[]).length,2);
    assert.equal((html.match(/data-planner-event="next"/g)||[]).length,1);
    assert.equal((html.match(/<button/g)||[]).length,1);
    assert.match(html,/role="region"[^>]*tabindex="0"/i);
  }
  const night=render('no',{...base,now:at(22),active:{id:'live',startMs:at(20,9)},prediction:sleeping,upcoming:upcoming(at(0,0,17))});
  assert.ok(night.includes('Søvnplan for neste dag'));assert.ok(night.includes('Tir. 17. nov.'));assert.ok(night.includes('Foreløpig'));
});

test('Log keeps the planner and its forecasts outside the activity timeline',()=>{
  const log=fs.readFileSync('src/pages/History.tsx','utf8');
  assert.doesNotMatch(log, /DailySleepPlanner|SleepClock|useSleepForecasts|useAnalyticsData/);
  assert.match(log, /getSleepsOverlappingPeriod/);
  for(const file of ['src/hooks/useSleepForecasts.ts','src/analytics/dailyPlannerModel.ts','src/components/history/DailySleepPlanner.tsx','src/lib/recentSleeps.ts']){
    assert.doesNotMatch(fs.readFileSync(file,'utf8').replace(/^import type .*$/gm,''),/services\/|supabase|localStorage|insert\(|upsert/,file);
  }
});
