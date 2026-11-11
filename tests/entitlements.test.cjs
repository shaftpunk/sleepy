const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function loader(overrides={}, globals={}) {
  const cache = new Map();
  function load(file) {
    if(overrides[file])return overrides[file];
    if(cache.has(file))return cache.get(file);
    if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
    const exports={};cache.set(file,exports);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{exports,Date,console,...globals,require:name=>{
      if(overrides[name])return overrides[name];if(!name.startsWith('.'))return require(name);
      const resolved=path.join(path.dirname(file),name).replaceAll('\\','/');
      return load(fs.existsSync(resolved)?resolved:fs.existsSync(resolved+'.ts')?resolved+'.ts':resolved+'.tsx');
    }});return exports;
  }return load;
}
const load=loader(), features=load('src/entitlements/features.ts'),model=load('src/entitlements/model.ts');
function payload(tier='free',household='A') {
  return {household_id:household,tier,is_plus:tier==='plus',features:Object.keys(features.FEATURES).filter(key=>features.wouldAllowFeature(key,tier)),
    verification_state:'verified',verified_at:'2026-11-11T12:00:00Z',valid_until:tier==='plus'?'2026-11-12T12:00:00Z':null,
    recheck_at:'2026-11-11T12:05:00Z',policy_version:1};
}
test('central registry exposes real Free/Plus decisions while explicit Phase 1 compatibility unlocks all known features',()=>{
  assert.equal(features.ENTITLEMENT_ENFORCEMENT_ENABLED,false);
  for(const [key,definition] of Object.entries(features.FEATURES)){
    assert.equal(features.canUseFeature(key,'free'),true);
    assert.equal(features.canUseFeature(key,null),true);
    assert.equal(features.canUseFeature(key,'free',true),definition.requiredTier==='free');
    assert.equal(features.canUseFeature(key,'plus',true),true);
  }
  assert.equal(features.canUseFeature('invented',null),false);
  assert.equal(model.entitlementAccess(null).tier,null);assert.equal(model.entitlementAccess(null).isPlus,false);
  assert.equal(model.entitlementAccess(null).wouldAllow('family'),false);
});
test('Free/Plus resolution parsing rejects a different household, forged/inconsistent features and unsupported policy',()=>{
  for(const tier of ['free','plus']){
    const resolution=model.parseEntitlementResolution(payload(tier),'A');
    assert.equal(resolution.tier,tier);assert.equal(resolution.isPlus,tier==='plus');
  }
  assert.throws(()=>model.parseEntitlementResolution(payload('plus','B'),'A'));
  for(const delta of [{features:['family']},{is_plus:true},{verification_state:'unknown'},{policy_version:2},{verified_at:'bad'},{valid_until:'bad'}]){
    assert.throws(()=>model.parseEntitlementResolution({...payload(),...delta},'A'));
  }
  assert.equal(model.sameHouseholdContext({userId:'u',babyId:'b',householdId:'A'},{userId:'u',babyId:'b',householdId:'B'}),false);
  assert.equal(model.sameHouseholdContext({userId:'u',babyId:'b',householdId:'A'},{userId:'v',babyId:'b',householdId:'A'}),false);
});
test('household selection never chooses an arbitrary row, revalidates storage, and scopes choices to user and baby',()=>{
  const storage=new Map(), api=loader({}, {localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}})('src/households/context.ts');
  const A={id:'A'},B={id:'B'};
  assert.equal(api.chooseHouseholdId([A],null),'A');
  assert.equal(api.chooseHouseholdId([B,A],null),null);
  assert.equal(api.chooseHouseholdId([A,B],'B'),'B');
  assert.equal(api.chooseHouseholdId([B,A],'B'),'B');
  assert.equal(api.chooseHouseholdId([A,B],'unauthorized'),null);
  assert.equal(api.chooseHouseholdId([A],'stale'),'A');
  assert.equal(api.chooseHouseholdId([],'A'),null);
  api.saveHouseholdChoice('user-a','baby-a','B');
  assert.equal(api.readHouseholdChoice('user-a','baby-a'),'B');
  assert.equal(api.readHouseholdChoice('user-b','baby-a'),null);
  assert.equal(api.readHouseholdChoice('user-a','baby-b'),null);
  api.saveHouseholdChoice('user-a','baby-a',null);assert.equal(api.readHouseholdChoice('user-a','baby-a'),null);
});
test('candidate service intersects the current user memberships and current baby links, including multiple-household babies',async()=>{
  const calls=[],records={household_members:[{household_id:'B',user_id:'u',role:'parent'},{household_id:'A',user_id:'u',role:'viewer'},{household_id:'X',user_id:'v',role:'owner'}],baby_households:[{household_id:'A',baby_id:'one'},{household_id:'A',baby_id:'multiple'},{household_id:'B',baby_id:'multiple'},{household_id:'X',baby_id:'multiple'}]};
  const service=loader({'../lib/supabase':{supabase:{from:table=>({select:()=>({eq:async(key,value)=>{calls.push([table,key,value]);return {data:records[table].filter(row=>row[key]===value),error:null};}})})}},
    './householdService':{getMyHouseholds:async()=>[{id:'B',name:'B'},{id:'A',name:'A'},{id:'X',name:'X'}]}})('src/services/householdContextService.ts');
  assert.deepEqual(Array.from(await service.getHouseholdCandidates('u','one'),row=>row.id),['A']);
  assert.deepEqual(Array.from(await service.getHouseholdCandidates('u','multiple'),row=>row.id),['B','A']);
  assert.ok(calls.some(([table,key,value])=>table==='household_members'&&key==='user_id'&&value==='u'));
});
test('entitlement service uses only the authenticated resolver and propagates unavailable/missing RPC without fake Plus',async()=>{
  const requests=[];
  for(const response of [{data:payload(),error:null},{data:payload('plus'),error:null},{data:null,error:{code:'PGRST202'}},{data:payload('plus','B'),error:null}]){
    const service=loader({'../lib/supabase':{supabase:{rpc:async(name,args)=>{requests.push([name,args.p_household_id]);return response;}}}})('src/services/entitlementService.ts');
    if(response.error||response.data.household_id!=='A')await assert.rejects(service.resolveHouseholdEntitlements('A'));
    else assert.equal((await service.resolveHouseholdEntitlements('A')).tier,response.data.tier);
  }
  assert.ok(requests.every(([name,h])=>name==='resolve_household_entitlements'&&h==='A'));
});
test('real React provider starts loading without fabricating Plus and keeps compatibility capabilities available',()=>{
  const app=loader({'../households/HouseholdContextProvider':{useHouseholdContext:()=>({userId:'u',babyId:'b',householdId:'A',loading:false})},
    '../services/subscriptionReconciliationService':{subscribeEntitlementReconciliation:()=>()=>{}},
    '../auth/sessionLifecycle':{sessionGeneration:()=>0,isSessionGenerationCurrent:()=>true,registerBeforeSignOut:()=>()=>{}},
    '../services/entitlementService':{resolveHouseholdEntitlements:async()=>{throw Error('not called by server render');}}});
  const {EntitlementProvider,useEntitlements}=app('src/entitlements/EntitlementProvider.tsx');
  function Probe(){const state=useEntitlements();return React.createElement('output',null,JSON.stringify({loading:state.loading,tier:state.tier,isPlus:state.isPlus,verification:state.verificationState,family:state.canUse('family')}));}
  const html=renderToStaticMarkup(React.createElement(EntitlementProvider,null,React.createElement(Probe)));
  assert.match(html,/&quot;loading&quot;:true/);assert.match(html,/&quot;tier&quot;:null/);assert.match(html,/&quot;isPlus&quot;:false/);assert.match(html,/&quot;family&quot;:true/);
});
test('foundation introduces no feature gates into existing screens, native content, or sound lifecycle',()=>{
  for(const file of ['src/pages/Home.tsx','src/pages/History.tsx','src/pages/Analysis.tsx','src/pages/Settings.tsx','src/components/NativeSoundLifecycle.tsx','src/components/SleepLiveActivityLifecycle.tsx']){
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/useEntitlements|canUse\(|RevenueCat|purchases-capacitor/);
  }
  const migration=fs.readFileSync('supabase/migrations/20261112091000_entitlement_foundation.sql','utf8');
  assert.doesNotMatch(migration,/insert into (?:private\.)?(?:household_access_grants|entitlement_funding_sources)/i);
  assert.doesNotMatch(migration,/alter table public\.|create policy.*public\.|end_sleep|household_members set/i);
  assert.deepEqual(Object.keys(require('../package.json').dependencies).filter(key=>/revenuecat|purchases/i.test(key)),['@revenuecat/purchases-capacitor']);
});
