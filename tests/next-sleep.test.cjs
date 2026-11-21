const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
process.env.TZ='Europe/Oslo';
function loader(){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl,require:name=>load(path.join(path.dirname(file),name)+'.ts')});return exports;}return load;}
const load=loader(),{calculateNextSleep:predict}=load('src/analytics/nextSleep.ts');
const minute=60000,now=new Date(2026,10,16,9).getTime();
function session(startMs,endMs){return {id:String(startMs),startMs,endMs,durationMin:(endMs-startMs)/minute,rate:null,note:null,sleepTypeRaw:'sleep'};}
function history(anchor=now, gap=d=>120){const out=[];for(let d=12;d>=1;d--){const date=new Date(anchor);date.setDate(date.getDate()-d);date.setHours(0,0,0,0);for(const hour of [0,4,8,12,16,20]){const end=new Date(date);end.setHours(hour);out.push(session(end.getTime()-60*minute,end.getTime()));if(hour===8){out.push(session(end.getTime()+gap(d)*minute,end.getTime()+(gap(d)+30)*minute));}}}out.push(session(anchor-120*minute,anchor-60*minute));return out;}
function run(sessions=history(),extra={}){return predict({sessions,active:null,now,ageDays:180,...extra});}
test('consistent history produces a meaningful rounded future window',()=>{const r=run();assert.equal(r.status,'ready');assert.ok(r.earliestStart>=now);assert.ok(r.latestStart-r.earliestStart>=20*minute);assert.ok(r.sampleSize>=6);assert.ok(r.typicalAwakeMinutes.min<=120&&r.typicalAwakeMinutes.max>=120);});
test('irregular patterns widen window and lower confidence',()=>{const stable=run(),irregular=run(history(now,d=>d%2?30:210));assert.equal(irregular.status,'ready');assert.ok(irregular.latestStart-irregular.earliestStart>stable.latestStart-stable.earliestStart);assert.notEqual(irregular.confidence,'high');});
test('empty, sparse, stale and nap-only logging abstain',()=>{for(const s of [[],history().slice(-3),history().filter(s=>s.endMs<now-8*86400000),history().filter(s=>new Date(s.endMs).getHours()===8)])assert.equal(run(s).status,'insufficient_data');});
test('missing logging periods are not awake samples',()=>{const r=run(history().filter((s,i)=>i%8===0));assert.equal(r.status,'insufficient_data');});
test('overlaps and duplicates do not inflate samples',()=>{const s=history(),r=run(s);const duplicate=run([...s,...s]);assert.equal(duplicate.sampleSize,r.sampleSize);assert.equal(duplicate.likelyStart,r.likelyStart);const contained=run([...s,...s.map(x=>session(x.startMs+minute,x.endMs-minute))]);assert.equal(contained.sampleSize,r.sampleSize);});
test('ongoing sleep wins over history and future active rows abstain',()=>{assert.equal(run(history(),{active:{id:'a',startMs:now-minute}}).status,'sleeping');assert.equal(run(history(),{active:{id:'a',startMs:now+minute}}).status,'insufficient_data');});
test('recent wake-up anchors prediction to completed sleep',()=>{const s=history();s[s.length-1]=session(now-60*minute,now);const r=run(s);assert.equal(r.status,'ready');assert.equal(r.awakeMinutes,0);assert.ok(r.earliestStart>now);});
test('edits and deletes recompute without a prediction cache',()=>{const s=history(),before=run(s);s[s.length-1]=session(now-90*minute,now-30*minute);assert.notEqual(run(s).likelyStart,before.likelyStart);assert.equal(run(s.slice(-2)).status,'insufficient_data');});
test('separate baby histories share no model state',()=>{const a=run();assert.equal(run([]).status,'insufficient_data');assert.equal(run().likelyStart,a.likelyStart);});
test('overnight completed sleeps preserve actual elapsed wake time',()=>{const s=history();s[s.length-1]=session(now-11*3600000,now-60*minute);const r=run(s);assert.equal(r.status,'ready');assert.equal(r.awakeMinutes,60);});
test('midnight and both DST transitions use elapsed instants',()=>{for(const anchor of [new Date(2026,2,29,3,30).getTime(),new Date(2026,9,25,3,30).getTime(),new Date(2026,10,16,0,30).getTime()]){const s=history(anchor),r=run(s,{now:anchor});assert.equal(r.status,'ready');assert.equal(r.awakeMinutes,60);assert.ok(r.earliestStart>=anchor);assert.ok(r.latestStart>r.earliestStart);}});
test('expired windows abstain instead of returning past times',()=>{assert.equal(run(history(),{now:now+7*3600000}).status,'insufficient_data');const r=run(history(),{now:now+65*minute});assert.ok(r.status==='insufficient_data'||r.earliestStart>=now+65*minute);});
test('young or unknown age widens uncertainty without inventing data',()=>{const a=run(),b=run(history(),{ageDays:30});assert.ok(b.latestStart-b.earliestStart>a.latestStart-a.earliestStart);assert.equal(b.confidence,'low');assert.equal(run([],{ageDays:30}).status,'insufficient_data');});
test('invalid newer sleep prevents using an obsolete wake-up',()=>{assert.equal(run([...history(),session(now-14*3600000,now)]).status,'insufficient_data');});

test('same clock and awake duration respond to different preceding sleep durations', () => {
  const s = history(now, d => d % 2 ? 90 : 165).map(row => {
    const end = new Date(row.endMs);
    if (row.endMs >= now - 120 * minute || end.getHours() !== 8 || end.getMinutes() !== 0) return row;
    const date = new Date(now);
    const age = date.getDate() - end.getDate();
    return session(row.endMs - (age % 2 ? 30 : 120) * minute, row.endMs);
  }).slice(0, -1);
  const wake = now - 60 * minute;
  const short = run([...s, session(wake - 30 * minute, wake)]);
  const long = run([...s, session(wake - 120 * minute, wake)]);
  assert.equal(short.status, 'ready');
  assert.equal(long.status, 'ready');
  assert.equal(short.awakeMinutes, long.awakeMinutes);
  assert.ok(long.likelyStart > short.likelyStart);
});

test('onset mode requires a single supported cluster of comparable future transitions', () => {
  const {estimateOnsetPeak}=load('src/analytics/onsetPeak.ts');
  const sample=minutes=>minutes.map((n,i)=>({minutes:n,weight:1,dayKey:String(i),similarity:1}));
  const anchor=now, lower=anchor+50*minute, upper=anchor+160*minute;
  const peak=rows=>estimateOnsetPeak(rows,anchor,anchor,lower,upper,.2,3);
  const stable=sample([89,90,90,91,92,93,94,107]);
  const r=peak(stable);
  assert.ok(Math.abs(r.peakTime-(anchor+90*minute))<=5*minute);
  assert.ok(r.windowStart<r.peakTime && r.windowEnd>r.peakTime && r.windowEnd-r.windowStart<upper-lower);
  assert.equal(peak(stable.slice(0,3)),undefined);
  assert.equal(peak(stable.map(s=>({...s,similarity:.2}))),undefined);
  assert.equal(peak(sample([80,80,80,80,140,140,140,140])),undefined);
});
