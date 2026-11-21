const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');process.env.TZ='Europe/Oslo';
function loader(mocks={}){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,Intl,require:name=>{if(name.endsWith('.css'))return {};if(name in mocks)return mocks[name];if(name==='react'||name==='react/jsx-runtime')return require(name);const p=path.join(path.dirname(file),name);return load(fs.existsSync(p+'.ts')?p+'.ts':p+'.tsx');}});return exports;}return load;}
const load=loader(),{buildSleepWaveModel:build,wavePosition,recordedWavePath}=load('src/analytics/sleepWaveModel.ts');
const now=new Date(2026,10,16,12,8).getTime(),minute=60000;
const at=(h,m=0)=>new Date(2026,10,16,h,m).getTime();
const session=(startMs,endMs)=>({id:String(startMs),startMs,endMs,durationMin:(endMs-startMs)/minute,rate:null,note:null,sleepTypeRaw:'sleep'});
const prediction={status:'ready',earliestStart:at(12,40),likelyStart:at(12,55),latestStart:at(13,10),sampleSize:10};
const props={sessions:[session(at(9,15),at(10,5))],active:null,prediction,now};
function render(lang='en',input=props){const strings=load('src/i18n/'+lang+'.ts').default;const t=(key,params={})=>key.split('.').reduce((v,k)=>v[k],strings).replace(/\{\{(\w+)\}\}/g,(_,k)=>params[k]);
 const format=loader({'../i18n':{LOCALES:{en:'en-GB',no:'nb-NO'}}})('src/lib/format.ts');
 const view=loader({'../../i18n':{LOCALES:{en:'en-GB',no:'nb-NO'},useTranslation:()=>({t,lang})},'../../lib/format':format})('src/components/sleep-wave/SleepWaveCard.tsx');
 return renderToStaticMarkup(React.createElement(view.default,{...input,babyName:'Amalie'}));}
