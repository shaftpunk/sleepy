const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const A='11111111-1111-4111-8111-111111111111',H='33333333-3333-4333-8333-333333333333';
const context={userId:A,babyId:'baby',householdId:H};
function loader(mocks={}){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,Date,console,require:name=>{if(name in mocks)return mocks[name];if(name==='react'||name==='react/jsx-runtime')return require(name);
    const p=path.join(path.dirname(file),name);return load(fs.existsSync(p+'.ts')?p+'.ts':p+'.tsx');}});return exports;}return load;}
const load=loader(),model=load('src/purchases/revenueCatModel.ts'),{createPurchaseTestController}=load('src/purchases/purchaseTestController.ts');
const evidence={...model.EMPTY_PURCHASE_EVIDENCE,status:'active',environment:'sandbox',productIdentifier:'sleepy_plus_monthly'};
const diagnostics={available:true,configured:true,appUserIdPrefix:'11111111…',evidence};
const server={state:'sandboxVerified',subscriptionState:'sandbox',householdId:H,entitlement:{householdId:H,tier:'free',isPlus:false,verificationState:'verified',validUntil:null}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(overrides={},ctx=context){const calls=[],env={current:true};
  const services={diagnostics:async()=>diagnostics,refresh:async()=>{calls.push('refresh');},reconcile:async()=>{calls.push('reconcile');return server;},
    purchase:async(plan,c)=>{calls.push([plan,c]);return {status:'purchased',evidence,issue:null,reconciliation:server};},
    restore:async()=>{calls.push('restore');return {status:'restored',evidence,issue:null,reconciliation:server};},...overrides};
  return {controller:createPurchaseTestController(A,ctx,()=>env.current,services),calls,env};}
function view(){return loader({'../auth/AuthProvider':{},'../auth/sessionLifecycle':{},'../households/HouseholdContextProvider':{},
  '../entitlements/EntitlementProvider':{},'../i18n':{},'../purchases/PurchaseEvidenceContext':{},
  '../services/revenueCatService':{revenueCatAvailable:()=>false}})('src/components/SleepyPlusTestPanel.tsx');}
const translate=lang=>{const strings=load(`src/i18n/${lang}.ts`).default;return key=>key.split('.').reduce((v,k)=>v[k],strings);};
test('purchase test panel is absent on web without needing auth or native hooks',()=>{
  assert.equal(renderToStaticMarkup(React.createElement(view().default)),'');
});
test('monthly and annual delegate once to the shared purchase service with exact explicit context',async()=>{
  for(const plan of ['monthly','annual']){const f=fixture();await f.controller.run(plan);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],plan);assert.equal(f.calls[0][1],context);
    assert.equal(f.controller.snapshot().reconciliation.state,'sandboxVerified');assert.equal(f.controller.snapshot().reconciliation.entitlement.isPlus,false);}
  const f=fixture({},null);await f.controller.run('monthly');assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().issue,'context');
});
test('restore uses existing restore/reconcile service and never supplies a guessed household',async()=>{
  const f=fixture({},null);await f.controller.run('restore');assert.deepEqual(f.calls,['restore']);assert.equal(f.controller.snapshot().reconciliation.state,'sandboxVerified');
});
test('accepted purchase with server failure stays activation-pending and cannot trigger another charge',async()=>{
  const f=fixture({purchase:async()=>({status:'purchased',evidence,issue:null,reconciliation:{state:'pending',householdId:null}}),reconcile:async()=>{throw Error('PRIVATE TOKEN');}});
  await f.controller.run('monthly');assert.equal(f.controller.snapshot().paymentPending,true);
  await f.controller.run('annual');await f.controller.run('refresh');assert.equal(f.controller.snapshot().result.status,'purchased');assert.equal(f.controller.snapshot().paymentPending,true);
  assert.equal(f.controller.snapshot().serverError,true);assert.ok(!JSON.stringify(f.controller.snapshot()).includes('PRIVATE'));
});
test('refresh is SDK refresh then safe server reconciliation, clearing pending only after verification',async()=>{
  const f=fixture({purchase:async()=>({status:'purchased',evidence,issue:null,reconciliation:{state:'pending',householdId:null}})});
  await f.controller.run('monthly');await f.controller.run('refresh');assert.deepEqual(f.calls,['refresh','reconcile']);assert.equal(f.controller.snapshot().paymentPending,false);
});
test('synchronous operation lock prevents concurrent purchase taps',async()=>{
  const d=deferred();let purchases=0;const f=fixture({purchase:async()=>{purchases++;return d.promise;}});
  const op=f.controller.run('monthly');await f.controller.run('annual');await f.controller.run('restore');assert.equal(purchases,1);
  d.resolve({status:'purchased',evidence,issue:null,reconciliation:server});await op;assert.equal(f.controller.snapshot().busy,false);
});
test('logout generation fencing and context disposal discard delayed previous-account diagnostics',async()=>{
  for(const mode of ['generation','unmount']){const d=deferred();const f=fixture({diagnostics:async()=>d.promise});const op=f.controller.inspect();
    if(mode==='generation')f.env.current=false;else f.controller.dispose();d.resolve(diagnostics);await op;assert.equal(f.controller.snapshot().diagnostics,null);}
  const component=fs.readFileSync('src/components/SleepyPlusTestPanel.tsx','utf8');
  assert.match(component,/key=\{\[user.id, sessionGeneration\(\), household.babyId, household.householdId/);
  assert.match(component,/household.userId !== user.id/);
});
test('EN/NO panel shortens identities, renders sandbox Free truthfully, and excludes billing/token payloads',()=>{
  for(const lang of ['en','no']){const t=translate(lang),html=renderToStaticMarkup(React.createElement(view().SleepyPlusTestView,{userId:A,householdId:H,
    state:{busy:false,diagnostics:{...diagnostics,evidence:{...evidence,receipt:'PRIVATE_RECEIPT',access_token:'PRIVATE_JWT'}},reconciliation:server,result:null,serverError:false,issue:null,paymentPending:false},
    resolved:{tier:'plus',isPlus:true},onAction:()=>{},translate:t}));
    assert.ok(html.includes(t('plusTesting.title')));assert.ok(html.includes(t('plusTesting.sandboxNotice')));assert.ok(html.includes('11111111…'));assert.ok(html.includes('33333333…'));
    assert.ok(!html.includes(A)&&!html.includes(H));assert.doesNotMatch(html,/PRIVATE_RECEIPT|PRIVATE_JWT/);assert.match(html,/is_plus<\/dt><dd>(No|Nei)/);assert.match(html,/tier<\/dt><dd>free/);
    assert.match(html,/aria-live="polite"/);assert.equal((html.match(/<button/g)||[]).length,4);
  }
});
test('pending accepted purchase has safe localized message; cancellation is calm; unknown server never falls back to Plus',()=>{
  const t=translate('en'),base={userId:A,householdId:H,resolved:{tier:'plus',isPlus:true},onAction:()=>{},translate:t};
  for(const status of ['purchased','cancelled']){const html=renderToStaticMarkup(React.createElement(view().SleepyPlusTestView,{...base,
    state:{busy:false,diagnostics,reconciliation:{state:'pending',householdId:null},result:{status,evidence,issue:null},serverError:true,issue:null,paymentPending:status==='purchased'}}));
    assert.ok(html.includes(status==='purchased'?t('plusTesting.activationPending'):t('purchases.cancelled')));assert.match(html,/tier<\/dt><dd>unknown/);
  }
  const html=renderToStaticMarkup(React.createElement(view().SleepyPlusTestView,{...base,
    state:{busy:false,diagnostics,reconciliation:server,result:{status:'purchased',evidence,issue:null,reconciliation:{state:'pending',householdId:null}},serverError:false,issue:null,paymentPending:false}}));
  assert.ok(html.includes(t('purchases.sandboxVerified')));assert.ok(!html.includes(t('plusTesting.activationPending')));
});
