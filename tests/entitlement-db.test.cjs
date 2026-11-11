const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { householdDatabase, baseline, uuid, asUser } = require('./helpers/household-database.cjs');
const engine = process.env.SLEEPY_TEST_PGLITE;
const [owner, parent, caregiver, viewer, outsider, household, otherHousehold, baby, otherBaby] = Array.from({length:9},(_,i)=>uuid(i+1));
async function fixture(db) {
  for (const id of [owner,parent,caregiver,viewer,outsider]) await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('insert into households(id,name,created_by_user_id) values($1,\'Family\',$3),($2,\'Other\',$4)',[household,otherHousehold,owner,outsider]);
  for(const [h,user,role] of [[household,owner,'owner'],[household,parent,'parent'],[household,caregiver,'caregiver'],[household,viewer,'viewer'],[otherHousehold,outsider,'owner']]) {
    await db.query('insert into household_members(household_id,user_id,role) values($1,$2,$3)',[h,user,role]);
  }
  await db.query('insert into babies(id,name,created_by_user_id) values($1,\'Baby\',$3),($2,\'Other baby\',$4)',[baby,otherBaby,owner,outsider]);
  await db.query('insert into baby_households(baby_id,household_id) values($1,$2),($3,$4)',[baby,household,otherBaby,otherHousehold]);
}
const resolve = async(db,h=household)=>(await db.query('select public.resolve_household_entitlements($1) as result',[h])).rows[0].result;
async function grant(db,{ h=household, source='beta', from='-1 day', until='1 day', status='active', environment='production' }={}) {
  await db.exec('reset role');
  return (await db.query(`insert into private.household_access_grants(household_id,source,environment,status,valid_from,valid_until,issued_by,provenance)
    values($1,$2,$3,$4,statement_timestamp()+$5::interval,case when $6::text is null then null else statement_timestamp()+$6::interval end,'test', '{"reason":"isolated test only"}') returning id`,[h,source,environment,status,from,until])).rows[0].id;
}
let sequence=0;
async function funding(db,{ h=household,purchaser=owner,from='-1 day',until='1 day',environment='production',status='active',transaction='transaction-'+(++sequence) }={}) {
  await db.exec('reset role');
  return (await db.query(`insert into private.entitlement_funding_sources(purchaser_user_id,funded_household_id,provider,external_customer_id,external_transaction_id,product_id,environment,status,valid_from,verified_access_until,verified_at,provenance)
    values($1,$2,'test-provider','test-customer',$3,'test-product',$4,$5,statement_timestamp()+$6::interval,statement_timestamp()+$7::interval,statement_timestamp(), '{}') returning id`,[purchaser,h,transaction,environment,status,from,until])).rows[0].id;
}

test('captured family baseline installs unchanged and Phase 1 does not issue any grants', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{
    const rows=(await db.query('select count(*)::int as n from private.household_access_grants union all select count(*)::int from private.entitlement_funding_sources')).rows;
    assert.deepEqual(rows,[{n:0},{n:0}]);
    const registry=(await db.query('select private.entitlement_feature_definitions() as definitions')).rows[0].definitions;
    assert.deepEqual(registry,require('../src/entitlements/features.json'));
    for(const fn of baseline.functions){
      const types=fn.arguments ? fn.arguments.split(',').map(arg=>arg.trim().split(/\s+/).slice(1).join(' ')).join(',') : '';
      const def=(await db.query('select pg_get_functiondef($1::regprocedure) as definition',[`${fn.schema}.${fn.name}(${types})`])).rows[0].definition;
      assert.equal(def.replace(/\r/g,''),fn.definition.replace(/\r/g,''));
    }
  }finally{await db.close();}
});

test('resolver verifies caller membership and isolates household sources/private billing', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{await fixture(db);await grant(db);
    await asUser(db,null,'anon');await assert.rejects(resolve(db),{code:'42501'});
    await asUser(db,outsider);await assert.rejects(resolve(db),{code:'42501'});
    assert.equal((await resolve(db,otherHousehold)).tier,'free');
    await asUser(db,parent);await assert.rejects(resolve(db,otherHousehold),{code:'42501'});
    const result=await resolve(db);assert.equal(result.tier,'plus');assert.equal(result.verification_state,'verified');
    assert.deepEqual(Object.keys(result).sort(),['household_id','tier','is_plus','features','verification_state','verified_at','valid_until','recheck_at','policy_version'].sort());
    for(const table of ['household_access_grants','entitlement_funding_sources']){
      for(const sql of [`select * from private.${table}`,`update private.${table} set status='active'`,`delete from private.${table}`,`insert into private.${table} default values`]) {
        await assert.rejects(db.query(sql),{code:'42501'});
      }
    }
  }finally{await db.close();}
});

