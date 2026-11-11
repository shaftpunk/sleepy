const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const crypto=require('node:crypto').webcrypto;
const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Date,Promise,Request,Response,AbortSignal,TextEncoder,TextDecoder,URL,crypto,btoa,atob,Uint8Array,setTimeout,
      require:name=>load(path.join(path.dirname(file),name))});return exports;}
const {createAppleChainVerifier}=load('supabase/functions/_shared/appleSubscriptionChain.ts');
let keypair;const keys=async()=>keypair??=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
async function fixture(overrides={}){
  const key=await keys(),bytes=await crypto.subtle.exportKey('pkcs8',key.privateKey);
  const config={issuer:'11111111-1111-4111-8111-111111111111',keyId:'FIXTURE123',privateKey:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(bytes).toString('base64')+'\n-----END PRIVATE KEY-----',...overrides};
  const env={chain:'1001',product:'sleepy_plus_monthly',environment:'Production',calls:[]};
  const fetcher=async(url,init)=>{
    env.calls.push({url,init});if(env.fail)return new Response('{}',{status:500});
    const id=new URL(url).pathname.split('/').pop(),payload={bundleId:'no.strandeconsulting.sleepy',transactionId:id,originalTransactionId:env.chain,
      productId:env.product,environment:env.environment,type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',purchaseDate:Date.now()-1000,...env.payload};
    return Response.json({signedTransactionInfo:'eyJhbGciOiJFUzI1NiJ9.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fixture'});
  };
  return {verify:createAppleChainVerifier(config,fetcher),env,key};
}
const source=(props={})=>({id:'subFixture',transaction:'2001',product:'sleepy_plus_monthly',environment:'production',...props});
test('Apple API derives original chain through fixed authenticated HTTPS and signs short-lived ES256 JWT',async()=>{
  const f=await fixture(),result=await f.verify(source());assert.equal(result.chain,'1001');assert.ok(result.purchaseAt);
  const {url,init}=f.env.calls[0];assert.equal(url,'https://api.storekit.apple.com/inApps/v1/transactions/2001');assert.equal(init.redirect,'error');
  const token=init.headers.Authorization.slice(7),[header,body,signature]=token.split('.'),claims=JSON.parse(Buffer.from(body,'base64url'));
  assert.equal(claims.bid,'no.strandeconsulting.sleepy');assert.equal(claims.aud,'appstoreconnect-v1');assert.equal(claims.exp-claims.iat,120);
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},f.key.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(header+'.'+body)),true);
});
test('monthly to yearly keeps Apple chain even when RC subscription segment and latest transaction change',async()=>{
  const f=await fixture(),monthly=await f.verify(source());f.env.product='sleepy_plus_yearly';
  const annual=await f.verify(source({id:'subAnnual',product:'sleepy_plus_yearly',transaction:'3001'}));assert.equal(annual.chain,monthly.chain);
  f.env.chain='9001';assert.notEqual((await f.verify(source({product:'sleepy_plus_yearly'}))).chain,monthly.chain);
});
test('sandbox uses only sandbox endpoint and cannot be relabelled production',async()=>{
  const f=await fixture();f.env.environment='Sandbox';assert.equal((await f.verify(source({environment:'sandbox'}))).environment,'sandbox');
  assert.ok(f.env.calls[0].url.startsWith('https://api.storekit-sandbox.apple.com/'));await assert.rejects(f.verify(source()),/invalid_apple_response/);
});
test('Apple binding rejects wrong bundle, transaction, product, ownership, chain and invalid purchase dates',async()=>{
  for(const payload of [{bundleId:'other'},{transactionId:'999'},{originalTransactionId:null},{inAppOwnershipType:'FAMILY_SHARED'},{purchaseDate:'now'},{type:'Consumable'}]){
    const f=await fixture();f.env.payload=payload;await assert.rejects(f.verify(source()),/invalid_apple_response/);
  }
  const f=await fixture();f.env.product='other';await assert.rejects(f.verify(source()),/apple_product_mismatch/);
});
test('client hint must have independent RC correlation plus Apple chain/product match',async()=>{
  const f=await fixture();assert.equal((await f.verify(source(),'3001')).correlation,undefined);assert.equal(f.env.calls.length,1);
  const result=await f.verify(source({correlation:'3001'}),'3001');assert.equal(result.correlation,'3001');
  assert.ok(f.env.calls.some(c=>c.url.endsWith('/3001')));
});
test('missing Apple config, redirects/network/server failures and invalid transaction IDs fail closed',async()=>{
  await assert.rejects((await fixture({privateKey:''})).verify(source()),/apple_configuration_unavailable/);
  const f=await fixture();f.env.fail=true;await assert.rejects(f.verify(source()),/apple_verification_unavailable/);assert.equal(f.env.calls.length,2);
  await assert.rejects(f.verify(source({transaction:'../elsewhere'})),/invalid_apple_transaction/);
});
