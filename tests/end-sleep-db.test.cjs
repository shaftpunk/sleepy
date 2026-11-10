const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Optional dependency for isolated SQL integration tests only. This test never
// reads a Supabase URL, connects to a server or changes the dependency lockfile.
const engine = process.env.SLEEPY_TEST_PGLITE;
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const [parent, viewer, unrelated, baby, deniedBaby, household, sleep, deniedSleep, deletedSleep, invalidSleep] =
  Array.from({ length: 10 }, (_, i) => uuid(i + 1));
const initial = '2000-01-01T13:00:00Z', ended = '2000-01-01T14:05:30Z';

test('end_sleep migration preserves RLS, validates input and performs exactly one real end', { skip: !engine }, async () => {
  const { PGlite } = require(engine);
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      create table public.sleep (
        id uuid primary key, baby_id uuid not null, starttime timestamptz not null, endtime timestamptz,
        durationminutes integer, updated_by_user_id uuid, updated_at timestamptz, deleted_at timestamptz);
      create table public.baby_households (baby_id uuid, household_id uuid);
      create table public.household_members (household_id uuid, user_id uuid, role text);
      create table public.end_transitions (sleep_id uuid);
      alter table public.sleep enable row level security;
      alter table public.baby_households enable row level security;
      alter table public.household_members enable row level security;
      grant select, update on public.sleep to authenticated;
      grant select on public.baby_households, public.household_members to authenticated;
      grant insert on public.end_transitions to authenticated;
      create policy read_sleep on public.sleep for select to authenticated using (true);
      create policy update_sleep on public.sleep for update to authenticated
        using (baby_id <> '${deniedBaby}') with check (baby_id <> '${deniedBaby}');
      create policy read_links on public.baby_households for select to authenticated using (true);
      create policy read_members on public.household_members for select to authenticated using (user_id = auth.uid());
      create function public.observe_end() returns trigger language plpgsql as
        $$ begin insert into public.end_transitions values (new.id); return new; end $$;
      create trigger sleep_ended after update on public.sleep for each row
        when (old.endtime is null and new.endtime is not null) execute function public.observe_end();
      insert into public.baby_households values ('${baby}','${household}'), ('${deniedBaby}','${household}');
      insert into public.household_members values ('${household}','${parent}','parent'), ('${household}','${viewer}','viewer');
      insert into public.sleep(id,baby_id,starttime,deleted_at) values
        ('${sleep}','${baby}','${initial}',null), ('${deniedSleep}','${deniedBaby}','${initial}',null),
        ('${deletedSleep}','${baby}','${initial}',now()), ('${invalidSleep}','${baby}','${initial}',null);
    `);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261111090000_end_sleep_command.sql'), 'utf8');
    await db.exec(sql);
    const end = (id, time = ended) => db.query('select id, endtime, durationminutes, updated_by_user_id, updated_at from public.end_sleep($1,$2)', [id, time]);
    const asUser = user => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user}';`);
    await db.exec('set role anon');
    await assert.rejects(end(sleep), { code: '42501' });
    for (const user of [viewer, unrelated]) {
      await asUser(user);
      await assert.rejects(end(sleep), { code: '42501' });
    }
    await asUser(parent);
    await assert.rejects(end(deniedSleep), { code: '42501' });
    await assert.rejects(end(deletedSleep), { code: '42501' });
    await assert.rejects(end(invalidSleep, initial), { code: '22023' });
    await assert.rejects(end(invalidSleep, 'infinity'), { code: '22023' });
    const { rows: [row] } = await end(sleep);
    assert.equal(row.durationminutes, 66);
    assert.equal(row.updated_by_user_id, parent);
    assert.equal(new Date(row.endtime).toISOString(), new Date(ended).toISOString());
    const retry = await end(sleep, '2000-01-01T14:22:00Z');
    assert.deepEqual(retry.rows, [row], 'already-ended returns original timestamp and attribution');
    await db.exec('reset role');
    const { rows } = await db.query('select sleep_id from public.end_transitions');
    assert.deepEqual(rows, [{ sleep_id: sleep }], 'existing active-to-ended side effect occurs once');
    assert.equal((await db.query('select count(*)::int as count from public.sleep where endtime is not null')).rows[0].count, 1);
  } finally { await db.close(); }
});
