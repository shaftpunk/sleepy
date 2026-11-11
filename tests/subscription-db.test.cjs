const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {householdDatabase,uuid,asUser}=require('./helpers/household-database.cjs');
const enabled=!!process.env.SLEEPY_TEST_PGLITE;
const [A,B,V,C,H,J,BABY]=Array.from({length:7},(_,i)=>uuid(i+101));
const project='projFixture',app='appFixture';
async function setup(){const db=await householdDatabase();await db.exec(fs.readFileSync('supabase/migrations/20261113090000_revenuecat_verified_funding.sql','utf8'));
  for(const id of [A,B,V,C])await db.query('insert into auth.users(id) values($1)',[id]);
  for(const [id,owner] of [[H,A],[J,B]])await db.query("insert into households(id,name,created_by_user_id) values($1,'Fixture',$2)",[id,owner]);
  for(const [h,u,role] of [[H,A,'owner'],[H,V,'viewer'],[H,C,'caregiver'],[J,B,'parent'],[J,A,'parent']])await db.query('insert into household_members(household_id,user_id,role) values($1,$2,$3)',[h,u,role]);
  await db.query("insert into babies(id,name,created_by_user_id) values($1,'Baby',$2)",[BABY,A]);await db.query('insert into baby_households values($1,$2,now())',[BABY,H]);return db;
}
const begin=async(db,user=A)=>(await db.query('select revenuecat_begin($1,$2,$3) r',[user,project,app])).rows[0].r;
const prepare=async(db,user=A,h=H,known=[])=>(await db.query("select revenuecat_prepare($1,$2,$3,$4,$5,'sleepy_plus_monthly',$6,$7) r",[user,project,app,h,BABY,known,uuid(201)])).rows[0].r;
const source=(options={})=>({id:'subFixture',chain:options.chain??options.id??'subFixture',purchaseAt:new Date(Date.now()+1000).toISOString(),product:'sleepy_plus_monthly',environment:'production',startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),access:true,status:'active',renewal:'will_renew',pending:false,transaction:'latest-transaction',correlation:'latest-transaction',...options});
const apply=async(db,version,sources,intent=null,user=A,transaction='latest-transaction')=>(await db.query('select revenuecat_apply($1,$2,$3,$4,$5,$6,$7) r',[user,project,app,version,JSON.stringify(sources),intent,transaction])).rows[0].r;
const tier=async(db,user=A,h=H)=>{await asUser(db,user);return (await db.query('select resolve_household_entitlements($1) r',[h])).rows[0].r.tier;};
test('subscription storage and server RPCs deny direct normal-client access', {skip:!enabled},async()=>{const db=await setup();try{
  await asUser(db,A);for(const t of ['entitlement_funding_sources','household_access_grants','revenuecat_accounts','revenuecat_subscription_chains','revenuecat_purchase_intents','revenuecat_webhook_inbox','revenuecat_audit']){
    for(const sql of [`select * from private.${t}`,`insert into private.${t} default values`,`update private.${t} set created_at=now()`,`delete from private.${t}`])await assert.rejects(db.query(sql));
  }
  await assert.rejects(begin(db));await assert.rejects(prepare(db));await assert.rejects(apply(db,1,[]));
}finally{await db.close();}});
test('prepare requires exact membership/baby context and a single durable pending intent', {skip:!enabled},async()=>{const db=await setup();try{
  await assert.rejects(prepare(db,B,H),{code:'42501'});await assert.rejects(prepare(db,A,J),{code:'42501'});
  const a=await prepare(db);assert.equal((await prepare(db)).intentId,a.intentId);
  await assert.rejects(db.query("select revenuecat_prepare($1,$2,$3,$4,$5,'sleepy_plus_yearly','{}',$6)",[A,project,app,H,BABY,uuid(202)]));
  assert.equal((await db.query('select count(*)::int n from private.revenuecat_purchase_intents')).rows[0].n,1);
}finally{await db.close();}});
test('new purchase binds intent; reconciliation is idempotent, does not transfer, and sources combine', {skip:!enabled},async()=>{const db=await setup();try{
  const intent=await prepare(db);const s=source();const job=await begin(db);assert.equal((await apply(db,job.revision,[s],intent.intentId)).householdId,H);
  assert.equal(await tier(db),'plus');await db.exec('reset role');
  let next=await begin(db);await apply(db,next.revision,[s],intent.intentId);
  assert.equal((await db.query('select count(*)::int n from private.entitlement_funding_sources')).rows[0].n,1);
  next=await begin(db);await apply(db,next.revision,[{...s,access:false,status:'expired'},source({id:'subSecond',chain:'subFixture'})]);assert.equal(await tier(db),'plus');await db.exec('reset role');
  next=await begin(db);await apply(db,next.revision,[{...s,access:false},source({id:'subSecond',chain:'subFixture',access:false})]);assert.equal(await tier(db),'free');
}finally{await db.close();}});
test('restore or webhook without a safe binding never chooses a household', {skip:!enabled},async()=>{const db=await setup();try{
  const s=source(),job=await begin(db);const r=await apply(db,job.revision,[s]);assert.equal(r.state,'assignmentRequired');assert.equal(r.householdId,null);assert.equal(await tier(db),'free');
  await db.exec('reset role');const intent=await prepare(db,A,H,[s.id]);const next=await begin(db);await apply(db,next.revision,[s],intent.intentId);assert.equal(await tier(db),'free','existing subscription cannot be attached via a new purchase intent');
}finally{await db.close();}});
test('webhook cannot consume a pending intent; exact purchase correlation required and unrelated restored source stays unassigned', {skip:!enabled},async()=>{const db=await setup();try{
  const old=source({id:'old',startsAt:new Date(Date.now()-3600000).toISOString()});let job=await begin(db);await apply(db,job.revision,[old]);
  const intent=await prepare(db,A,H,['old']),fresh=source();job=await begin(db);await apply(db,job.revision,[old,fresh]);
  assert.equal(await tier(db),'free','webhook does not infer an intent');await db.exec('reset role');
  job=await begin(db);await apply(db,job.revision,[old,{...fresh,correlation:undefined}],intent.intentId);assert.equal(await tier(db),'free');await db.exec('reset role');
  job=await begin(db);await apply(db,job.revision,[old,fresh],intent.intentId);
  assert.equal(await tier(db),'plus');await db.exec('reset role');
  const oldRow=(await db.query("select funded_household_id from private.entitlement_funding_sources where external_transaction_id like '%:old'")).rows[0];assert.equal(oldRow.funded_household_id,null);
}finally{await db.close();}});
test('expired intent and membership removed after prepare cannot establish funding destination', {skip:!enabled},async()=>{for(const reason of ['expired','removed']){const db=await setup();try{
  const i=await prepare(db);if(reason==='expired')await db.query("update private.revenuecat_purchase_intents set created_at=now()-interval '4 hours',expires_at=now()-interval '1 hour' where id=$1",[i.intentId]);
  else await db.query('delete from household_members where user_id=$1 and household_id=$2',[A,H]);
  const job=await begin(db);assert.equal((await apply(db,job.revision,[source()],i.intentId)).state,'assignmentRequired');
}finally{await db.close();}}});
test('sandbox never grants production Plus; paid viewer/caregiver permissions stay unchanged', {skip:!enabled},async()=>{const db=await setup();try{
  const i=await prepare(db);let job=await begin(db);await apply(db,job.revision,[source({environment:'sandbox'})],i.intentId);assert.equal(await tier(db),'free');await db.exec('reset role');
  job=await begin(db);await apply(db,job.revision,[source()]);const prodChain=(await db.query("select id from private.revenuecat_subscription_chains where environment='production'")).rows[0].id;await db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[A,project,app,prodChain,H]);assert.equal(await tier(db,V),'plus');
  assert.equal((await db.query("select private.has_baby_role($1,array['owner','parent','caregiver']) allowed",[BABY])).rows[0].allowed,false);
  await assert.rejects(db.query('insert into sleep(id,baby_id) values($1,$2)',[uuid(155),BABY]),{code:'42501'});
  await asUser(db,C);assert.equal((await db.query("select private.has_baby_role($1,array['owner','parent']) allowed",[BABY])).rows[0].allowed,false);
  await db.query('insert into sleep(id,baby_id) values($1,$2)',[uuid(156),BABY]);
}finally{await db.close();}});
test('purchaser removal stops qualification; explicit audited transfer updates exactly one destination without role changes', {skip:!enabled},async()=>{const db=await setup();try{
  const i=await prepare(db);let job=await begin(db);await apply(db,job.revision,[source()],i.intentId);
  await db.query('delete from household_members where user_id=$1 and household_id=$2',[A,H]);assert.equal(await tier(db,V),'free');await db.exec('reset role');
  await assert.rejects(db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[B,project,app,uuid(199),H]));
  await db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[A,project,app,(await db.query("select id from private.revenuecat_subscription_chains where original_transaction_id='subFixture' and environment='production'")).rows[0]?.id??uuid(199),J]);assert.equal(await tier(db,A,J),'plus');assert.equal(await tier(db,V),'free');await db.exec('reset role');
  const rows=(await db.query("select funded_household_id from private.entitlement_funding_sources where provider='revenuecat'")).rows;assert.ok(rows.every(r=>r.funded_household_id===J));
  assert.equal((await db.query("select count(*)::int n from private.revenuecat_audit where action='transfer'")).rows[0].n,1);
  assert.equal((await db.query('select role from household_members where user_id=$1 and household_id=$2',[A,J])).rows[0].role,'parent');
}finally{await db.close();}});
test('stale reconcile revisions cannot overwrite newer state; ownership conflicts cannot steal chain', {skip:!enabled},async()=>{const db=await setup();try{
  const i=await prepare(db),older=await begin(db),newer=await begin(db);await apply(db,newer.revision,[source()],i.intentId);
  await assert.rejects(apply(db,older.revision,[]),{code:'40001'});assert.equal(await tier(db),'plus');await db.exec('reset role');
  const other=await begin(db,B);await assert.rejects(apply(db,other.revision,[source()],null,B),{code:'42501'});
  const last=await begin(db);await apply(db,last.revision,[]);assert.equal(await tier(db),'free');
}finally{await db.close();}});
test('webhook inbox deduplicates, retains failed attempts and never loses processed status', {skip:!enabled},async()=>{const db=await setup();try{
  const accept=async hash=>(await db.query("select revenuecat_accept_event('evt', $1,$2,'production','RENEWAL',now(),$3,$4) r",[project,app,[A],hash])).rows[0].r;
  assert.equal(await accept('hash'),true);await db.query("select revenuecat_finish_event('evt','hash',false)");assert.equal(await accept('hash'),true);
  await db.query("select revenuecat_finish_event('evt','hash',true)");assert.equal(await accept('hash'),false);
  await db.query("select revenuecat_finish_event('evt','hash',false)");assert.equal((await db.query("select status from private.revenuecat_webhook_inbox where event_id='evt'")).rows[0].status,'processed');
  await assert.rejects(accept('other'),{code:'42501'});
}finally{await db.close();}});
test('normal client cannot invoke transfer/inbox/maintenance; server begin is rate bounded', {skip:!enabled},async()=>{const db=await setup();try{
  await asUser(db,A);await assert.rejects(db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[A,project,app,uuid(199),J]),{code:'42501'});
  await assert.rejects(db.query('select revenuecat_maintenance_work($1,$2)',[project,app]),{code:'42501'});
  await assert.rejects(db.query("select revenuecat_finish_event('evt','hash',true)"),{code:'42501'});
  await db.exec('reset role');for(let n=0;n<30;n++)await begin(db);await assert.rejects(begin(db),{code:'53000'});
}finally{await db.close();}});
test('expired subscription can be explicitly reassigned for a future renewal without granting Plus', {skip:!enabled},async()=>{const db=await setup();try{
  const i=await prepare(db);let job=await begin(db);await apply(db,job.revision,[source()],i.intentId);
  job=await begin(db);await apply(db,job.revision,[]);assert.equal(await tier(db),'free');await db.exec('reset role');
  await db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[A,project,app,(await db.query("select id from private.revenuecat_subscription_chains where original_transaction_id='subFixture' and environment='production'")).rows[0]?.id??uuid(199),J]);assert.equal(await tier(db,A,J),'free');
}finally{await db.close();}});

