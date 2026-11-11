const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function loader(){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Date,console,Promise,Request,Response,AbortSignal,TextEncoder,TextDecoder,URL,crypto:require('node:crypto').webcrypto,setTimeout,
    require:name=>{if(!name.startsWith('.'))throw Error('Unexpected import');const p=path.join(path.dirname(file),name);return load(p.endsWith('.ts')?p:p+'.ts');}});return exports;}return load;}
const load=loader(),{createRevenueCatAPI,parseWebhook,webhookAuthorized}=load('supabase/functions/_shared/revenuecat.ts');
const {createSubscriptionHandlers}=load('supabase/functions/_shared/subscriptionHandlers.ts');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',H='33333333-3333-4333-8333-333333333333';
const cfg={secret:'sk_serverFixture',project:'projFixture',app:'appFixture',webhookApp:'appFixture',webhookAuthorization:'Bearer '+ 's'.repeat(40),maintenanceAuthorization:'Bearer '+ 'm'.repeat(40)};
function subscription(overrides={}){return {object:'subscription',id:'subFixture',customer_id:A,original_customer_id:A,product_id:'prodFixture',starts_at:Date.now()-60000,
  ends_at:Date.now()+86400000,current_period_ends_at:Date.now()+86400000,gives_access:true,pending_payment:false,status:'active',auto_renewal_status:'will_renew',
  environment:'production',store:'app_store',store_subscription_identifier:'latest-id',ownership:'purchased',
  entitlements:{object:'list',items:[{object:'entitlement',state:'active',project_id:cfg.project,lookup_key:'plus'}],next_page:null},...overrides};}
function provider(options={}){const env={subscriptions:[subscription()],...options},calls=[];
  const fetcher=async(url,init)=>{calls.push({url,authorization:init.headers.Authorization});if(env.fetcher)return env.fetcher(url,init);
    const p=new URL(url).pathname;let data;
    if(p.endsWith('/apps/'+cfg.app))data={object:'app',id:cfg.app,project_id:cfg.project,type:'app_store',app_store:{bundle_id:'no.strandeconsulting.sleepy'}};
    else if(p.endsWith('/customers/'+A))data={object:'customer',id:A,project_id:cfg.project,...env.customer};
    else if(p.endsWith('/customers/'+A+'/subscriptions'))data={object:'list',items:env.subscriptions,next_page:env.nextPage??null};
    else if(p.endsWith('/products/prodFixture'))data={object:'product',id:'prodFixture',app_id:cfg.app,type:'subscription',store_identifier:'sleepy_plus_monthly',...env.product};
    else if(p.endsWith('/subscriptions/subKnown'))data=env.known??subscription({id:'subKnown'});
    else if(p.endsWith('/subscriptions'))data={object:'list',items:env.searchMatches??[{id:'subFixture'}],next_page:null};
    else return new Response('{}',{status:404});
    return Response.json(data);
  };
  return {env,calls,api:()=>createRevenueCatAPI(cfg,fetcher)};
}
test('v2 verifies customer/project/app/product/ownership and uses subscription ID, not latest transaction, as source',async()=>{
  const f=provider();const s=await f.api().snapshot(A);assert.equal(s.length,1);assert.equal(s[0].id,'subFixture');assert.equal(s[0].transaction,'latest-id');assert.equal(s[0].access,true);
  assert.ok(f.calls.every(c=>c.url.startsWith('https://api.revenuecat.com/v2/projects/projFixture/')&&c.authorization==='Bearer '+cfg.secret));
  assert.equal(Object.hasOwn(s[0],'receipt'),false);
});
test('email/anonymous identity, aliased customer and original-owner mismatch are rejected',async()=>{
  await assert.rejects(provider().api().snapshot('parent@example.com'));await assert.rejects(provider().api().snapshot('$RCAnonymousID:fake'));
  await assert.rejects(provider({customer:{id:B}}).api().snapshot(A),/identity_mismatch/);
  await assert.rejects(provider({subscriptions:[subscription({original_customer_id:B})]}).api().snapshot(A),/ownership_conflict/);
});
test('sandbox stays sandbox; Test Store and Family Sharing cannot grant App Store funding',async()=>{
  const s=await provider({subscriptions:[subscription({environment:'sandbox'})]}).api().snapshot(A);assert.equal(s[0].environment,'sandbox');
  for(const props of [{store:'test_store'},{ownership:'family_shared'}])assert.equal((await provider({subscriptions:[subscription(props)]}).api().snapshot(A)).length,0);
  assert.equal((await provider({product:{store_identifier:'test_monthly'}}).api().snapshot(A)).length,0);
});
test('cancellation retains verified access; expiry/refund/revocation/billing retry remove access; grace lease bounded',async()=>{
  assert.equal((await provider({subscriptions:[subscription({auto_renewal_status:'will_not_renew'})]}).api().snapshot(A))[0].access,true);
  for(const status of ['expired','in_billing_retry','revoked','refunded'])assert.equal((await provider({subscriptions:[subscription({status,gives_access:false})]}).api().snapshot(A))[0].access,false);
  const before=Date.now();const grace=(await provider({subscriptions:[subscription({status:'in_grace_period',ends_at:Date.now()-1000})]}).api().snapshot(A))[0];assert.equal(grace.access,true);assert.ok(Date.parse(grace.endsAt)<=before+301000);
});
test('known source moved to another RC user is verified individually and revoked for its original owner',async()=>{
  const f=provider({subscriptions:[],known:subscription({id:'subKnown',customer_id:B})});const s=await f.api().snapshot(A,['subKnown']);assert.equal(s[0].access,false);assert.equal(s[0].status,'transferred');
});
test('purchase transaction hint is independently resolved by provider and only correlates verified owned sources',async()=>{
  const f=provider();const s=await f.api().snapshot(A,[],'older-transaction');assert.equal(s[0].correlation,'older-transaction');
  assert.ok(f.calls.some(c=>c.url.includes('store_subscription_identifier=older-transaction')));
  const bad=provider({searchMatches:[{id:'someoneElsesSubscription'}]});assert.equal((await bad.api().snapshot(A,[],'forged'))[0].correlation,undefined);
});
test('provider failures and malformed/partial responses fail closed without a fabricated Free snapshot',async()=>{
  await assert.rejects(provider({customer:{project_id:'other'}}).api().snapshot(A));
  await assert.rejects(provider({subscriptions:[subscription({gives_access:'yes'})]}).api().snapshot(A));
  await assert.rejects(provider({nextPage:'https://attacker.invalid/steal'}).api().snapshot(A),/invalid_provider_page/);
  await assert.rejects(provider({nextPage:'/v2/projects/projFixture/other?x=1'}).api().snapshot(A),/invalid_provider_page/);
  const f=provider({fetcher:async()=>new Response('secret body',{status:500})});await assert.rejects(f.api().snapshot(A),e=>!e.message.includes('secret'));assert.equal(f.calls.length,2);
  const g=provider({fetcher:async()=>new Response('malformed json')});await assert.rejects(g.api().snapshot(A));
});
test('webhook authentication is required and compared without exposing the secret',async()=>{
  assert.equal(await webhookAuthorized(null,cfg.webhookAuthorization),false);assert.equal(await webhookAuthorized('Bearer wrong',cfg.webhookAuthorization),false);
  assert.equal(await webhookAuthorized(cfg.webhookAuthorization,cfg.webhookAuthorization),true);assert.equal(await webhookAuthorized('Bearer x',''),false);
});