test('timeline coordinates represent elapsed time on one shared axis',()=>{const m=build(props),d=m.domain;assert.equal(m.recorded[0].start,wavePosition(at(9,15),d));assert.equal(m.now,wavePosition(now,d));assert.equal(m.forecasts[0].end-m.forecasts[0].start,30*minute/(d.endMs-d.startMs));assert.ok(m.recorded[0].end<m.now&&m.now<m.forecasts[0].start);});
test('recorded boundaries preserve actual duration and geometry is deterministic',()=>{const m=build(props),p=recordedWavePath(m.recorded[0]);assert.equal(p,recordedWavePath(m.recorded[0]));assert.ok(p.startsWith('M '+m.recorded[0].start*640+' 150'));assert.equal(m.recorded[0].endMs-m.recorded[0].startMs,50*minute);assert.ok(!p.includes('NaN'));});
test('only the provided next onset window exists; no later future waves',()=>{const m=build(props);assert.equal(m.forecasts.length,1);assert.equal(m.recorded.length,1);const html=render();assert.equal((html.match(/data-wave-forecast="onset"/g)||[]).length,1);assert.ok(html.includes('12:40')&&html.includes('13:10'));assert.ok(!html.includes('15:50'));});
test('active sleep suppresses any stale next forecast without inventing wake-up',()=>{const m=build({...props,active:{id:'a',startMs:at(11,30)}});assert.equal(m.status,'sleeping');assert.equal(m.active.endMs,now);assert.equal(m.forecasts.length,0);const html=render('en',{...props,active:{id:'a',startMs:at(11,30)}});assert.ok(html.includes('Sleeping now'));assert.ok(html.includes('data-wave-active="true"'));assert.ok(!html.includes('data-wave-forecast'));assert.ok(!html.includes('wake up'));});
test('learning state retains actual history and no future elements or invented awake state',()=>{const input={...props,prediction:{status:'insufficient_data',sampleSize:0},sessions:[]};const m=build(input);assert.equal(m.forecasts.length,0);assert.equal(m.recorded.length,0);const html=render('en',input);assert.ok(html.includes('learning'));assert.ok(!html.includes('data-wave-forecast'));assert.ok(!html.includes('>Awake<'));});
test('overnight records and next-day forecasts are included fully, never silently clipped',()=>{const start=new Date(2026,10,15,22).getTime(),end=at(6);const m=build({...props,sessions:[session(start,end)],prediction:{...prediction,earliestStart:at(23,50),latestStart:new Date(2026,10,17,0,20).getTime()}});assert.ok(m.domain.startMs<start);assert.ok(m.domain.endMs>m.forecasts[0].endMs);assert.equal(m.recorded[0].startMs,start);assert.ok(m.ticks.some(t=>t.showDate));});
test('calendar midnight changes the daily frame and excludes only previous-day records',()=>{const s=session(at(22),new Date(2026,10,17,0,10).getTime()),n=new Date(2026,10,17,0,30).getTime();const m=build({...props,now:n,sessions:[s],prediction:{status:'insufficient_data',sampleSize:0}});assert.equal(m.recorded.length,1);assert.equal(m.recorded[0].startMs,at(22));assert.ok(m.domain.startMs<at(22));});
test('spring and autumn DST use real durations and label offset changes',()=>{for(const [start,end,n,elapsed] of [['2026-03-29T01:30:00+01:00','2026-03-29T03:30:00+02:00','2026-03-29T12:00:00+02:00',60],['2026-10-25T01:30:00+02:00','2026-10-25T03:30:00+01:00','2026-10-25T12:00:00+01:00',180]]){const m=build({...props,now:Date.parse(n),sessions:[session(Date.parse(start),Date.parse(end))],prediction:{status:'insufficient_data',sampleSize:0}});assert.equal(m.recorded[0].endMs-m.recorded[0].startMs,elapsed*minute);assert.ok(m.ticks.every(t=>t.showOffset));assert.ok(m.recorded[0].start<m.recorded[0].end);}});
test('edits and baby switching derive fresh models without retained prior-baby segments',()=>{const a=build(props),b=build({...props,sessions:[],prediction:{status:'insufficient_data',sampleSize:0}});assert.equal(b.recorded.length,0);assert.equal(b.lastCompleted,null);const edited=build({...props,prediction:{...prediction,earliestStart:at(13),latestStart:at(13,30)}});assert.notEqual(edited.forecasts[0].start,a.forecasts[0].start);});
test('future completed records, expired forecasts and invalid active rows are not rendered',()=>{const m=build({...props,sessions:[session(at(14),at(15))],active:{id:'future',startMs:at(14)},prediction:{...prediction,earliestStart:at(10),latestStart:at(11)}});assert.equal(m.recorded.length,0);assert.equal(m.active,null);assert.equal(m.forecasts.length,0);});
test('long recorded sleep remains visible regardless of prediction plausibility limits',()=>{const m=build({...props,sessions:[session(new Date(2026,10,15,21).getTime(),at(11))]});assert.equal(m.recorded.length,1);assert.equal(m.recorded[0].endMs-m.recorded[0].startMs,14*60*minute);});
test('both locales provide accessible equivalent text; SVG decoration is hidden',()=>{for(const lang of ['en','no']){const html=render(lang);assert.match(html,/aria-labelledby="[^"]+" aria-describedby="[^"]+"/);assert.match(html,/class="sleep-wave-chart" aria-hidden="true"/);assert.ok(html.includes(lang==='en'?'Recorded sleep in today':'Registrert s\u00f8vn i dagens'));assert.ok(html.includes(lang==='en'?'not how long':'ikke hvor lenge'));assert.ok(html.includes('09:15')&&html.includes('10:05'));assert.match(html,/focusable="false"/);}});
test('Home integration replaces old card, keeps tracking order, and motion is opt-in only',()=>{const home=fs.readFileSync('src/pages/Home.tsx','utf8'),css=fs.readFileSync('src/components/sleep-wave/SleepWave.css','utf8');assert.ok(home.indexOf('<SleepPrimaryAction')<home.indexOf('<SleepWaveCard'));assert.ok(home.indexOf('<SleepWaveCard')<home.indexOf('<SoundMonitorPanel'));assert.ok(!home.includes('<NextSleepCard'));assert.match(css,/@media \(prefers-reduced-motion: no-preference\)/);assert.doesNotMatch(css,/animation:|@keyframes/);});