test('monthly -> yearly retains same chain household and cannot consume a different household intent', {skip:!enabled},async()=>{const db=await setup();try{
  let intent=await prepare(db),job=await begin(db);const monthly=source();await apply(db,job.revision,[monthly],intent.intentId);
  await db.query('insert into baby_households values($1,$2,now())',[BABY,J]);
  intent=(await db.query("select revenuecat_prepare($1,$2,$3,$4,$5,'sleepy_plus_yearly',$6,$7) r",[A,project,app,J,BABY,[monthly.id],uuid(203)])).rows[0].r;
  const yearly=source({id:'annualSegment',chain:monthly.chain,product:'sleepy_plus_yearly',transaction:'annual',correlation:'annual'});
  job=await begin(db);await apply(db,job.revision,[{...monthly,access:false},yearly],intent.intentId,A,'annual');
  assert.equal(await tier(db,A,H),'plus');assert.equal(await tier(db,A,J),'free');await db.exec('reset role');
  assert.equal((await db.query('select status from private.revenuecat_purchase_intents where id=$1',[intent.intentId])).rows[0].status,'pending');
  assert.equal((await db.query('select count(*)::int n from private.revenuecat_subscription_chains')).rows[0].n,1);
  assert.ok((await db.query('select funded_household_id from private.entitlement_funding_sources')).rows.every(r=>r.funded_household_id===H));
}finally{await db.close();}});

