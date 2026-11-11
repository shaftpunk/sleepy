const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function loader(){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Date,console,Promise,require:name=>{
    if(name==='@revenuecat/purchases-capacitor')return {...load('node_modules/@revenuecat/purchases-typescript-internal-esm/dist/generated/error-codes.js'),...load('node_modules/@revenuecat/purchases-typescript-internal-esm/dist/enums.js')};
    return load(path.join(path.dirname(file),name)+'.ts');}});return exports;}return load;}
const load=loader(),{createRevenueCatClient}=load('src/purchases/revenueCatClient.ts');
const {customerEvidence,offeringPackage}=load('src/purchases/revenueCatModel.ts');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',H='33333333-3333-4333-8333-333333333333';
const context={userId:A,babyId:'baby',householdId:H};
const info=(active=false)=>{const entitlements=active?{plus:{identifier:'plus',isActive:true,willRenew:true,productIdentifier:'sleepy_plus_monthly',expirationDate:new Date(Date.now()+86400000).toISOString()}}:{};return {entitlements:{all:{...entitlements},active:entitlements}};};
function offering(){return {current:{identifier:'default',availablePackages:['monthly','annual'].map(plan=>({identifier:plan==='monthly'?'$rc_monthly':'$rc_annual',product:{identifier:plan==='monthly'?'sleepy_plus_monthly':'sleepy_plus_yearly'},presentedOfferingContext:{offeringIdentifier:'default'}}))}};}
function fixture(options={}){
  const calls=[],listeners=new Map();let next=0;
  const env={user:A,generation:0,native:true,key:'appl_fixturePublicKey',configured:false,identity:null,info:info(),...options};
  const sdk={isConfigured:async()=>({isConfigured:env.configured}),setLogLevel:async()=>{},
    configure:async value=>{calls.push(['configure',value]);env.configured=true;env.identity=value.appUserID;},
    getAppUserID:async()=>({appUserID:env.identity}),isAnonymous:async()=>({isAnonymous:env.identity?.startsWith('$RCAnonymousID:')||false}),
    logIn:async value=>{calls.push(['login',value.appUserID]);env.identity=value.appUserID;return {customerInfo:env.info};},
    logOut:async()=>{throw Error('Must never create an anonymous RevenueCat identity');},
    addCustomerInfoUpdateListener:async fn=>{const id=String(++next);listeners.set(id,fn);return id;},
    removeCustomerInfoUpdateListener:async({listenerToRemove:id})=>{listeners.delete(id);return {wasRemoved:true};},
    getCustomerInfo:async()=>{calls.push(['info']);if(env.fetchError)throw env.fetchError;return {customerInfo:env.info};},
    getOfferings:async()=>{calls.push(['offerings']);return env.offerings||offering();},
    purchasePackage:async({aPackage})=>{calls.push(['purchase',aPackage.identifier]);if(env.purchaseError)throw env.purchaseError;env.info=info(true);return {customerInfo:env.info};},
    restorePurchases:async()=>{calls.push(['restore']);if(env.restoreError)throw env.restoreError;env.info=info(true);return {customerInfo:env.info};},
  };
  const client=createRevenueCatClient({sdk,supported:()=>env.native,apiKey:()=>env.key,generation:()=>env.generation,authenticatedUser:async()=>env.user,validatePurchaseContext:async()=>env.membershipValid!==false,
    preparePurchase:options.preparePurchase,reconcilePurchase:options.reconcilePurchase,cancelPurchase:options.cancelPurchase});
  async function ready(){await client.initializeRevenueCat(env.user);client.setPurchaseContext({...context,userId:env.user});}
  return {client,sdk,env,calls,listeners,ready};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));

test('explicit store cancellation expires only its purchase attempt; pending approval does not cancel it',async()=>{
  for(const code of ['1','20']){
    const cancelled=[];const f=fixture({preparePurchase:async()=>H,cancelPurchase:async id=>cancelled.push(id),purchaseError:{code}});
    await f.ready();const result=await f.client.purchaseRevenueCatPackage('monthly',context);
    assert.equal(result.status,code==='1'?'cancelled':'pending');assert.deepEqual(cancelled,code==='1'?[H]:[]);
  }
});