test('Free, future, expired, revoked, sandbox and overlapping grants resolve by current qualifying source', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{await fixture(db);await asUser(db,owner);
    assert.equal((await resolve(db)).tier,'free');
    for(const options of [{from:'-2 days',until:'-1 day'},{from:'1 day',until:'2 days'},{status:'revoked'},{environment:'sandbox'}]){
      await grant(db,options);await asUser(db,owner);assert.equal((await resolve(db)).tier,'free');
    }
    await grant(db,{source:'promotion',until:'2 days'});await asUser(db,viewer);
    let r=await resolve(db);assert.equal(r.is_plus,true);assert.ok(r.valid_until);
    await grant(db,{source:'lifetime',until:null});await asUser(db,viewer);r=await resolve(db);assert.equal(r.tier,'plus');assert.equal(r.valid_until,null);
  }finally{await db.close();}
});

test('multiple funding chains, membership removal, single assignment and private mutations are safe', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{await fixture(db);
    await funding(db,{from:'-2 days',until:'-1 day'});await funding(db,{purchaser:outsider});await funding(db,{environment:'sandbox'});
    await asUser(db,parent);assert.equal((await resolve(db)).tier,'free');
    const first=await funding(db),second=await funding(db,{purchaser:parent,until:'2 days'});
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'plus');
    await db.exec('reset role');await db.query("update private.entitlement_funding_sources set status='expired' where id=$1",[first]);
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'plus');
    await db.exec('reset role');await db.query('delete from household_members where household_id=$1 and user_id=$2',[household,parent]);
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'free');
    await db.exec('reset role');await db.query('update private.entitlement_funding_sources set funded_household_id=$2,purchaser_user_id=$3 where id=$1',[second,otherHousehold,outsider]);
    await asUser(db,outsider);assert.equal((await resolve(db,otherHousehold)).tier,'plus');
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'free');
    await db.exec('reset role');await assert.rejects(funding(db,{transaction:'duplicate'}).then(()=>funding(db,{transaction:'duplicate'})),{code:'23505'});
  }finally{await db.close();}
});

test('grants and funding combine without one expired source cancelling another active source', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{await fixture(db);
    const activeFunding=await funding(db);await grant(db,{from:'-2 days',until:'-1 day'});
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'plus');
    const activeGrant=await grant(db,{source:'promotion'});
    await db.query("update private.entitlement_funding_sources set status='expired' where id=$1",[activeFunding]);
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'plus');
    await db.exec('reset role');await db.query("update private.household_access_grants set status='revoked' where id=$1",[activeGrant]);
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'free');
    assert.equal((await db.query('select count(*)::int as n from household_members where household_id=$1',[household])).rows[0].n,4);
  }finally{await db.close();}
});

test('Plus never changes viewer/writer roles or authorizes another household baby', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{await fixture(db);await grant(db);
    await asUser(db,viewer);assert.equal((await resolve(db)).tier,'plus');
    assert.equal((await db.query("select private.has_baby_role($1,array['owner','parent','caregiver']) as allowed",[baby])).rows[0].allowed,false);
    await assert.rejects(db.query('insert into sleep(id,baby_id) values($1,$2)',[uuid(30),baby]),{code:'42501'});
    await asUser(db,caregiver);await db.query('insert into sleep(id,baby_id) values($1,$2)',[uuid(31),baby]);
    await assert.rejects(db.query('insert into sleep(id,baby_id) values($1,$2)',[uuid(32),otherBaby]),{code:'42501'});
    await asUser(db,viewer);assert.equal((await db.query('update sleep set endtime=now() returning id')).rows.length,0);
  }finally{await db.close();}
});

test('existing Free household creation, owner invitations, acceptance and add-child behavior remain intact', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{await fixture(db);await asUser(db,owner);
    const created=(await db.query("select create_household_with_baby('New technical household','New baby',null) as result")).rows[0].result;
    assert.equal((await resolve(db,created.household_id)).tier,'free');
    const invite=(await db.query("select create_household_invitation($1,'caregiver',24) as result",[household])).rows[0].result;
    assert.equal(invite.token.length,64);
    await asUser(db,parent);await assert.rejects(db.query("select create_household_invitation($1,'parent',24)",[household]));
    const child=(await db.query("select create_baby_for_household($1,'Sibling',null) as result",[household])).rows[0].result;assert.equal(child.name,'Sibling');
    await asUser(db,outsider);await db.query('select accept_household_invitation($1)',[invite.token]);
    assert.equal((await resolve(db)).tier,'free');
    assert.equal((await db.query('select role from household_members where household_id=$1 and user_id=$2',[household,outsider])).rows[0].role,'caregiver');
    await assert.rejects(db.query('select accept_household_invitation($1)',[invite.token]));
    await db.exec('reset role');
    const before=(await db.query('select count(*)::int as n from household_members where household_id=$1',[household])).rows[0].n;
    await grant(db,{from:'-2 days',until:'-1 day'});
    assert.equal((await db.query('select count(*)::int as n from household_members where household_id=$1',[household])).rows[0].n,before);
  }finally{await db.close();}
});

test('baseline guard detects authorization drift without rewriting policies or RPCs', {skip:!engine}, async()=>{
  const db=await householdDatabase();try{
    await db.exec('drop policy babies_select_member on babies');
    await assert.rejects(db.exec(fs.readFileSync('supabase/migrations/20261112090000_household_authorization_baseline.sql','utf8')),/baseline policy drift/);
  }finally{await db.close();}
});