test('independent chain can fund another explicit household; transfer moves only selected chain and all its segments', {skip:!enabled},async()=>{const db=await setup();try{
  const first=source();let i=await prepare(db),job=await begin(db);await apply(db,job.revision,[first],i.intentId);
  await db.query('insert into baby_households values($1,$2,now())',[BABY,J]);i=await prepare(db,A,J,[first.id]);
  const second=source({id:'second',chain:'other-original',transaction:'second-tx',correlation:'second-tx'});
  job=await begin(db);await apply(db,job.revision,[first,second],i.intentId,A,'second-tx');assert.equal(await tier(db,A,H),'plus');assert.equal(await tier(db,A,J),'plus');await db.exec('reset role');
  job=await begin(db);const multiple=await apply(db,job.revision,[first,second]);assert.equal(multiple.state,'verifiedMultiple');assert.equal(multiple.householdId,null);
  const chain=(await db.query("select id from private.revenuecat_subscription_chains where original_transaction_id='subFixture'")).rows[0].id;
  await db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[A,project,app,chain,J]);
  assert.ok((await db.query('select funded_household_id from private.entitlement_funding_sources')).rows.every(r=>r.funded_household_id===J));
  await db.query('select revenuecat_transfer($1,$2,$3,$4,$5)',[A,project,app,chain,H]);
  const rows=(await db.query('select external_transaction_id,funded_household_id from private.entitlement_funding_sources')).rows;
  assert.equal(rows.find(r=>r.external_transaction_id.endsWith(':second')).funded_household_id,J);
  assert.equal(rows.find(r=>r.external_transaction_id.endsWith(':subFixture')).funded_household_id,H);
}finally{await db.close();}});