test('missing forecast evidence does not present stale history as current awake status',()=>{
 const html=render('en',{...props,prediction:{status:'insufficient_data',sampleSize:0},sessions:[session(new Date(2026,10,5,9).getTime(),new Date(2026,10,5,10).getTime())]});assert.ok(!html.includes('>Awake<'));assert.ok(html.includes('Not registered'));
});
test('forecast across repeated DST hour displays both offsets and exact onset width',()=>{
 const n=Date.parse('2026-10-25T01:15:00+02:00'),start=Date.parse('2026-10-25T02:50:00+02:00'),end=Date.parse('2026-10-25T02:10:00+01:00');
 const input={sessions:[],active:null,now:n,prediction:{status:'ready',earliestStart:start,latestStart:end,likelyStart:start+10*minute,sampleSize:10}};
 const m=build(input);assert.equal(m.forecasts[0].endMs-m.forecasts[0].startMs,20*minute);const html=render('en',input);assert.ok(html.includes('GMT+2')&&html.includes('GMT+1'));
});
const {recordedDisplaySegments:display}=load('src/analytics/sleepWaveModel.ts');
test('short recorded displays use 12 CSS pixels, preserve centers and timestamps across mobile widths',()=>{
 for(const width of [242,280,295,310,350]){
  const original={start:.4,end:.401,startMs:at(9),endMs:at(9,1)};
  const result=display([original],width)[0];
  assert.ok(Math.abs((result.end-result.start)*width-12)<1e-9);
  assert.equal((result.start+result.end)/2,(original.start+original.end)/2);
  assert.equal(result.startMs,original.startMs);assert.equal(result.endMs,original.endMs);
  assert.equal(original.start,.4);
 }
});
test('nearby short naps and active sleep limit symmetric expansion without overlap',()=>{
 const segments=[{start:.4,end:.401},{start:.402,end:.403},{start:.7,end:.9}];
 const result=display(segments,250,[{start:.404,end:.5}]);
 assert.ok(result[0].end<=result[1].start);assert.ok(result[1].end<=.404);
 assert.ok(Math.abs(result[2].start-.7)<1e-9);assert.ok(Math.abs(result[2].end-.9)<1e-9);
 for(let i=0;i<2;i++)assert.ok(Math.abs(result[i].start+result[i].end-segments[i].start-segments[i].end)<1e-9);
 const edge=display([{start:0,end:.001}],250)[0];assert.ok(edge.start>=0);
});
const night=session(new Date(2026,10,15,20,9).getTime(),at(6,53)),nightProps={...props,sessions:[night,session(at(9,15),at(10,5))]};
test('a completed long night is condensed in display only; timestamps and day scale stay true',()=>{
 const m=build(nightProps),plain=build(props),c=m.compressed;assert.ok(c);assert.equal(plain.compressed,null);
 assert.equal(c.endMs,at(6,53));assert.ok(Math.abs(c.end-.16)<1e-9);
 const n=m.recorded.find(s=>s.startMs===night.startMs),nap=m.recorded.find(s=>s.startMs===at(9,15));
 assert.equal(n.endMs,night.endMs);assert.ok(n.start>=0&&n.end<=c.end+1e-9);assert.equal(nap.endMs-nap.startMs,50*minute);
 // After the wake-up the axis is linear: equal durations get equal widths.
 const perMs=(nap.end-nap.start)/(50*minute),f=m.forecasts[0];
 assert.ok(Math.abs((f.end-f.start)/(f.endMs-f.startMs)-perMs)<1e-12);assert.ok(Math.abs((m.now-nap.end)/(now-nap.endMs)-perMs)<1e-12);
 // The day gets more room than on the uncondensed axis, and order is kept.
 assert.ok(perMs>1/(m.domain.endMs-m.domain.startMs));assert.ok(n.end<=nap.start&&nap.end<m.now&&m.now<f.start);
 assert.ok(m.ticks.every(t=>t.position>=c.end&&t.position<=1));assert.ok(m.ticks.length>=3);
});
test('nothing is condensed without a long night, while it is still running, or when later items overlap it',()=>{
 assert.equal(build({...props,sessions:[session(at(5),at(6,30)),session(at(9,15),at(10,5))]}).compressed,null);
 assert.equal(build({...props,sessions:[],active:{id:'a',startMs:new Date(2026,10,15,20,9).getTime()}}).compressed,null);
 assert.equal(build({...props,now:at(3),sessions:[],active:{id:'a',startMs:new Date(2026,10,15,20,9).getTime()},prediction:{status:'insufficient_data',sampleSize:0}}).compressed,null);
});
test('condensed night renders its true times, a break cue and a legend entry in both locales',()=>{
 for(const lang of ['en','no']){const html=render(lang,nightProps);assert.ok(html.includes('data-wave-compressed="true"'));assert.ok(html.includes('20:09')&&html.includes('06:53'));assert.ok(html.includes(lang==='en'?'Night condensed':'Natten er forkortet'));}
 assert.ok(!render('en').includes('data-wave-compressed'));
});
test('active first future nap uses existing dashed waves and remains accessible in both languages',()=>{
 const active={id:'active',startMs:at(11,30)};
 const interval={earliestMs:at(14),typicalMs:at(14,15),latestMs:at(14,30)};
 const forecast={status:'partial',activeAnchor:active,lastUpdated:now,diagnostics:{},predictedNaps:[{id:'future',sequenceIndex:1,isNext:false,onset:interval,wakeTime:{earliestMs:at(14,45),typicalMs:at(15),latestMs:at(15,15)},quality:'low'}]};
 for(const lang of ['en','no']){const html=render(lang,{...props,active,prediction:{status:'sleeping'},forecast});
 assert.ok(html.includes('data-wave-predicted="1"'));assert.ok(html.includes('data-wave-active="true"'));assert.ok(html.includes('sleep-wave-predicted'));assert.ok(html.includes('14:00'));assert.ok(!html.includes('data-wave-forecast="onset"'));
 assert.ok(html.includes(lang==='en'?'Sleeping now':'Sover n\u00e5'));
 }
});
test('three active predictions remain accessible and onset-only events never receive duration waves',()=>{
 const active={id:'a',startMs:at(11,30)};
 const naps=[14,16,18].map((h,i)=>({id:String(i),sequenceIndex:i+1,isNext:false,quality:'low',onset:{earliestMs:at(h),typicalMs:at(h,15),latestMs:at(h,30)},...(i===2?{}:{wakeTime:{earliestMs:at(h,45),typicalMs:at(h+1),latestMs:at(h+1,15)}})}));
 const forecast={status:'partial',activeAnchor:active,lastUpdated:now,predictedNaps:naps,diagnostics:{}};
 const input={...props,active,prediction:{status:'sleeping'},forecast};const m=build(input);
 assert.equal(m.predicted.length,3);assert.equal(m.predicted[2].wave,null);assert.ok(m.domain.endMs>=at(18,30));
 for(const lang of ['no','en']){const html=render(lang,input);assert.equal((html.match(/data-wave-predicted=/g)||[]).length,3);assert.equal((html.match(/class="sleep-wave-predicted"/g)||[]).length,2);for(const h of ['14:00','16:00','18:00'])assert.ok(html.includes(h));}
});

