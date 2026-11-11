-- Phase 1 storage and read-only resolution. No product restrictions or grants.
-- Feature definitions mirror src/entitlements/features.json (parity tested).
begin;

create table private.entitlement_funding_sources (
  id uuid primary key default gen_random_uuid(),
  purchaser_user_id uuid references auth.users(id) on delete set null,
  funded_household_id uuid references public.households(id) on delete set null,
  provider text not null check (length(trim(provider)) > 0),
  external_customer_id text not null check (length(trim(external_customer_id)) > 0),
  -- Stable purchase/subscription lineage identity (e.g. original transaction),
  -- not a new row per renewal. One source can fund at most one household.
  external_transaction_id text not null check (length(trim(external_transaction_id)) > 0),
  product_id text not null check (length(trim(product_id)) > 0),
  environment text not null check (environment in ('production','sandbox')),
  tier text not null default 'plus' check (tier='plus'),
  status text not null check (status in ('pending','active','expired','revoked')),
  valid_from timestamptz not null check (isfinite(valid_from)),
  verified_access_until timestamptz not null check (isfinite(verified_access_until) and verified_access_until > valid_from),
  verified_at timestamptz not null check (isfinite(verified_at)),
  provenance jsonb not null check (jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(provider,environment,external_transaction_id)
);
create index entitlement_funding_household on private.entitlement_funding_sources(funded_household_id);

create table private.household_access_grants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  tier text not null default 'plus' check (tier='plus'),
  source text not null check (source in ('beta','promotion','admin','lifetime')),
  environment text not null check (environment in ('production','sandbox')),
  status text not null check (status in ('active','expired','revoked')),
  valid_from timestamptz not null check (isfinite(valid_from)),
  valid_until timestamptz check (isfinite(valid_until) and valid_until > valid_from),
  issued_by text not null check (length(trim(issued_by)) > 0),
  provenance jsonb not null check (jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create index household_access_grants_household on private.household_access_grants(household_id);

-- No client policies, SELECT privileges, or mutation privileges.
alter table private.entitlement_funding_sources enable row level security;
alter table private.household_access_grants enable row level security;
revoke all on private.entitlement_funding_sources, private.household_access_grants from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.entitlement_funding_sources, private.household_access_grants to service_role;

create function private.touch_entitlement_source() returns trigger
language plpgsql set search_path='' as $touch$
begin
  new.updated_at := statement_timestamp();
  return new;
end
$touch$;
revoke all on function private.touch_entitlement_source() from public, anon, authenticated;
create trigger entitlement_funding_updated before update on private.entitlement_funding_sources
  for each row execute function private.touch_entitlement_source();
create trigger household_grants_updated before update on private.household_access_grants
  for each row execute function private.touch_entitlement_source();

create function private.entitlement_feature_definitions() returns jsonb
language sql immutable set search_path='' as $features$
  select '{"core_tracking":{"requiredTier":"free"},"basic_history":{"requiredTier":"free"},"basic_analysis":{"requiredTier":"free"},"basic_live_activity":{"requiredTier":"free"},"notifications":{"requiredTier":"free"},"family":{"requiredTier":"plus"},"sound_monitoring":{"requiredTier":"plus"},"sound_activity":{"requiredTier":"plus"},"smart_live_activity":{"requiredTier":"plus"},"advanced_analysis":{"requiredTier":"plus"},"full_history":{"requiredTier":"plus"},"export":{"requiredTier":"plus"},"smart_insights":{"requiredTier":"plus"}}'::jsonb
$features$;
revoke all on function private.entitlement_feature_definitions() from public, anon, authenticated;

create function public.resolve_household_entitlements(p_household_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $resolve$
declare
  caller uuid := auth.uid();
  checked_at timestamptz := statement_timestamp();
  plus_count bigint;
  unlimited boolean;
  access_end timestamptz;
  next_boundary timestamptz;
  allowed jsonb;
begin
  if caller is null or not exists (
    select 1 from public.household_members hm
    where hm.household_id=p_household_id and hm.user_id=caller
  ) then raise exception 'Household unavailable or access denied' using errcode='42501'; end if;

  with qualifying as (
    select g.valid_until as ends_at
    from private.household_access_grants g
    where g.household_id=p_household_id and g.environment='production'
      and g.status='active' and g.valid_from<=checked_at
      and (g.valid_until is null or g.valid_until>checked_at)
    union all
    select f.verified_access_until
    from private.entitlement_funding_sources f
    where f.funded_household_id=p_household_id and f.environment='production'
      and f.status='active' and f.valid_from<=checked_at and f.verified_at<=checked_at
      and f.verified_access_until>checked_at and exists (
        select 1 from public.household_members purchaser
        where purchaser.household_id=f.funded_household_id and purchaser.user_id=f.purchaser_user_id
      )
  ) select count(*),coalesce(bool_or(ends_at is null),false),max(ends_at)
    into plus_count,unlimited,access_end from qualifying;

  select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into allowed
    from jsonb_each(private.entitlement_feature_definitions())
    where value->>'requiredTier'='free' or plus_count>0;

  select min(boundary) into next_boundary from (
    select g.valid_from as boundary from private.household_access_grants g
      where g.household_id=p_household_id and g.environment='production' and g.status='active' and g.valid_from>checked_at
    union all
    select f.valid_from from private.entitlement_funding_sources f
      where f.funded_household_id=p_household_id and f.environment='production' and f.status='active' and f.valid_from>checked_at
  ) upcoming;

  return jsonb_build_object(
    'household_id',p_household_id,'tier',case when plus_count>0 then 'plus' else 'free' end,
    'is_plus',plus_count>0,'features',allowed,'verification_state','verified',
    'verified_at',checked_at,'valid_until',case when plus_count>0 and not unlimited then access_end else null end,
    'recheck_at',least(checked_at+interval '5 minutes',next_boundary,
      case when plus_count>0 and not unlimited then access_end else null end),
    'policy_version',1
  );
end
$resolve$;
revoke all on function public.resolve_household_entitlements(uuid) from public, anon;
grant execute on function public.resolve_household_entitlements(uuid) to authenticated;
commit;
