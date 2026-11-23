const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const crypto=require('node:crypto').webcrypto;
const A='11111111-1111-4111-8111-111111111111',H='33333333-3333-4333-8333-333333333333',requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const config={secret:'sk_PRIVATESECRET',project:'projFixture',app:'appFixture',webhookApp:'appFixture',webhookAuthorization:'Bearer PRIVATE_WEBHOOK',maintenanceAuthorization:'Bearer PRIVATE_MAINTENANCE'};
function loader(globals={},mocks={}){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Promise,Request,Response,AbortSignal,TextEncoder,TextDecoder,URL,crypto,btoa,atob,Uint8Array,setTimeout,console:{info(){}},...globals,require:name=>name in mocks?mocks[name]:load(path.join(path.dirname(file),name))});return exports;}return load;}
const load=loader(),{createSubscriptionDiagnostics,safeProviderRequestId}=load('supabase/functions/_shared/subscriptionDiagnostics.ts'),{createRevenueCatAPI}=load('supabase/functions/_shared/revenuecat.ts');
const source=()=>({object:'subscription',id:'sub_PRIVATE',customer_id:A,original_customer_id:A,product_id:'prodPrivate',starts_at:Date.now()-60000,ends_at:Date.now()+86400000,gives_access:true,pending_payment:false,status:'active',auto_renewal_status:'will_renew',environment:'production',store:'app_store',store_subscription_identifier:'2001',ownership:'purchased',entitlements:{object:'list',items:[{object:'entitlement',state:'active',project_id:config.project,lookup_key:'plus'}],next_page:null}});
function endpoint(url){const p=new URL(url).pathname;if(p.includes('/apps/'))return 'app';if(p.includes('/products/'))return 'product';if(p.endsWith('/entitlements'))return 'subscription_entitlements';if(p.includes('/customers/')&&p.endsWith('/subscriptions'))return 'customer_subscriptions';if(p.includes('/customers/'))return 'customer';if(p.endsWith('/subscriptions'))return 'subscription_search';return 'subscription';}
function provider(options={}){const logs=[],calls=[],diagnostics=createSubscriptionDiagnostics(e=>logs.push(e));let clock=0;const now=()=>Date.now()+clock++;
 const fetcher=async(url)=>{const category=endpoint(url);calls.push(category);if(options.transport)throw Error('PRIVATE_NETWORK_ERROR '+config.secret+' '+A);
 if(options.fail===category)return new Response('PRIVATE_BILLING_BODY '+A,{status:options.status??403,headers:{'x-request-id':options.requestId??requestId}});
 if(options.malformed)return new Response('PRIVATE_MALFORMED_RESPONSE');
 let value;
 if(category==='app')value={id:config.app,project_id:config.project,type:'app_store',app_store:{bundle_id:'no.strandeconsulting.sleepy'}};
 if(category==='customer')value={id:A,project_id:config.project};
 if(category==='customer_subscriptions')value={object:'list',items:options.known?[]:[source()],next_page:null};
 if(category==='subscription')value=source();
 if(category==='product')value={id:'prodPrivate',object:'product',app_id:config.app,type:'subscription',store_identifier:'sleepy_plus_monthly'};
 if(category==='subscription_entitlements')value={object:'list',items:source().entitlements.items,next_page:null};
 if(category==='subscription_search')value={object:'list',items:[{id:'sub_PRIVATE'}],next_page:null};
 if(options.entitlementPage&&category==='customer_subscriptions')value.items[0].entitlements={next_page:'more',items:[]};
 return Response.json(value,{headers:{'x-request-id':requestId}});
 };
 return {logs,calls,diagnostics,fetcher,api:createRevenueCatAPI(config,fetcher,now,diagnostics)};
}
function assertSafe(logs){const text=JSON.stringify(logs);for(const value of [A,H,config.secret,'sub_PRIVATE','2001','PRIVATE_BILLING','PRIVATE_NETWORK','PRIVATE_MALFORMED','PRIVATE_JWT','PRIVATE_KEY','PRIVATE_RECEIPT','PRIVATE_TRANSACTION'])assert.ok(!text.includes(value),'logs leaked '+value);assert.ok(!text.includes('Authorization'));}

