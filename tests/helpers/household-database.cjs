const fs = require('node:fs');
const path = require('node:path');
const baseline = require('../../supabase/baselines/household-authorization.json');
const root = path.resolve(__dirname, '../..');
const uuid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
async function householdDatabase() {
  const { PGlite } = require(process.env.SLEEPY_TEST_PGLITE);
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema private; create schema extensions;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,private,public to authenticated,anon,service_role;
    -- Test-only pgcrypto API adapters: PGlite lacks the production extension.
    -- The captured RPC bodies are unchanged; these adapters are never deployed.
    create function extensions.digest(value text, algorithm text) returns bytea language sql as
      $$ select case when algorithm='sha256' then sha256(convert_to(value,'UTF8')) end $$;
    create function extensions.gen_random_bytes(length integer) returns bytea language sql volatile as
      $$ select substring(decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex') from 1 for length) $$;
  `);
  const tables = [...new Set(baseline.columns.map(c => c.table_name))];
  for (const table of tables) {
    const columns = baseline.columns.filter(c => c.table_name === table).sort((a,b) => a.ordinal_position-b.ordinal_position);
    await db.exec(`create table public.${table} (${columns.map(c =>
      `${c.column_name} ${c.data_type}${c.is_nullable==='NO'?' not null':''}${c.column_default?' default '+c.column_default:''}`).join(',')});`);
  }
  const constraints = [...baseline.constraints].sort((a,b) => Number(a.definition.startsWith('FOREIGN KEY'))-Number(b.definition.startsWith('FOREIGN KEY')));
  for (const constraint of constraints) await db.exec(`alter table public.${constraint.table} add constraint ${constraint.name} ${constraint.definition};`);
  await db.exec(`create table public.sleep(id uuid primary key, baby_id uuid not null references public.babies(id), starttime timestamptz, endtime timestamptz, deleted_at timestamptz);
    create table public.feed(id uuid primary key, baby_id uuid not null references public.babies(id));
    grant select,insert,update on public.sleep,public.feed to authenticated;`);
  for (const fn of baseline.functions) {
    await db.exec(fn.definition);
    const signature = `${fn.schema}.${fn.name}(${fn.arguments})`;
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;`);
    for (const [,role] of fn.acl.matchAll(/(?:\{|,)([a-z_]+)=/g)) {
      await db.exec(`grant execute on function ${signature} to ${role};`);
    }
  }
  for (const { table, enabled, forced } of baseline.rls) {
    if (enabled) await db.exec(`alter table public.${table} enable row level security;`);
    if (forced) await db.exec(`alter table public.${table} force row level security;`);
  }
  await db.exec('alter table public.sleep enable row level security; alter table public.feed enable row level security;');
  for (const grant of baseline.grants) await db.exec(`grant ${grant.privilege_type} on public.${grant.table_name} to ${grant.grantee};`);
  for (const policy of baseline.policies) await db.exec(`create policy ${policy.name} on public.${policy.table} for ${policy.command}
    to ${policy.roles.join(',')}${policy.qual?' using ('+policy.qual+')':''}${policy.check?' with check ('+policy.check+')':''};`);
  for (const name of ['20261112090000_household_authorization_baseline.sql', '20261112091000_entitlement_foundation.sql']) {
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  }
  return db;
}
async function asUser(db,user,role='authenticated') {
  await db.exec(`reset role; set request.jwt.claim.sub='${user ?? ''}'; set role ${role};`);
}
module.exports = { householdDatabase, baseline, uuid, asUser };