test('server responses distinguish Sandbox, production, none and unknown without treating Sandbox as Plus',async()=>{
  const sandbox=handlers({snapshot:[{environment:'sandbox',access:true}]});
  const result=await (await sandbox.api.authenticated(sandbox.request({action:'restore'}))).json();
  assert.equal(result.state,'sandboxVerified');assert.equal(result.subscriptionState,'sandbox');assert.equal(result.entitlement.tier,'free');assert.equal(result.entitlement.is_plus,false);
  const prod=handlers({snapshot:[{environment:'production',access:true}]});assert.equal((await (await prod.api.authenticated(prod.request({action:'restore'}))).json()).subscriptionState,'production');
  const none=handlers();assert.equal((await (await none.api.authenticated(none.request({action:'restore'}))).json()).subscriptionState,'none');
  const unknown=handlers({fail:true});assert.equal((await unknown.api.authenticated(unknown.request({action:'restore'}))).status,503);
});

test('webhook fails closed without its dedicated secret before recording any event',async()=>{
  const f=handlers(),original=cfg.webhookAuthorization;try{
    cfg.webhookAuthorization='';assert.equal((await f.api.webhook(f.request(event(),original))).status,401);assert.equal(f.calls.length,0);
  }finally{cfg.webhookAuthorization=original;}
});
const event=(type='RENEWAL',props={})=>({api_version:'1.0',event:{id:'event-'+type,type,app_id:cfg.webhookApp,app_user_id:A,environment:'PRODUCTION',event_timestamp_ms:Date.now(),...props}});
test('webhook rejects malformed/app/environment mismatch; transfer parses both UUID sets without email aliases',()=>{
  for(const e of [{},event('RENEWAL',{app_id:'wrong'}),event('RENEWAL',{environment:'TEST_STORE'}),event('RENEWAL',{event_timestamp_ms:'bad'})])assert.throws(()=>parseWebhook(e,cfg));
  const e=event('TRANSFER',{transferred_from:[A,'email@example.com'],transferred_to:[B,'$RCAnonymousID:x']});delete e.event.environment;
  const result=parseWebhook(e,cfg);assert.equal(result.environment,'unspecified');assert.deepEqual(Array.from(result.users),[A,B]);
});
function handlers(options={}){
  const env={snapshot:[],...options},calls=[],events=new Map();let revision=0;
  const rpc=async(name,args)=>{calls.push([name,args]);
    if(name==='revenuecat_begin')return {revision:++revision,subscription_ids:[]};
    if(name==='revenuecat_apply')return {state:env.assignment?'assignmentRequired':'verified',householdId:env.assignment?null:H};
    if(name==='revenuecat_prepare')return {intentId:B,expiresAt:new Date(Date.now()+7200000).toISOString()};
    if(name==='revenuecat_maintenance_work')return env.work||{events:[],users:[]};
    if(name==='revenuecat_accept_event'){if(events.get(args.p_id)==='processed')return false;events.set(args.p_id,'pending');return true;}
    if(name==='revenuecat_finish_event'){events.set(args.p_id,args.p_success?'processed':'failed');return null;}
    throw Error('Unexpected RPC '+name);
  };
  const api=createSubscriptionHandlers({config:()=>cfg,authenticate:async auth=>auth==='Bearer userA'?A:null,rpc,
    resolve:async(_auth,h)=>{if(h!==H)throw Error('No membership');return {household_id:H,tier:'free',is_plus:false,private_billing_identifier:'MUST NOT RETURN'};},
    snapshot:async(_cfg,user)=>{calls.push(['provider',user]);if(env.fail)throw Error('PRIVATE SDK RESPONSE');return env.snapshot;}});
  const request=(body,auth='Bearer userA')=>new Request('https://example.invalid',{method:'POST',headers:{Authorization:auth},body:JSON.stringify(body)});
  return {api,env,calls,events,request};
}
test('authenticated endpoint derives user from JWT, rejects claimed identity and unauthorized household',async()=>{
  const f=handlers();assert.equal((await f.api.authenticated(f.request({action:'reconcile'},'Bearer attacker'))).status,401);
  assert.equal((await f.api.authenticated(f.request({action:'reconcile',userId:B}))).status,400);
  assert.equal((await f.api.authenticated(f.request({action:'prepare',householdId:B,babyId:A,plan:'monthly',attemptId:B}))).status,503);assert.equal(f.calls.length,0);
  const r=await f.api.authenticated(f.request({action:'prepare',householdId:H,babyId:A,plan:'monthly',attemptId:B}));assert.equal(r.status,200);
  assert.ok(f.calls.filter(([n])=>n.startsWith('revenuecat_')).every(([,args])=>args.p_user===A));
});
test('restore never accepts active-household reassignment; resolver response strips private fields',async()=>{
  const f=handlers();assert.equal((await f.api.authenticated(f.request({action:'restore',householdId:H}))).status,400);
  const r=await f.api.authenticated(f.request({action:'restore'}));assert.equal(r.status,200);assert.ok(!(await r.text()).includes('MUST NOT RETURN'));
  const g=handlers({assignment:true});assert.equal((await (await g.api.authenticated(g.request({action:'restore'}))).json()).state,'assignmentRequired');
});
test('webhook is durably accepted before provider fetch; duplicates do not repeat reconciliation',async()=>{
  const f=handlers();const body=event();const req=()=>f.request(body,cfg.webhookAuthorization);
  assert.equal((await f.api.webhook(f.request(body,'Bearer attacker'))).status,401);assert.equal(f.calls.length,0);
  assert.equal((await f.api.webhook(req())).status,200);assert.equal(f.calls[0][0],'revenuecat_accept_event');
  const count=f.calls.filter(([n])=>n==='provider').length;assert.equal((await f.api.webhook(req())).status,200);assert.equal(f.calls.filter(([n])=>n==='provider').length,count);
});
test('failed webhook remains retryable and errors expose no secret/provider payload',async()=>{
  const f=handlers({fail:true}),body=event();let r=await f.api.webhook(f.request(body,cfg.webhookAuthorization));assert.equal(r.status,503);assert.ok(!(await r.text()).includes('PRIVATE'));assert.equal(f.events.get(body.event.id),'failed');
  f.env.fail=false;r=await f.api.webhook(f.request(body,cfg.webhookAuthorization));assert.equal(r.status,200);assert.equal(f.events.get(body.event.id),'processed');
});
test('out-of-order event kinds reconcile fresh authoritative state, never webhook expiry or cancellation fields',async()=>{
  const f=handlers({snapshot:[{id:'current',access:true}]});
  for(const type of ['EXPIRATION','RENEWAL','CANCELLATION','UNCANCELLATION','BILLING_ISSUE','PRODUCT_CHANGE','SUBSCRIPTION_EXTENDED','REFUND','REVOCATION']){
    const body=event(type,{expiration_at_ms:1});assert.equal((await f.api.webhook(f.request(body,cfg.webhookAuthorization))).status,200);
    const last=f.calls.filter(([n])=>n==='revenuecat_apply').at(-1);assert.equal(last[1].p_sources[0].id,'current');assert.equal(last[1].p_sources[0].access,true);
  }
});
test('maintenance requires a different server credential and redrives inbox/current state without exposing identities',async()=>{
  const f=handlers({work:{events:[{id:'retry',hash:'hash',users:[A]}],users:[B]}});
  assert.equal((await f.api.maintenance(f.request({},cfg.webhookAuthorization))).status,401);assert.equal(f.calls.length,0);
  const r=await f.api.maintenance(f.request({},cfg.maintenanceAuthorization));assert.equal(r.status,200);const body=await r.json();assert.deepEqual(body,{refreshed:2,failed:0});assert.equal(f.events.get('retry'),'processed');
});
