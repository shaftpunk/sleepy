// Run separately with PGLITE_MODULE pointing to a temporary @electric-sql/pglite install.
// Executes only an in-memory PostgreSQL database, never a Supabase connection.
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values
        ('10000000-0000-0000-0000-000000000001'),
        ('10000000-0000-0000-0000-000000000002');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110120000_native_push_tokens.sql'), 'utf8'));
    const userA = '10000000-0000-0000-0000-000000000001';
    const userB = '10000000-0000-0000-0000-000000000002';
    const installation = '20000000-0000-0000-0000-000000000001';
    const key = 'b'.repeat(64), token = 'a'.repeat(64);
    const authAs = async user => {
      await db.exec('reset role; set role authenticated;');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
    };
    const register = async (revision, enabled, suppliedKey = key, suppliedToken = token) => {
      const result = await db.query(`select public.set_native_push_registration($1,$2,$3,$4,$5) as applied`,
        [installation, suppliedKey, revision, enabled ? suppliedToken : null, enabled]);
      return result.rows[0].applied;
    };
    await authAs(userA);
    assert.equal(await register(1, true), true);
    assert.equal(await register(1, true), false);
    assert.equal((await db.query('select count(*)::int as n from public.native_push_tokens')).rows[0].n, 1);
    await assert.rejects(db.query(`update public.native_push_tokens set enabled = false`), /permission denied/);
    await authAs(userB);
    assert.equal((await db.query('select count(*)::int as n from public.native_push_tokens')).rows[0].n, 0);
    await assert.rejects(register(2, true, 'c'.repeat(64)), /Invalid installation credential/);
    assert.equal(await register(2, false), true); // possession allows safe detach on account switch
    assert.equal(await register(1, true), false); // delayed old request cannot undo detach
    assert.equal(await register(3, true), true); // explicit authenticated new-account opt-in
    assert.equal(await register(4, true, key, 'd'.repeat(64)), true); // token rotation
    const own = await db.query('select user_id, device_token from public.native_push_tokens');
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].user_id, userB);
    assert.equal(own.rows[0].device_token, 'd'.repeat(64));
    await authAs(userA);
    assert.equal((await db.query('select count(*)::int as n from public.native_push_tokens')).rows[0].n, 0);
    await db.exec('reset role; set role anon;');
    await assert.rejects(register(5, true), /permission denied/);
    await db.exec('reset role;');
    await db.query('delete from auth.users where id = $1', [userB]);
    assert.equal((await db.query('select count(*)::int as n from public.native_push_tokens')).rows[0].n, 0);
    console.log('Native push migration: schema, idempotency, RLS, credentials, account switching, rotation, stale revisions and deletion checks passed.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
