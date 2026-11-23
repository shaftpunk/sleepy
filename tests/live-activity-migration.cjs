const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const db = new PGlite();
  const uuid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
  const [owner, caregiver, stranger, phone, sleep, baby, household, otherPhone] = Array.from({ length: 8 }, (_, i) => uuid(i + 1));
  const key = 'a'.repeat(64), token = 'b'.repeat(64);
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.sleep(id uuid primary key, baby_id uuid, endtime timestamptz, deleted_at timestamptz);
      create table public.baby_households(baby_id uuid, household_id uuid);
      create table public.household_members(household_id uuid, user_id uuid);
      create function private.can_access_baby(baby uuid) returns boolean language sql stable as $$
        select exists(select 1 from public.baby_households b join public.household_members m using(household_id)
          where b.baby_id = baby and m.user_id = auth.uid())
      $$;
      insert into auth.users values ('${owner}'), ('${caregiver}'), ('${stranger}');
      insert into public.sleep values ('${sleep}', '${baby}', null, null);
      insert into public.baby_households values ('${baby}', '${household}');
      insert into public.household_members values ('${household}', '${owner}'), ('${household}', '${caregiver}');
    `);
    for (const name of ['20261110120000_native_push_tokens', '20261123120000_live_activity_tokens']) {
      await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', name + '.sql'), 'utf8'));
    }
    async function as(user) {
      await db.exec('reset role; set role authenticated;');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    }
    async function register(rev, { id = phone, proof = key, babyId = baby, value = token, activity = 'card' } = {}) {
      const { rows } = await db.query("select public.register_live_activity_token($1,$2,$3,$4,$5,'production',$6,$7,now()+interval '1 hour') result",
        [id, proof, activity, sleep, babyId, value, rev]);
      return rows[0].result;
    }
    async function revoke(rev) {
      await db.query('select public.revoke_live_activity_token($1,$2,$3,$4)', [phone, key, 'card', rev]);
    }
    await as(stranger);
    await assert.rejects(register(1), /Sleep unavailable/);
    await as(owner);
    await assert.rejects(register(1, { babyId: uuid(99) }), /Sleep unavailable/);
    assert.equal(await register(1), 'registered');
    assert.equal(await register(1), 'unchanged');
    await assert.rejects(register(2, { proof: 'c'.repeat(64) }), /Invalid installation credential/);
    assert.equal(await register(2, { value: 'd'.repeat(64) }), 'registered');
    await revoke(1);
    for (const sql of ['select * from', 'delete from', 'update']) {
      await assert.rejects(db.exec(sql + ' public.live_activity_tokens' + (sql === 'update' ? ' set push_token=null' : '')), /permission denied/);
    }
    const alertAttach = await db.query('select public.set_native_push_registration($1,$2,1,$3,true) applied', [phone, key, token]);
    assert.equal(alertAttach.rows[0].applied, true);
    await as(owner);
    assert.equal(await register(3, { id: uuid(9) }), 'registered');
    await as(caregiver);
    assert.equal(await register(3, { id: otherPhone }), 'registered');
    await db.exec('reset role');
    const endedAt = '2026-11-23T12:00:00Z';
    await db.query('update public.sleep set endtime=$1 where id=$2', [endedAt, sleep]);
    const targets = (babyId = baby) => db.query('select * from public.live_activity_end_targets($1,$2,$3)', [sleep, babyId, endedAt]);
    assert.equal((await targets()).rows.length, 3);
    assert.equal((await targets(uuid(99))).rows.length, 0);
    await as(owner);
    assert.equal(await register(3), 'already_ended');
    await revoke(2);
    await assert.rejects(targets(), /permission denied/);
    await db.exec('reset role');
    assert.deepEqual((await targets()).rows.map(row => row.installation_id).sort(), [otherPhone, uuid(9)]);
    await db.query('delete from public.household_members where user_id=$1', [caregiver]);
    assert.deepEqual((await targets()).rows.map(row => row.installation_id), [uuid(9)]);
    await db.query('update public.sleep set endtime=null where id=$1', [sleep]);
    await as(owner);
    assert.equal(await register(2), 'unchanged');
    assert.equal(await register(4, { activity: 'new card' }), 'registered');
    console.log('Live Activity migration authorization, proof-only install, registration, rotation, targeting, and revocation passed.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
