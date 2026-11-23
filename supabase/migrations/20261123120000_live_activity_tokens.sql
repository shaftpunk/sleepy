begin;

create table public.live_activity_tokens (
  installation_id uuid not null references public.native_push_tokens(installation_id) on delete cascade,
  activity_id text not null,
  sleep_id uuid not null references public.sleep(id) on delete cascade,
  baby_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('production', 'sandbox')),
  push_token text,
  revision bigint not null check (revision > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (installation_id, activity_id)
);
create index live_activity_tokens_sleep on public.live_activity_tokens(sleep_id, baby_id);
create index live_activity_tokens_expiry on public.live_activity_tokens(expires_at);
alter table public.live_activity_tokens enable row level security;
revoke all on public.live_activity_tokens from public, anon, authenticated;
grant all on public.live_activity_tokens to service_role;

create function public.register_live_activity_token(
  p_installation_id uuid, p_installation_key text, p_activity_id text,
  p_sleep_id uuid, p_baby_id uuid, p_environment text, p_push_token text,
  p_revision bigint, p_expires_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  key_hash text;
  installation public.native_push_tokens;
  target public.sleep;
  applied boolean;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_installation_id is null or p_installation_key is null or p_installation_key !~ '^[a-f0-9]{64}$'
    or p_activity_id is null or length(p_activity_id) not between 1 and 200
    or p_push_token is null or p_push_token !~ '^[a-fA-F0-9]+$'
    or length(p_push_token) not between 32 and 512 or length(p_push_token) % 2 <> 0
    or p_environment is null or p_environment not in ('production', 'sandbox')
    or p_revision is null or p_revision <= 0
    or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Invalid Live Activity registration';
  end if;
  key_hash := encode(sha256(convert_to(p_installation_key, 'UTF8')), 'hex');
  -- Share the existing installation proof, including installations with alerts disabled.
  perform pg_advisory_xact_lock(hashtextextended(p_installation_id::text, 0));
  select * into installation from public.native_push_tokens where installation_id = p_installation_id;
  if found and installation.installation_key_hash <> key_hash then
    raise exception 'Invalid installation credential' using errcode = '42501';
  end if;

  select * into target from public.sleep where id = p_sleep_id for update;
  if not found or target.baby_id is distinct from p_baby_id or
    not coalesce(private.can_access_baby(target.baby_id), false) then
    raise exception 'Sleep unavailable' using errcode = '42501';
  end if;
  if target.endtime is not null or target.deleted_at is not null then return 'already_ended'; end if;

  -- Reserve revision zero for proof-only installations. The first alert write
  -- can still use its original revision 1, and no alert token or opt-in is set.
  if installation.installation_id is null then
    insert into public.native_push_tokens (installation_id, installation_key_hash, revision)
      values (p_installation_id, key_hash, 0);
  end if;

  delete from public.live_activity_tokens where expires_at <= now();
  insert into public.live_activity_tokens as existing (
    installation_id, activity_id, sleep_id, baby_id, user_id, environment, push_token, revision, expires_at
  ) values (
    p_installation_id, p_activity_id, p_sleep_id, target.baby_id, uid, p_environment,
    lower(p_push_token), p_revision, least(p_expires_at, now() + interval '8 hours')
  ) on conflict (installation_id, activity_id) do update set
    push_token = excluded.push_token, revision = excluded.revision, updated_at = now()
  where existing.user_id = uid and existing.sleep_id = p_sleep_id and existing.baby_id = target.baby_id
    and existing.environment = p_environment and existing.push_token is not null
    and excluded.revision > existing.revision
  returning true into applied;
  return case when applied then 'registered' else 'unchanged' end;
end;
$$;

alter table public.native_push_tokens drop constraint native_push_tokens_revision_check;
alter table public.native_push_tokens add check (revision > 0 or
  (revision = 0 and not enabled and user_id is null and device_token is null));

create function public.revoke_live_activity_token(
  p_installation_id uuid, p_installation_key text, p_activity_id text, p_revision bigint
) returns void language sql security definer set search_path = '' as $$
  update public.live_activity_tokens as activity set push_token = null, revision = p_revision, updated_at = now()
  from public.native_push_tokens as installation
  where activity.installation_id = p_installation_id and activity.activity_id = p_activity_id
    and activity.revision <= p_revision and activity.user_id = auth.uid()
    and installation.installation_id = activity.installation_id
    and installation.installation_key_hash = encode(sha256(convert_to(p_installation_key, 'UTF8')), 'hex');
$$;

revoke all on function public.register_live_activity_token(uuid,text,text,uuid,uuid,text,text,bigint,timestamptz) from public, anon;
revoke all on function public.revoke_live_activity_token(uuid,text,text,bigint) from public, anon;
grant execute on function public.register_live_activity_token(uuid,text,text,uuid,uuid,text,text,bigint,timestamptz) to authenticated;
grant execute on function public.revoke_live_activity_token(uuid,text,text,bigint) to authenticated;
-- Select only current caregivers, including other installations of the actor.
create function public.live_activity_end_targets(p_sleep_id uuid, p_baby_id uuid, p_endtime timestamptz)
returns table (installation_id uuid, activity_id text, revision bigint, environment text, push_token text)
language sql stable security definer set search_path = '' as $$
  select token.installation_id, token.activity_id, token.revision, token.environment, token.push_token
  from public.live_activity_tokens token
  join public.sleep s on s.id = token.sleep_id and s.baby_id = token.baby_id
  where token.sleep_id = p_sleep_id and token.baby_id = p_baby_id
    and s.endtime = p_endtime and s.deleted_at is null
    and token.expires_at > now() and token.push_token is not null
    and exists (
      select 1 from public.baby_households baby
      join public.household_members member using (household_id)
      where baby.baby_id = token.baby_id and member.user_id = token.user_id
    );
$$;
revoke all on function public.live_activity_end_targets(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.live_activity_end_targets(uuid,uuid,timestamptz) to service_role;
commit;