test('every RevenueCat endpoint logs a static stage/category and preserves 401/403 public 503',async()=>{
 for(const fail of ['app','customer','customer_subscriptions','subscription','product','subscription_entitlements','subscription_search'])for(const status of [401,403]){
  const f=provider({fail,status,known:fail==='subscription',entitlementPage:fail==='subscription_entitlements'});
  await assert.rejects(f.api.snapshot(A,fail==='subscription'?['sub_PRIVATE']:[],fail==='subscription_search'?'2001':undefined),e=>e.status===503&&e.message==='provider_unavailable');
  const last=f.logs.at(-1);assert.equal(last.endpoint,fail);assert.equal(last.http_status,status);assert.equal(last.category,'provider_auth_or_permission');assert.equal(last.attempt,1);assert.equal(last.request_id,requestId);assert.ok(last.elapsed_ms>=0);assertSafe(f.logs);
 }
});
test('retries retain attempt/status and safe request ID without reading error bodies',async()=>{
 const f=provider({fail:'app',status:503});await assert.rejects(f.api.snapshot(A));assert.equal(f.logs.length,2);assert.equal(f.logs[0].outcome,'retry');assert.equal(f.logs[1].outcome,'failure');assert.equal(f.logs[1].attempt,2);assert.equal(f.logs[1].http_status,503);assertSafe(f.logs);
});
test('429, missing customers, network failures and malformed 200 responses stay distinguishable',async()=>{
 const rate=provider({fail:'app',status:429});await assert.rejects(rate.api.snapshot(A));assert.equal(rate.logs.at(-1).http_status,429);
 const missing=provider({fail:'customer',status:404});assert.equal((await missing.api.snapshot(A)).length,0);assert.equal(missing.logs.at(-1).outcome,'missing');
 const network=provider({transport:true});await assert.rejects(network.api.snapshot(A));assert.equal(network.logs.at(-1).category,'provider_transport_failure');assert.equal(network.logs.at(-1).http_status,null);assertSafe(network.logs);
 const malformed=provider({malformed:true});await assert.rejects(malformed.api.snapshot(A));assert.equal(malformed.logs.at(-1).category,'provider_response_validation');assert.equal(malformed.logs.at(-1).http_status,200);assertSafe(malformed.logs);
});
test('request-id sanitizer drops credentials, private-ID echoes, arbitrary text and numeric transactions',async()=>{
 for(const value of [A,'sub_PRIVATE','2001','sk_PRIVATESECRET','Bearer PRIVATE_JWT','https://example.invalid/PRIVATE_KEY','PRIVATE_RECEIPT'])assert.equal(safeProviderRequestId(value,[A,'sub_PRIVATE',config.secret]),null);
 assert.equal(safeProviderRequestId(requestId,[A]),requestId);const f=provider({fail:'app',requestId:A});await assert.rejects(f.api.snapshot(A));assert.equal(f.logs[0].request_id,null);assertSafe(f.logs);
});
test('logger allowlist drops arbitrary fields and never changes results when sink throws',async()=>{
 const logs=[],d=createSubscriptionDiagnostics(e=>logs.push(e));d.emit('rpc','failure',{rpc_name:'revenuecat_apply',postgres_code:'42501',category:'rpc_failure',authorization:'Bearer PRIVATE_JWT',body:{receipt:'PRIVATE_RECEIPT'}});
 assert.equal(logs[0].postgres_code,'42501');assert.ok(!JSON.stringify(logs).includes('PRIVATE'));d.emit('rpc','failure',{rpc_name:A,postgres_code:'PRIVATE_KEY'});assert.equal(logs[1].rpc_name,undefined);assert.equal(logs[1].postgres_code,null);
 const broken=createSubscriptionDiagnostics(()=>{throw Error('Sink unavailable')});assert.equal(await broken.run('apply_rpc',async()=>42),42);await assert.rejects(broken.run('apply_rpc',async()=>{throw Error('original')}),/original/);
});
test('RPC diagnostics retain only allowlisted name and SQLSTATE/PostgREST code',async()=>{
 const logs=[],d=createSubscriptionDiagnostics(e=>logs.push(e));const result={data:null,error:{code:'PGRST202',message:'PRIVATE_KEY '+A,details:'PRIVATE_RECEIPT',hint:'PRIVATE_TRANSACTION'}};
 assert.equal(await d.rpc('revenuecat_begin',async()=>result),result);assert.equal(logs[0].rpc_name,'revenuecat_begin');assert.equal(logs[0].postgres_code,'PGRST202');assertSafe(logs);
 await assert.rejects(d.rpc('revenuecat_apply',async()=>{throw {code:'40001',message:'PRIVATE_TRANSACTION'}}));assert.equal(logs.at(-1).postgres_code,'40001');assertSafe(logs);
});
let signingKey;async function appleConfig(){if(!signingKey){const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);signingKey=Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');}return {issuer:A,keyId:'FIXTURE123',privateKey:'-----BEGIN PRIVATE KEY-----\n'+signingKey+'\n-----END PRIVATE KEY-----'};}
const appleSource=()=>({id:'sub_PRIVATE',transaction:'2001',product:'sleepy_plus_monthly',environment:'production'});
function appleResponse(){return Response.json({signedTransactionInfo:'header.'+Buffer.from(JSON.stringify({bundleId:'no.strandeconsulting.sleepy',transactionId:'2001',originalTransactionId:'1001',productId:'sleepy_plus_monthly',environment:'Production',type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',purchaseDate:Date.now()-1000})).toString('base64url')+'.signature'});}
test('Apple credentials, HTTP verification and response validation fail at separate safe stages',async()=>{
 const {createAppleChainVerifier}=load('supabase/functions/_shared/appleSubscriptionChain.ts');
 for(const mode of ['credentials','http','validation','success']){const logs=[],d=createSubscriptionDiagnostics(e=>logs.push(e));const cfg=await appleConfig();
  const verify=createAppleChainVerifier(mode==='credentials'?{...cfg,privateKey:''}:cfg,async()=>mode==='http'?new Response('PRIVATE_BILLING',{status:401}):mode==='validation'?new Response('PRIVATE_RECEIPT'):appleResponse(),()=>Date.now(),d);
  if(mode==='success'){const result=await verify(appleSource());assert.equal(result.chain,'1001');assert.ok(logs.some(e=>e.stage==='apple_response_validation'&&e.outcome==='success'));}
  else{await assert.rejects(verify(appleSource()));const stage=mode==='credentials'?'apple_credentials':mode==='http'?'apple_http_verification':'apple_response_validation';assert.ok(logs.some(e=>e.stage===stage&&e.outcome==='failure'));if(mode==='http')assert.equal(logs.find(e=>e.stage===stage).http_status,401);}
  assertSafe(logs);assert.ok(!JSON.stringify(logs).includes(cfg.privateKey));
 }
});
function runtime(options={}){const logs=[],calls=[],f=provider(),env={SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'PRIVATE_ANON',SUPABASE_SERVICE_ROLE_KEY:'PRIVATE_SERVICE',REVENUECAT_SECRET_API_KEY:config.secret,REVENUECAT_PROJECT_ID:config.project,REVENUECAT_APP_ID:config.app};
 const rpc=async(name)=>{calls.push(name);return name===options.rpcFail?{data:null,error:{code:options.code??'XX000',message:'PRIVATE_JWT '+A,details:'PRIVATE_BILLING'}}:{data:name==='revenuecat_begin'?{revision:1,subscription_ids:[]}:name==='revenuecat_apply'?{householdId:H,state:'verified'}:{household_id:H,tier:'free',is_plus:false},error:null}};
 const fetcher=async(url)=>{if(options.providerFail)return new Response('PRIVATE_BILLING',{status:403});if(!options.sources&&endpoint(url)==='customer_subscriptions')return Response.json({object:'list',items:[],next_page:null});return f.fetcher(url)};
 const read=loader({Deno:{env:{get:name=>env[name]}},fetch:fetcher,console:{info:line=>logs.push(JSON.parse(line))}},{'npm:@supabase/supabase-js@2.57.4':{createClient:()=>({rpc,auth:{getUser:async()=>({data:{user:{id:A}},error:null})}})}});
 const handlers=read('supabase/functions/_shared/subscriptionRuntime.ts').subscriptionRuntime();
 const request=()=>new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer PRIVATE_JWT'},body:JSON.stringify({action:'reconcile'})});
 return {handlers,logs,calls,request};
}
test('runtime identifies begin/apply/resolve RPC failures with unchanged public errors',async()=>{
 for(const name of ['revenuecat_begin','revenuecat_apply','resolve_household_entitlements']){const f=runtime({rpcFail:name});const response=await f.handlers.authenticated(f.request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'subscription_operation_unavailable'});assert.ok(f.logs.some(e=>e.stage==='rpc'&&e.rpc_name===name&&e.postgres_code==='XX000'));assertSafe(f.logs);}
 for(const [code,status] of [['42501',403],['40001',409],['53000',429]]){const f=runtime({rpcFail:'revenuecat_begin',code});assert.equal((await f.handlers.authenticated(f.request())).status,status);assertSafe(f.logs);}
});
test('runtime public 503 preserves provider error but logs real upstream 403 at the app lookup',async()=>{
 const f=runtime({providerFail:true});const response=await f.handlers.authenticated(f.request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'provider_unavailable'});assert.ok(f.logs.some(e=>e.stage==='revenuecat_app_lookup'&&e.category==='provider_auth_or_permission'&&e.http_status===403));assert.deepEqual(f.calls,['revenuecat_begin']);assertSafe(f.logs);
});
test('runtime identifies Apple credential configuration and never applies unverified sources',async()=>{
 const f=runtime({sources:true});const response=await f.handlers.authenticated(f.request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'apple_configuration_unavailable'});assert.ok(f.logs.some(e=>e.stage==='apple_credentials'&&e.outcome==='failure'));assert.ok(!f.calls.includes('revenuecat_apply'));assertSafe(f.logs);
});
test('successful reconciliation logs job, provider, apply and resolve in order without client diagnostics',async()=>{
 const f=runtime();const response=await f.handlers.authenticated(f.request());assert.equal(response.status,200);const result=await response.json();assert.equal(result.entitlement.tier,'free');assert.equal(result.diagnostics,undefined);
 const starts=f.logs.filter(e=>e.outcome==='start').map(e=>e.stage);assert.ok(starts.indexOf('reconciliation_job')<starts.indexOf('revenuecat_snapshot'));assert.ok(starts.indexOf('revenuecat_snapshot')<starts.indexOf('apply_rpc'));assert.ok(starts.indexOf('apply_rpc')<starts.indexOf('entitlement_resolve'));assertSafe(f.logs);
});

test('invalid provider configuration emits only a safe configuration category before any request',()=>{
 const logs=[],d=createSubscriptionDiagnostics(e=>logs.push(e));assert.throws(()=>createRevenueCatAPI({...config,secret:'PRIVATE_BAD_KEY'},async()=>{throw Error('must not fetch')},()=>0,d),e=>e.status===503&&e.message==='subscription_configuration_unavailable');assert.equal(logs[0].stage,'provider_configuration');assertSafe(logs);
});
test('logging malformed job/entitlement results identifies the validation boundary without contents',async()=>{
 const {createSubscriptionHandlers}=load('supabase/functions/_shared/subscriptionHandlers.ts');
 for(const mode of ['job','apply','resolve']){const logs=[],d=createSubscriptionDiagnostics(e=>logs.push(e));const handlers=createSubscriptionHandlers({diagnostics:d,config:()=>config,authenticate:async()=>A,
 rpc:async name=>name==='revenuecat_begin'?(mode==='job'?{revision:'PRIVATE_KEY',subscription_ids:[]}:{revision:1,subscription_ids:[]}):mode==='apply'?null:{householdId:H,state:'verified'},snapshot:async()=>[],resolve:async()=>({household_id:H,tier:'PRIVATE_BILLING',is_plus:true})});
 const response=await handlers.authenticated(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer PRIVATE_JWT'},body:JSON.stringify({action:'reconcile'})}));assert.ok(response.status>=500);const stage=mode==='job'?'reconciliation_job':mode==='apply'?'apply_rpc':'entitlement_resolve';assert.ok(logs.some(e=>e.stage===stage&&e.outcome==='failure'));assertSafe(logs);
 }
});