test('configure uses authenticated canonical UUID, verifies SDK identity, and never uses email or anonymous configuration',async()=>{
  const f=fixture();await f.ready();assert.equal(f.calls[0][1].appUserID,A);assert.equal(f.client.snapshot().status,'none');assert.equal(f.listeners.size,1);
  await assert.rejects(f.client.initializeRevenueCat('parent@example.com'),/authentication/);assert.equal(f.client.snapshot().status,'unavailable');assert.equal(f.listeners.size,0);
});
test('wrong authenticated user or SDK identity fails without publishing customer evidence',async()=>{
  const f=fixture({user:B});await f.client.initializeRevenueCat(A);assert.equal(f.client.snapshot().status,'error');assert.equal(f.calls.length,0);
  const g=fixture();g.sdk.getAppUserID=async()=>({appUserID:B});await g.ready();assert.equal(g.client.snapshot().issue,'identity');
});
test('web/PWA and missing/secret/Test Store keys never initialize native purchases',async()=>{
  for(const options of [{native:false},{key:undefined},{key:'sk_secret'},{key:'test_fake'}]){const f=fixture(options);await f.ready();assert.equal(f.calls.length,0);assert.equal(f.client.snapshot().status,'unavailable');}
});
test('logout immediately clears state and listener; account switching uses logIn UUID without anonymous logOut',async()=>{
  const f=fixture({info:info(true)});await f.ready();const old=[...f.listeners.values()][0];
  const reset=f.client.resetRevenueCatSession();assert.equal(f.client.snapshot().status,'unavailable');await reset;assert.equal(f.listeners.size,0);
  f.env.user=B;f.env.generation++;f.env.info=info();await f.ready();old(info(true));await tick();
  assert.equal(f.env.identity,B);assert.equal(f.client.snapshot().status,'none');assert.equal(f.listeners.size,1);assert.ok(f.calls.some(c=>c[0]==='login'&&c[1]===B));
});
test('stale A CustomerInfo cannot update B, including when a refresh is in flight',async()=>{
  const f=fixture();await f.ready();const d=deferred();f.sdk.getCustomerInfo=async()=>d.promise;
  const old=f.client.refreshRevenueCatState();await tick();f.env.user=B;f.env.generation++;
  const next=f.client.initializeRevenueCat(B);assert.equal(f.client.snapshot().status,'loading');
  f.sdk.getCustomerInfo=async()=>({customerInfo:info()});d.resolve({customerInfo:info(true)});await old;await next;
  assert.equal(f.client.snapshot().status,'none');assert.equal(f.env.identity,B);
});
test('listener distrusts callback payload and refreshes under current verified identity',async()=>{
  const f=fixture();await f.ready();[...f.listeners.values()][0](info(true));await tick();await tick();assert.equal(f.client.snapshot().status,'none');
  f.env.info=info(true);[...f.listeners.values()][0](info());await tick();await tick();assert.equal(f.client.snapshot().status,'active');
});
test('foreground refresh retries failed identity initialization and keeps one effective listener',async()=>{
  const f=fixture({configured:true,identity:B});const login=f.sdk.logIn;f.sdk.logIn=async()=>{throw {code:'10'}};
  await f.ready();assert.equal(f.client.snapshot().status,'error');f.sdk.logIn=login;
  await f.client.refreshRevenueCatState();assert.equal(f.client.snapshot().status,'none');assert.equal(f.env.identity,A);assert.equal(f.listeners.size,1);
});
test('CustomerInfo distinguishes no entitlement, active, expired, malformed and refresh failure',async()=>{
  assert.equal(customerEvidence(info()).status,'none');assert.equal(customerEvidence(info(true)).status,'active');
  const expired=info(true);expired.entitlements.active.plus.expirationDate=new Date(Date.now()-1000).toISOString();assert.equal(customerEvidence(expired).status,'none');
  for(const value of [null,{}, {entitlements:{}},{entitlements:{all:[],active:{}}}])assert.throws(()=>customerEvidence(value));
  const malformed=info(true);delete malformed.entitlements.active.plus.willRenew;assert.throws(()=>customerEvidence(malformed));
  const f=fixture({info:info(true)});await f.ready();f.env.fetchError={code:'10',message:'RAW PRIVATE ERROR'};await f.client.refreshRevenueCatState();assert.equal(f.client.snapshot().status,'error');assert.equal(f.client.snapshot().entitlement,null);assert.equal(f.client.snapshot().issue,'network');
});
test('default offering monthly/annual packages validate real Apple mapping; Test Store/missing/wrong offering rejected',async()=>{
  for(const plan of ['monthly','annual'])assert.ok(offeringPackage(offering(),plan));
  for(const mutate of [o=>o.current=null,o=>o.current.identifier='other',o=>o.current.availablePackages=[],o=>o.current.availablePackages[0].product.identifier='test_store_monthly',o=>o.current.availablePackages[0].presentedOfferingContext.offeringIdentifier='other']){const o=offering();mutate(o);assert.throws(()=>offeringPackage(o,'monthly'),/offering/);}
  const f=fixture();await f.ready();assert.equal((await f.client.getRevenueCatOffering()).identifier,'default');
  f.sdk.getOfferings=async()=>{throw {code:'10',message:'RAW ERROR'}};await assert.rejects(f.client.getRevenueCatOffering(),e=>e.issue==='network'&&!e.message.includes('RAW'));
});
test('anonymous, missing, wrong and stale household purchases are rejected',async()=>{
  const f=fixture();assert.equal((await f.client.purchaseRevenueCatPackage('monthly',context)).status,'error');assert.equal((await f.client.restoreRevenueCatPurchases()).status,'error');
  await f.ready();for(const c of [undefined,{...context,userId:B},{...context,householdId:B},{...context,babyId:'other'}])assert.equal((await f.client.purchaseRevenueCatPackage('monthly',c)).status,'error');
  assert.equal(f.calls.filter(c=>c[0]==='purchase').length,0);
});
test('purchase context set before identity initialization survives; freshly removed membership blocks Apple purchase',async()=>{
  const f=fixture();f.client.setPurchaseContext(context);await f.client.initializeRevenueCat(A);
  assert.equal((await f.client.purchaseRevenueCatPackage('monthly',context)).status,'purchased');
  const g=fixture({membershipValid:false});await g.ready();assert.equal((await g.client.purchaseRevenueCatPackage('monthly',context)).issue,'context');assert.equal(g.calls.filter(c=>c[0]==='purchase').length,0);
});
for(const plan of ['monthly','annual'])test('successful '+plan+' purchase uses offering package, refreshes info, and creates no household access',async()=>{
  const f=fixture();await f.ready();const result=await f.client.purchaseRevenueCatPackage(plan,context);assert.equal(result.status,'purchased');assert.equal(result.evidence.status,'active');
  assert.deepEqual(f.calls.filter(c=>c[0]==='purchase'),[['purchase',plan==='monthly'?'$rc_monthly':'$rc_annual']]);assert.equal(f.calls.at(-1)[0],'info');assert.equal(Object.hasOwn(result.evidence,'householdId'),false);
});
test('changed household during offerings prevents purchase, even if changed away and back',async()=>{
  const f=fixture();await f.ready();const d=deferred();f.sdk.getOfferings=async()=>d.promise;
  const purchase=f.client.purchaseRevenueCatPackage('monthly',context);await tick();f.client.setPurchaseContext({...context,householdId:B});f.client.setPurchaseContext({...context});d.resolve(offering());
  assert.equal((await purchase).issue,'context');assert.equal(f.calls.filter(c=>c[0]==='purchase').length,0);
});
test('duplicate purchase attempts do not queue a second Apple sheet',async()=>{
  const f=fixture();await f.ready();const d=deferred();f.sdk.purchasePackage=async()=>d.promise;
  const first=f.client.purchaseRevenueCatPackage('monthly',context);await tick();assert.equal((await f.client.purchaseRevenueCatPackage('annual',context)).issue,'busy');d.resolve({customerInfo:info(true)});await first;
});
test('purchase cancellation, pending, network and store errors are typed and sanitized',async()=>{
  for(const [code,status,issue] of [['1','cancelled',null],['20','pending',null],['10','error','network'],['2','error','store'],['7','error','ownership']]){
    const f=fixture({purchaseError:{code,message:'RAW ERROR'}});await f.ready();const r=await f.client.purchaseRevenueCatPackage('monthly',context);assert.equal(r.status,status);assert.equal(r.issue,issue);assert.ok(!JSON.stringify(r).includes('RAW'));
  }
});
test('active subscriber avoids another charge; SDK already-owned response refreshes evidence',async()=>{
  const f=fixture({info:info(true)});await f.ready();assert.equal((await f.client.purchaseRevenueCatPackage('annual',context)).status,'alreadySubscribed');assert.equal(f.calls.filter(c=>c[0]==='purchase').length,0);
  const g=fixture({purchaseError:{code:'6'}});await g.ready();assert.equal((await g.client.purchaseRevenueCatPackage('monthly',context)).status,'alreadySubscribed');
});
test('completed purchase with failed refresh reports completion unknown, not a failed charge',async()=>{
  const f=fixture();await f.ready();f.sdk.purchasePackage=async()=>{f.env.fetchError={code:'10'};return {customerInfo:info(true)}};
  const r=await f.client.purchaseRevenueCatPackage('monthly',context);assert.equal(r.status,'completedUnknown');assert.equal(r.evidence.status,'error');
});
test('logout during Apple purchase never publishes the completed old purchase to another account',async()=>{
  const f=fixture();await f.ready();const d=deferred();f.sdk.purchasePackage=async()=>d.promise;const purchase=f.client.purchaseRevenueCatPackage('monthly',context);await tick();
  const reset=f.client.resetRevenueCatSession();f.env.user=B;f.env.generation++;const login=f.client.initializeRevenueCat(B);d.resolve({customerInfo:info(true)});
  const r=await purchase;await reset;await login;assert.equal(r.status,'completedUnknown');assert.equal(r.evidence.status,'unavailable');assert.equal(f.client.snapshot().status,'none');
});
test('authenticated restore detects Plus and refreshes; ownership failure stays unknown and never funds household',async()=>{
  const f=fixture();await f.ready();const r=await f.client.restoreRevenueCatPurchases();assert.equal(r.status,'restored');assert.equal(r.evidence.entitlement,'plus');assert.equal(f.calls.at(-1)[0],'info');
  const g=fixture({restoreError:{code:'13'}});await g.ready();assert.equal((await g.client.restoreRevenueCatPurchases()).issue,'ownership');assert.equal(g.client.snapshot().status,'error');
});
test('evidence is separate from server authority; compatibility and native scope remain intact',()=>{
  const provider=fs.readFileSync('src/entitlements/EntitlementProvider.tsx','utf8');assert.match(provider,/resolveHouseholdEntitlements/);assert.match(provider,/purchaseEvidence/);
  const model=fs.readFileSync('src/entitlements/model.ts','utf8');assert.doesNotMatch(model,/revenueCat|customerInfo/i);
  assert.match(fs.readFileSync('src/entitlements/features.ts','utf8'),/ENTITLEMENT_ENFORCEMENT_ENABLED = false/);
  const service=fs.readFileSync('src/services/revenueCatService.ts','utf8');assert.match(service,/supabase.auth.getUser/);assert.doesNotMatch(service,/\.from\(|\.insert\(|\.upsert\(/);
  assert.deepEqual(Object.keys(require('../package.json').dependencies).filter(n=>n.startsWith('@revenuecat/')),['@revenuecat/purchases-capacitor']);
});
test('typed result messages exist in EN/NO; native capability/plugin are scoped to App',()=>{
  const no=load('src/i18n/no.ts').default,en=load('src/i18n/en.ts').default;
  const {purchaseMessageKey}=load('src/purchases/purchaseMessages.ts');
  for(const status of ['purchased','restored','alreadySubscribed','cancelled','pending','completedUnknown']){
    const key=purchaseMessageKey({status});assert.equal(key,'purchases.'+status);assert.ok(no.purchases[status]);assert.ok(en.purchases[status]);
  }
  for(const issue of ['unavailable','notConfigured','authentication','context','identity','offering','network','store','ownership','busy','unknown']){
    assert.equal(purchaseMessageKey({status:'error',issue}),'purchases.'+issue);assert.ok(no.purchases[issue]);assert.ok(en.purchases[issue]);
  }
  for(const [state,key] of [['pending','activationPending'],['assignmentRequired','assignmentRequired'],['sandboxVerified','sandboxVerified'],['verified','statusUpdated']]){
    assert.equal(purchaseMessageKey({status:'purchased',reconciliation:{state,householdId:null}}),'purchases.'+key);assert.ok(no.purchases[key]);assert.ok(en.purchases[key]);
  }
  const xcode=require('xcode').project('ios/App/App.xcodeproj/project.pbxproj');xcode.parseSync();
  const attrs=xcode.hash.project.objects.PBXProject['504EC2FC1FED79650016851F'].attributes.TargetAttributes;
  assert.equal(Number(attrs['504EC3031FED79650016851F'].SystemCapabilities['com.apple.InAppPurchase'].enabled),1);
  assert.equal(attrs['A74000000000000000000013'].SystemCapabilities,undefined);
  assert.match(fs.readFileSync('ios/App/CapApp-SPM/Package.swift','utf8'),/RevenuecatPurchasesCapacitor/);
  assert.doesNotMatch(fs.readFileSync('ios/App/App/App.entitlements','utf8'),/InAppPurchase/);
});
test('server intent precedes Apple purchase; post-purchase verification delay does not turn success into failed charge',async()=>{
  const calls=[];const f=fixture({preparePurchase:async(c,plan)=>{assert.equal(c.householdId,H);assert.equal(plan,'monthly');calls.push('intent');return 'intent';},
    reconcilePurchase:async id=>{assert.equal(id,'intent');calls.push('reconcile');throw Error('Server delayed');}});
  await f.ready();const buy=f.sdk.purchasePackage;f.sdk.purchasePackage=async args=>{calls.push('apple');return buy(args);};
  const r=await f.client.purchaseRevenueCatPackage('monthly',context);assert.equal(r.status,'purchased');assert.equal(r.reconciliation.state,'pending');assert.deepEqual(calls,['intent','apple','reconcile']);
});
test('server preparation failure prevents charging; SDK refresh failure still attempts server reconciliation',async()=>{
  const f=fixture({preparePurchase:async()=>{throw Error('Offline');}});await f.ready();assert.equal((await f.client.purchaseRevenueCatPackage('monthly',context)).status,'error');assert.equal(f.calls.filter(c=>c[0]==='purchase').length,0);
  let reconciled=false;const g=fixture({preparePurchase:async()=>'intent',reconcilePurchase:async()=>{reconciled=true;return {state:'verified',householdId:H};}});await g.ready();
  g.sdk.purchasePackage=async()=>{g.env.fetchError={code:'10'};return {customerInfo:info(true)};};
  const r=await g.client.purchaseRevenueCatPackage('monthly',context);assert.equal(r.status,'completedUnknown');assert.equal(r.reconciliation.state,'verified');assert.equal(reconciled,true);
});
test('restore never sends current household or new intent to reconciliation',async()=>{
  let call;const f=fixture({reconcilePurchase:async(id,restore)=>{call={id,restore};return {state:'assignmentRequired',householdId:null};}});
  await f.ready();const r=await f.client.restoreRevenueCatPurchases();assert.deepEqual(call,{id:undefined,restore:true});assert.equal(r.status,'restored');assert.equal(r.reconciliation.state,'assignmentRequired');
});