test('cancelled/stale attempts and concurrent devices cannot reuse an intent for a later purchase', {skip:!enabled},async()=>{const db=await setup();try{
  const i=await prepare(db);
  await assert.rejects(db.query("select revenuecat_prepare($1,$2,$3,$4,$5,'sleepy_plus_monthly','{}',$6)",[A,project,app,H,BABY,uuid(210)]),{code:'42501'});
  await db.query('select revenuecat_cancel_intent($1,$2,$3,$4)',[A,project,app,i.intentId]);
  const job=await begin(db);await apply(db,job.revision,[source({id:'unrelated',chain:'other'})],i.intentId);assert.equal(await tier(db),'free');await db.exec('reset role');
  const next=await prepare(db);assert.notEqual(next.intentId,i.intentId);
  const outcomes=await Promise.allSettled([prepare(db),db.query("select revenuecat_prepare($1,$2,$3,$4,$5,'sleepy_plus_monthly','{}',$6)",[A,project,app,H,BABY,uuid(211)])]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
}finally{await db.close();}});

test('old Apple transaction and ambiguous receipts cannot consume fresh intent; restore/webhook leaves it pending', {skip:!enabled},async()=>{const db=await setup();try{
  const i=await prepare(db),old=source({purchaseAt:new Date(Date.now()-3600000).toISOString()});let job=await begin(db);
  await apply(db,job.revision,[old],i.intentId);assert.equal(await tier(db),'free');await db.exec('reset role');
  job=await begin(db);await apply(db,job.revision,[source(),source({id:'other',chain:'other'})],i.intentId);assert.equal(await tier(db),'free');await db.exec('reset role');
  job=await begin(db);await apply(db,job.revision,[source()]);
  assert.equal((await db.query('select status from private.revenuecat_purchase_intents where id=$1',[i.intentId])).rows[0].status,'pending');
}finally{await db.close();}});

test('active and expired independent chains combine safely; chain destination constraint prevents split funding', {skip:!enabled},async()=>{const db=await setup();try{
  const one=source();let i=await prepare(db),job=await begin(db);await apply(db,job.revision,[one],i.intentId);
  i=await prepare(db,A,H,[one.id]);const two=source({id:'second',chain:'independent',transaction:'second',correlation:'second'});job=await begin(db);await apply(db,job.revision,[one,two],i.intentId,A,'second');
  job=await begin(db);await apply(db,job.revision,[{...one,access:false},two]);assert.equal(await tier(db),'plus');await db.exec('reset role');
  await assert.rejects(db.query("update private.entitlement_funding_sources set funded_household_id=$1 where external_transaction_id like '%:second'",[J]),{code:'23503'});
  job=await begin(db);await apply(db,job.revision,[{...one,access:false},{...two,access:false}]);assert.equal(await tier(db),'free');
}finally{await db.close();}});