const fmt=loader({'../i18n':{LOCALES:{en:'en-GB',no:'nb-NO'},translate:(l,k)=>k}})('src/lib/format.ts');
test('sleep ranges: no date on today, one date on another single day, both dates across midnight',()=>{
 const n=new Date(2026,10,18,9).getTime(),d=(day,h,m)=>new Date(2026,10,day,h,m).getTime();
 assert.equal(fmt.formatSleepRange(d(18,6,59),d(18,7,23),n,'no'),'06:59–07:23');
 assert.equal(fmt.formatSleepRange(d(17,18,59),d(17,19,23),n,'no'),'17. nov. 18:59–19:23');
 assert.equal(fmt.formatSleepRange(d(17,23,30),d(18,0,15),n,'no'),'17. nov. 23:30 – 18. nov. 00:15');
 assert.equal(fmt.formatSleepRange(d(17,23,30),d(18,0,15),n,'en'),'17 Nov 23:30 – 18 Nov 00:15');
 const dst=fmt.formatSleepRange(Date.parse('2026-10-25T01:30:00+02:00'),Date.parse('2026-10-25T03:30:00+01:00'),Date.parse('2026-10-25T12:00:00+01:00'),'en');
 assert.ok(dst.includes('GMT+2')&&dst.includes('GMT+1'),dst);
});
test('live timer from Home replaces the status tile; awake shows the awake duration under the forecast',()=>{
 const active={id:'a',startMs:at(11,30)};
 for(const lang of ['no','en']){
  const sleeping=render(lang,{...props,active,prediction:{status:'sleeping',sampleSize:0},live:{sleeping:true,duration:'38 min',caption:'Startet 11:30'}});
  assert.ok(sleeping.includes('data-wave-live="sleeping"'));assert.ok(sleeping.includes('38 min'));assert.ok(sleeping.includes('Startet 11:30'));
  assert.ok(!sleeping.includes('data-tile="status"'));assert.ok(sleeping.includes('data-tile="last"'));
  const awake=render(lang,{...props,live:{sleeping:false,duration:'2 t 3 min',caption:null}});
  assert.ok(awake.includes('data-wave-live="awake"'));assert.ok(awake.includes('2 t 3 min'));assert.ok(!awake.includes('data-tile="next"'));
  assert.ok(!render(lang,props).includes('data-wave-live'));
 }
});
