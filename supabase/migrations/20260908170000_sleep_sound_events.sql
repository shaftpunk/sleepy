-- Additive phase 1. Does not change sleep/feed rows, policies or timestamps.
-- Requires the Sleepy 3 UUID schema. Existing access policies remain in force.
begin;

-- Fail closed if the base tables are not protected; never install an anon path.
do $$
declare relation_name text;
begin
  foreach relation_name in array array['sleep', 'babies', 'baby_households', 'household_members'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = relation_name and c.relrowsecurity
    ) then
      raise exception 'Missing table or RLS on public.% — review existing schema before installing sound monitoring', relation_name;
    end if;
  end loop;
end $$;

create table public.sleep_sound_events (
  id uuid primary key default gen_random_uuid(),
  sleep_id uuid not null references public.sleep(id) on delete cascade,
  baby_id uuid not null references public.babies(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  event_type text not null default 'sound' check (event_type = 'sound'),
  avg_level numeric not null check (avg_level between 0 and 1),
  max_level numeric not null check (max_level between 0 and 1 and max_level >= avg_level),
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  check (ended_at >= started_at),
  check (isfinite(started_at) and isfinite(ended_at))
);
create index sleep_sound_events_sleep_time on public.sleep_sound_events(sleep_id, started_at, id);
create index sleep_sound_events_baby_time on public.sleep_sound_events(baby_id, started_at);
alter table public.sleep_sound_events enable row level security;
revoke all on public.sleep_sound_events from public, anon, authenticated;
grant select, insert on public.sleep_sound_events to authenticated;

-- Invoker subqueries inherit existing sleep/household RLS. No SECURITY DEFINER
-- function or invented private helper name is used. Also bind baby_id to the
-- actual parent sleep row: a caller cannot attach metadata to another baby.
create policy sound_events_read on public.sleep_sound_events for select to authenticated
using (
  exists (select 1 from public.sleep s
    where s.id = sleep_sound_events.sleep_id and s.baby_id = sleep_sound_events.baby_id
      and s.deleted_at is null)
  and exists (select 1 from public.baby_households bh
    join public.household_members hm on hm.household_id = bh.household_id
    where bh.baby_id = sleep_sound_events.baby_id and hm.user_id = (select auth.uid()))
);

create policy sound_events_insert on public.sleep_sound_events for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and exists (select 1 from public.sleep s
    where s.id = sleep_sound_events.sleep_id and s.baby_id = sleep_sound_events.baby_id
      and s.deleted_at is null
      and sleep_sound_events.started_at >= s.starttime
      -- Completed sessions accept delayed/retried metadata from before stop.
      and (s.endtime is null or sleep_sound_events.ended_at <= s.endtime))
  and exists (select 1 from public.baby_households bh
    join public.household_members hm on hm.household_id = bh.household_id
    where bh.baby_id = sleep_sound_events.baby_id and hm.user_id = (select auth.uid())
      and hm.role in ('owner', 'parent', 'caregiver'))
);

-- No client UPDATE/DELETE permission in phase 1. A future maintenance flow can
-- add an explicit role-scoped deletion policy without touching sleep records.
comment on table public.sleep_sound_events is 'Sound metadata only. No audio, cry classification or inferred wake events.';
commit;
