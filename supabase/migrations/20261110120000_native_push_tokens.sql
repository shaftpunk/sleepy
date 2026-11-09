-- Native APNs addresses remain separate from browser/VAPID subscriptions.
begin;
create table public.native_push_tokens (
  installation_id uuid primary key,
  installation_key_hash text not null,
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null default 'ios' check (platform = 'ios'),
  device_token text,
  topic text not null default 'no.strandeconsulting.sleepy' check (topic = 'no.strandeconsulting.sleepy'),
  environment text not null default 'production' check (environment = 'production'),
  revision bigint not null check (revision > 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (not enabled or (user_id is not null and device_token is not null))
);
create unique index native_push_tokens_address_key
  on public.native_push_tokens(topic, environment, device_token) where device_token is not null;
create index native_push_tokens_user_key on public.native_push_tokens(user_id) where enabled;
alter table public.native_push_tokens enable row level security;
revoke all on public.native_push_tokens from anon, authenticated;
grant select on public.native_push_tokens to authenticated;
grant all on public.native_push_tokens to service_role;
create policy native_push_tokens_read_own on public.native_push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

-- The 256-bit installation key proves possession during account switching.
-- Retain a disabled tombstone + revision on detach to reject older in-flight writes.
create function public.set_native_push_registration(
  p_installation_id uuid, p_installation_key text, p_revision bigint,
  p_device_token text default null, p_enabled boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  key_hash text;
  existing public.native_push_tokens;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_installation_key is null or p_installation_key !~ '^[a-f0-9]{64}$'
    or p_revision is null or p_revision <= 0 or p_enabled is null then
    raise exception 'Invalid registration';
  end if;
  if p_enabled and (p_device_token is null or p_device_token !~ '^[a-fA-F0-9]+$'
    or char_length(p_device_token) not between 32 and 512) then
    raise exception 'Invalid device token';
  end if;
  key_hash := encode(sha256(convert_to(p_installation_key, 'UTF8')), 'hex');
  -- Serialize creation as well as updates of the same installation.
  perform pg_advisory_xact_lock(hashtextextended(p_installation_id::text, 0));
  select * into existing from public.native_push_tokens where installation_id = p_installation_id for update;
  if found then
    if existing.installation_key_hash <> key_hash then raise exception 'Invalid installation credential'; end if;
    if p_revision <= existing.revision then return false; end if;
  end if;
  insert into public.native_push_tokens (
    installation_id, installation_key_hash, user_id, device_token, revision, enabled
  ) values (
    p_installation_id, key_hash, case when p_enabled then uid else null end,
    case when p_enabled then lower(p_device_token) else null end, p_revision, p_enabled
  ) on conflict (installation_id) do update set
    user_id = excluded.user_id, device_token = excluded.device_token,
    revision = excluded.revision, enabled = excluded.enabled,
    updated_at = now(), last_seen_at = now();
  return true;
end;
$$;
revoke all on function public.set_native_push_registration(uuid,text,bigint,text,boolean) from public, anon;
grant execute on function public.set_native_push_registration(uuid,text,bigint,text,boolean) to authenticated;
commit;
