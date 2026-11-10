-- REVIEW ONLY. Do not apply automatically. Both app entry points require this.
begin;
do $$
declare relation_name text;
begin
  foreach relation_name in array array['sleep', 'baby_households', 'household_members'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name and c.relrowsecurity) then
      raise exception 'RLS is required on public.%', relation_name;
    end if;
  end loop;
end $$;

create or replace function public.end_sleep(p_sleep_id uuid, p_ended_at timestamptz)
returns setof public.sleep
language plpgsql security invoker set search_path = ''
as $$
declare s public.sleep%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- The row and household joins are also subject to existing caller RLS.
  select * into s from public.sleep as candidate where candidate.id=p_sleep_id and candidate.deleted_at is null and exists (
    select 1 from public.baby_households bh join public.household_members hm on hm.household_id=bh.household_id
    where bh.baby_id=candidate.baby_id and hm.user_id=auth.uid() and hm.role in ('owner','parent','caregiver')
  ) for update;
  if not found then raise exception 'Sleep unavailable or access denied' using errcode='42501'; end if;
  -- Lock + no UPDATE on an already-ended row: retry preserves first timestamp,
  -- duration, attribution and the existing active-to-ended notification trigger.
  if s.endtime is not null then return next s; return; end if;
  if p_ended_at is null or not isfinite(p_ended_at) or p_ended_at <= s.starttime
    or p_ended_at > clock_timestamp() + interval '5 seconds' then
    raise exception 'Invalid sleep end time' using errcode='22023';
  end if;
  update public.sleep set endtime=p_ended_at,
    durationminutes=greatest(0,round(extract(epoch from (p_ended_at-s.starttime))/60)),
    updated_by_user_id=auth.uid(), updated_at=clock_timestamp()
    where id=s.id and endtime is null and deleted_at is null and exists (
      select 1 from public.baby_households bh join public.household_members hm on hm.household_id=bh.household_id
      where bh.baby_id=s.baby_id and hm.user_id=auth.uid() and hm.role in ('owner','parent','caregiver')
    ) returning * into s;
  if not found then raise exception 'Sleep update denied' using errcode='42501'; end if;
  return next s;
end $$;
revoke all on function public.end_sleep(uuid,timestamptz) from public, anon;
grant execute on function public.end_sleep(uuid,timestamptz) to authenticated;
commit;
