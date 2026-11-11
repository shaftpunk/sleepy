const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const A='11111111-1111-4111-8111-111111111111',H='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444';
const registry=require('../src/entitlements/features.json');
const payload=()=>({state:'verified',subscriptionState:'production',householdId:H,entitlement:{household_id:H,tier:'plus',is_plus:true,features:Object.keys(registry),verification_state:'verified',verified_at:new Date().toISOString(),valid_until:new Date(Date.now()+86400000).toISOString(),recheck_at:new Date(Date.now()+300000).toISOString(),policy_version:1}});
function fixture(){const env={user:A,generation:0,response:payload(),error:null},calls=[],cache=new Map();
  function load(file){if(cache.has(file))return cache.get(file);if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));const exports={};cache.set(file,exports);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{exports,Date,AbortSignal,console,crypto:require('node:crypto').webcrypto,require:name=>{
      if(name==='../lib/supabase')return {supabase:{auth:{getUser:async()=>({data:{user:env.user?{id:env.user}:null},error:null})},functions:{invoke:async(name,options)=>{calls.push({name,...options});if(env.onInvoke)await env.onInvoke();return {data:env.response,error:env.error};}}}};
      if(name==='../auth/sessionLifecycle')return {sessionGeneration:()=>env.generation,isSessionGenerationCurrent:n=>n===env.generation};
      const p=path.join(path.dirname(file),name);return load(fs.existsSync(p)?p:p+'.ts');}});return exports;
  }return {service:load('src/services/subscriptionReconciliationService.ts'),env,calls};
}
test('client prepares exact household/baby but never claims user authority; restore sends no household/intent',async()=>{
  const f=fixture();f.env.response={intentId:I,expiresAt:new Date(Date.now()+7200000).toISOString()};
  assert.equal(await f.service.prepareSubscriptionPurchase({userId:A,babyId:I,householdId:H},'monthly'),I);
  assert.equal(f.calls[0].name,'subscription-reconcile');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body)),{action:'prepare',householdId:H,babyId:I,plan:'monthly',attemptId:f.calls[0].body.attemptId});assert.match(f.calls[0].body.attemptId,/^[0-9a-f-]{36}$/);
  f.env.response=payload();await f.service.reconcileSubscription(undefined,true);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].body)),{action:'restore'});
});
test('safe authoritative response refreshes only scoped listeners; evidence does not fabricate funding',async()=>{
  const f=fixture(),events=[];f.service.subscribeEntitlementReconciliation(e=>events.push(e));const r=await f.service.reconcileSubscription(I,false,'transaction-hint');
  assert.equal(r.state,'verified');assert.equal(events[0].userId,A);assert.equal(events[0].householdId,H);assert.equal(Object.hasOwn(r,'isPlus'),false);
  assert.equal(f.calls[0].body.transactionId,'transaction-hint');
});
test('anonymous, switched account, malformed entitlement, ownership failure and network failure are safe',async()=>{
  const f=fixture();f.env.user=null;await assert.rejects(f.service.reconcileSubscription(),e=>e.issue==='authentication');assert.equal(f.calls.length,0);
  f.env.user=A;f.env.onInvoke=async()=>{f.env.generation++;};await assert.rejects(f.service.reconcileSubscription(),e=>e.issue==='authentication');
  f.env.onInvoke=null;f.env.response={...payload(),entitlement:{...payload().entitlement,is_plus:false}};await assert.rejects(f.service.reconcileSubscription());
  f.env.error={context:{status:409,json:async()=>({error:'subscription_ownership_conflict',private:'NEVER SHOW'})}};await assert.rejects(f.service.reconcileSubscription(),e=>e.issue==='ownership'&&!e.message.includes('NEVER'));
  f.env.error={};await assert.rejects(f.service.reconcileSubscription(),e=>e.issue==='network');
});
