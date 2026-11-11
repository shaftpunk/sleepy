-- Local preparation only. No changes to roles, household data or feature enforcement.
begin;
alter table private.entitlement_funding_sources
  add column provider_project_id text,
  add column provider_app_id text,
  add column store text,
  add column subscription_status text,
  add column auto_renewal_status text,
  add column pending_payment boolean,
  add column latest_store_transaction_id text;

-- Account state only fences snapshots/rate limits. It NEVER owns a destination.
create table private.revenuecat_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  app_id text not null,
  revision bigint not null default 0,
  window_started_at timestamptz not null default statement_timestamp(),
  window_requests integer not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  primary key(user_id,project_id,app_id)
);
-- Apple original transaction identity is verified server-side, not supplied as
-- authority by a client. Independent chains may have independent destinations.
create table private.revenuecat_subscription_chains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  project_id text not null,
  app_id text not null,
  environment text not null check(environment in ('production','sandbox')),
  original_transaction_id text not null check(length(original_transaction_id) between 1 and 255),
  household_id uuid references public.households(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(project_id,app_id,environment,original_transaction_id)
);
alter table private.revenuecat_subscription_chains add constraint revenuecat_chain_destination unique(id,household_id);
alter table private.entitlement_funding_sources add column subscription_chain_id uuid references private.revenuecat_subscription_chains(id);
alter table private.entitlement_funding_sources add constraint revenuecat_funding_chain_destination
  foreign key(subscription_chain_id,funded_household_id) references private.revenuecat_subscription_chains(id,household_id) deferrable initially deferred;
create table private.revenuecat_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  app_id text not null,
  household_id uuid not null references public.households(id),
  baby_id uuid not null references public.babies(id),
  product_id text not null check(product_id in ('sleepy_plus_monthly','sleepy_plus_yearly')),
  known_subscription_ids text[] not null,
  consumed_chain_id uuid references private.revenuecat_subscription_chains(id),
  consumed_transaction_id text,
  status text not null default 'pending' check(status in ('pending','consumed','expired')),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp()+interval '2 hours',
  consumed_at timestamptz,
  check(expires_at>created_at)
);
create unique index revenuecat_one_pending_intent on private.revenuecat_purchase_intents(user_id,project_id,app_id) where status='pending';
create table private.revenuecat_webhook_inbox (
  event_id text primary key check(length(event_id) between 1 and 255),
  project_id text not null,
  app_id text not null,
  environment text not null check(environment in ('production','sandbox','unspecified')),
  event_type text not null,
  event_at timestamptz not null,
  affected_users uuid[] not null,
  payload_hash text not null,
  status text not null default 'pending' check(status in ('pending','processed','failed')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz
);
-- Safe structural audit; never raw receipts, tokens, webhook attributes or secrets.
create table private.revenuecat_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  from_household_id uuid,
  to_household_id uuid,
  detail jsonb not null default '{}',
  created_at timestamptz not null default statement_timestamp()
);
alter table private.revenuecat_accounts enable row level security;
alter table private.revenuecat_subscription_chains enable row level security;
alter table private.revenuecat_purchase_intents enable row level security;
alter table private.revenuecat_webhook_inbox enable row level security;
alter table private.revenuecat_audit enable row level security;
revoke all on private.revenuecat_accounts,private.revenuecat_subscription_chains,private.revenuecat_purchase_intents,private.revenuecat_webhook_inbox,private.revenuecat_audit from public,anon,authenticated;
grant select,insert,update,delete on private.revenuecat_accounts,private.revenuecat_subscription_chains,private.revenuecat_purchase_intents,private.revenuecat_webhook_inbox to service_role;
grant select,insert on private.revenuecat_audit to service_role;
grant usage,select on sequence private.revenuecat_audit_id_seq to service_role;

-- These RPCs accept a user ONLY from a trusted Edge Function after getUser(JWT),
-- or from an authenticated webhook. Normal clients cannot execute them.
create function public.revenuecat_begin(p_user uuid,p_project text,p_app text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.revenuecat_accounts; ids jsonb;
begin
  if not exists(select 1 from auth.users where id=p_user) then return null; end if;
  insert into private.revenuecat_accounts(user_id,project_id,app_id) values(p_user,p_project,p_app) on conflict do nothing;
  select * into a from private.revenuecat_accounts where user_id=p_user and project_id=p_project and app_id=p_app for update;
  if a.window_started_at>statement_timestamp()-interval '1 minute' and a.window_requests>=30 then raise exception 'Reconciliation rate limited' using errcode='53000'; end if;
  update private.revenuecat_accounts set revision=revision+1,updated_at=statement_timestamp()
    ,window_requests=case when window_started_at<=statement_timestamp()-interval '1 minute' then 1 else window_requests+1 end,
    window_started_at=case when window_started_at<=statement_timestamp()-interval '1 minute' then statement_timestamp() else window_started_at end
    where user_id=p_user and project_id=p_project and app_id=p_app returning * into a;
  select coalesce(jsonb_agg(substring(external_transaction_id from length(p_project||':'||p_app||':')+1)),'[]') into ids
    from private.entitlement_funding_sources where purchaser_user_id=p_user and provider='revenuecat'
    and provider_project_id=p_project and provider_app_id=p_app;
  return jsonb_build_object('revision',a.revision,'subscription_ids',ids);
end $$;

create function public.revenuecat_prepare(p_user uuid,p_project text,p_app text,p_household uuid,p_baby uuid,p_product text,p_known text[],p_attempt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.revenuecat_accounts; i private.revenuecat_purchase_intents;
begin
  if p_attempt is null then raise exception 'Purchase attempt required' using errcode='42501'; end if;
  if not exists(select 1 from public.household_members m join public.baby_households b on b.household_id=m.household_id
    where m.user_id=p_user and m.household_id=p_household and b.baby_id=p_baby) then
    raise exception 'Purchase context unavailable' using errcode='42501'; end if;
  insert into private.revenuecat_accounts(user_id,project_id,app_id) values(p_user,p_project,p_app) on conflict do nothing;
  select * into a from private.revenuecat_accounts where user_id=p_user and project_id=p_project and app_id=p_app for update;
  update private.revenuecat_purchase_intents set status='expired' where user_id=p_user and project_id=p_project and app_id=p_app and status='pending' and expires_at<=statement_timestamp();
  select * into i from private.revenuecat_purchase_intents where user_id=p_user and project_id=p_project and app_id=p_app and status='pending' for update;
  if found then
    if i.attempt_id<>p_attempt or i.household_id<>p_household or i.baby_id<>p_baby or i.product_id<>p_product then raise exception 'Another purchase context is pending' using errcode='42501'; end if;
  else
    insert into private.revenuecat_purchase_intents(attempt_id,user_id,project_id,app_id,household_id,baby_id,product_id,known_subscription_ids)
      values(p_attempt,p_user,p_project,p_app,p_household,p_baby,p_product,p_known) returning * into i;
  end if;
  return jsonb_build_object('intentId',i.id,'expiresAt',i.expires_at);
end $$;

create function public.revenuecat_apply(p_user uuid,p_project text,p_app text,p_revision bigint,p_sources jsonb,p_intent uuid default null,p_transaction text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.revenuecat_accounts; i private.revenuecat_purchase_intents; s jsonb; prior private.entitlement_funding_sources;
  c private.revenuecat_subscription_chains; source_key text; qualified boolean; has_access boolean:=false;
  matched jsonb; destinations uuid[]:='{}'; unresolved boolean:=false; did_bind boolean:=false; return_household uuid; subscription_state text;
begin
  select * into a from private.revenuecat_accounts where user_id=p_user and project_id=p_project and app_id=p_app for update;
  if not found or a.revision<>p_revision then raise exception 'Stale reconciliation' using errcode='40001'; end if;
  if jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources)>100 then raise exception 'Invalid verified snapshot'; end if;
  if p_intent is not null then
    select * into i from private.revenuecat_purchase_intents where id=p_intent and user_id=p_user and project_id=p_project and app_id=p_app for update;
    if not found then raise exception 'Purchase context unavailable' using errcode='42501'; end if;
    -- Exactly one current transaction may consume an intent. Its Apple purchase
    -- time (not RC segment start) fences old receipts and unrelated old sources.
    if p_transaction is not null and 1=(select count(*) from jsonb_array_elements(p_sources) x
      where x->>'correlation'=p_transaction and (x->>'access')::boolean and x->>'product'=i.product_id
        and not(x->>'id'=any(i.known_subscription_ids)) and (x->>'purchaseAt')::timestamptz>=i.created_at) then
      select x into matched from jsonb_array_elements(p_sources) x where x->>'correlation'=p_transaction
        and (x->>'access')::boolean and x->>'product'=i.product_id and not(x->>'id'=any(i.known_subscription_ids))
        and (x->>'purchaseAt')::timestamptz>=i.created_at;
    end if;
  end if;
  update private.entitlement_funding_sources set status='expired',verified_at=statement_timestamp()
    where purchaser_user_id=p_user and provider='revenuecat' and provider_project_id=p_project and provider_app_id=p_app;
  for s in select value from jsonb_array_elements(p_sources) loop
    if s->>'environment' not in ('production','sandbox') or s->>'product' not in ('sleepy_plus_monthly','sleepy_plus_yearly')
      or coalesce(length(s->>'id'),0) not between 1 and 255 or coalesce(length(s->>'chain'),0) not between 1 and 255 then
      raise exception 'Invalid verified source'; end if;
    insert into private.revenuecat_subscription_chains(user_id,project_id,app_id,environment,original_transaction_id)
      values(p_user,p_project,p_app,s->>'environment',s->>'chain') on conflict do nothing;
    select * into c from private.revenuecat_subscription_chains where project_id=p_project and app_id=p_app
      and environment=s->>'environment' and original_transaction_id=s->>'chain' for update;
    if c.user_id is distinct from p_user then raise exception 'Subscription ownership conflict' using errcode='42501'; end if;
    -- An already bound chain keeps its household during product changes. No new
    -- intent can rebind it, nor be consumed by its upgrade/renewal/restore.
    if c.household_id is null and matched->>'id'=s->>'id' and i.status='pending' and i.expires_at>statement_timestamp()
      and exists(select 1 from public.household_members m join public.baby_households b on b.household_id=m.household_id
        where m.user_id=p_user and m.household_id=i.household_id and b.baby_id=i.baby_id)
      and not exists(select 1 from private.entitlement_funding_sources f where f.subscription_chain_id=c.id
        and substring(f.external_transaction_id from length(p_project||':'||p_app||':')+1)=any(i.known_subscription_ids)) then
      update private.revenuecat_subscription_chains set household_id=i.household_id,updated_at=statement_timestamp() where id=c.id returning * into c;
      update private.revenuecat_purchase_intents set status='consumed',consumed_at=statement_timestamp(),
        consumed_chain_id=c.id,consumed_transaction_id=p_transaction where id=i.id;
      insert into private.revenuecat_audit(actor_user_id,action,to_household_id,detail)
        values(p_user,'bind',c.household_id,jsonb_build_object('chain_id',c.id,'intent_id',i.id));
      did_bind:=true;
    end if;
    source_key:=p_project||':'||p_app||':'||(s->>'id');
    select * into prior from private.entitlement_funding_sources where provider='revenuecat' and environment=s->>'environment' and external_transaction_id=source_key for update;
    if found and (prior.purchaser_user_id is distinct from p_user or prior.subscription_chain_id is distinct from c.id) then
      raise exception 'Subscription ownership conflict' using errcode='42501'; end if;
    qualified:=(s->>'access')::boolean and (s->>'endsAt')::timestamptz>statement_timestamp();
    has_access:=has_access or qualified;
    if qualified then
      if c.household_id is null or not exists(select 1 from public.household_members where user_id=p_user and household_id=c.household_id) then unresolved:=true;
      else destinations:=array_append(destinations,c.household_id); end if;
    end if;
    insert into private.entitlement_funding_sources(purchaser_user_id,funded_household_id,provider,external_customer_id,external_transaction_id,
      product_id,environment,status,valid_from,verified_access_until,verified_at,provenance,provider_project_id,provider_app_id,store,
      subscription_status,auto_renewal_status,pending_payment,latest_store_transaction_id,subscription_chain_id)
    values(p_user,c.household_id,'revenuecat',p_user::text,source_key,s->>'product',s->>'environment',case when qualified then 'active' else 'revoked' end,
      (s->>'startsAt')::timestamptz,(s->>'endsAt')::timestamptz,statement_timestamp(),jsonb_build_object('verification','revenuecat-v2+apple-server'),p_project,p_app,'app_store',
      s->>'status',s->>'renewal',(s->>'pending')::boolean,s->>'transaction',c.id)
    on conflict(provider,environment,external_transaction_id) do update set
      funded_household_id=excluded.funded_household_id,status=excluded.status,product_id=excluded.product_id,valid_from=excluded.valid_from,verified_access_until=excluded.verified_access_until,
      verified_at=excluded.verified_at,subscription_status=excluded.subscription_status,auto_renewal_status=excluded.auto_renewal_status,
      pending_payment=excluded.pending_payment,latest_store_transaction_id=excluded.latest_store_transaction_id
      where private.entitlement_funding_sources.purchaser_user_id=excluded.purchaser_user_id and private.entitlement_funding_sources.subscription_chain_id=excluded.subscription_chain_id;
    if not found then raise exception 'Subscription ownership conflict' using errcode='42501'; end if;
  end loop;
  if did_bind then
    update private.entitlement_funding_sources f set funded_household_id=c2.household_id
      from private.revenuecat_subscription_chains c2 where f.subscription_chain_id=c2.id and c2.user_id=p_user and c2.project_id=p_project and c2.app_id=p_app;
  end if;
  insert into private.revenuecat_audit(actor_user_id,action,detail) values(p_user,'reconcile',jsonb_build_object('source_count',jsonb_array_length(p_sources)));
  -- Only the exact consumed intent or a single unambiguous valid household is
  -- returned. Independent chain destinations are never reduced to a first row.
  if did_bind or (i.status='consumed' and i.consumed_transaction_id=p_transaction) then
    select * into c from private.revenuecat_subscription_chains where id=(select consumed_chain_id from private.revenuecat_purchase_intents where id=i.id);
    if exists(select 1 from public.household_members where user_id=p_user and household_id=c.household_id) then
      return_household:=c.household_id; end if;
  end if;
  select array_agg(distinct d) into destinations from unnest(destinations) d;
  if return_household is null and cardinality(destinations)=1 and not unresolved then select d into return_household from unnest(destinations) d; end if;
  if return_household is not null then
    select case when bool_or(environment='production') then 'production' when bool_or(environment='sandbox') then 'sandbox' else 'none' end into subscription_state
      from private.entitlement_funding_sources where purchaser_user_id=p_user and provider='revenuecat' and provider_project_id=p_project and provider_app_id=p_app
      and funded_household_id=return_household and status='active' and verified_access_until>statement_timestamp() and valid_from<=statement_timestamp();
    return jsonb_build_object('state','verified','subscriptionState',subscription_state,'householdId',return_household);
  end if;
  return jsonb_build_object('state',case when unresolved then 'assignmentRequired' when has_access then 'verifiedMultiple' else 'free' end,'householdId',null);
end $$;

create function public.revenuecat_transfer(p_user uuid,p_project text,p_app text,p_chain uuid,p_household uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.revenuecat_subscription_chains;
begin
  if not exists(select 1 from public.household_members where user_id=p_user and household_id=p_household) then raise exception 'Destination unavailable' using errcode='42501'; end if;
  perform 1 from private.revenuecat_accounts where user_id=p_user and project_id=p_project and app_id=p_app for update;
  select * into c from private.revenuecat_subscription_chains where id=p_chain and user_id=p_user and project_id=p_project and app_id=p_app for update;
  if not found or not exists(select 1 from private.entitlement_funding_sources where subscription_chain_id=c.id and purchaser_user_id=p_user) then
    raise exception 'No verified subscription' using errcode='42501'; end if;
  update private.revenuecat_subscription_chains set household_id=p_household,updated_at=statement_timestamp() where id=c.id;
  update private.revenuecat_accounts set revision=revision+1,updated_at=statement_timestamp() where user_id=p_user and project_id=p_project and app_id=p_app;
  update private.entitlement_funding_sources set funded_household_id=p_household where subscription_chain_id=c.id;
  update private.revenuecat_purchase_intents set status='expired' where user_id=p_user and project_id=p_project and app_id=p_app and status='pending';
  insert into private.revenuecat_audit(actor_user_id,action,from_household_id,to_household_id,detail)
    values(p_user,'transfer',c.household_id,p_household,jsonb_build_object('chain_id',c.id));
  return jsonb_build_object('state','verified','householdId',p_household);
end $$;

create function public.revenuecat_cancel_intent(p_user uuid,p_project text,p_app text,p_intent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from private.revenuecat_accounts where user_id=p_user and project_id=p_project and app_id=p_app for update;
  update private.revenuecat_purchase_intents set status='expired' where id=p_intent and user_id=p_user
    and project_id=p_project and app_id=p_app and status='pending';
end $$;

create function public.revenuecat_accept_event(p_id text,p_project text,p_app text,p_environment text,p_type text,p_at timestamptz,p_users uuid[],p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare e private.revenuecat_webhook_inbox;
begin
  insert into private.revenuecat_webhook_inbox(event_id,project_id,app_id,environment,event_type,event_at,affected_users,payload_hash)
    values(p_id,p_project,p_app,p_environment,p_type,p_at,p_users,p_hash) on conflict do nothing;
  select * into e from private.revenuecat_webhook_inbox where event_id=p_id for update;
  if e.payload_hash<>p_hash or e.project_id<>p_project or e.app_id<>p_app then raise exception 'Webhook identity conflict' using errcode='42501'; end if;
  if e.status='processed' then return false; end if;
  update private.revenuecat_webhook_inbox set attempts=attempts+1,last_attempt_at=statement_timestamp() where event_id=p_id;
  return true;
end $$;
create function public.revenuecat_finish_event(p_id text,p_hash text,p_success boolean) returns void
language sql security definer set search_path='' as $$
  update private.revenuecat_webhook_inbox set status=case when p_success then 'processed' else 'failed' end,
    processed_at=case when p_success then statement_timestamp() else null end,last_attempt_at=statement_timestamp()
    where event_id=p_id and payload_hash=p_hash and status<>'processed';
$$;

create function public.revenuecat_maintenance_work(p_project text,p_app text) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',event_id,'hash',payload_hash,'users',affected_users)),'[]')
      from (select * from private.revenuecat_webhook_inbox where project_id=p_project and app_id=p_app and status<>'processed'
        order by coalesce(last_attempt_at,received_at) limit 1) e),
    'users',(select coalesce(jsonb_agg(user_id),'[]') from (
      select a.user_id from private.revenuecat_accounts a where a.project_id=p_project and a.app_id=p_app
        and a.updated_at<statement_timestamp()-interval '2 minutes'
        and exists(select 1 from private.entitlement_funding_sources f where f.purchaser_user_id=a.user_id and f.provider='revenuecat'
          and f.provider_project_id=p_project and f.provider_app_id=p_app and f.status='active')
        order by a.updated_at limit 5) a));
$$;

revoke all on function public.revenuecat_begin(uuid,text,text),public.revenuecat_prepare(uuid,text,text,uuid,uuid,text,text[],uuid),
  public.revenuecat_cancel_intent(uuid,text,text,uuid),
  public.revenuecat_apply(uuid,text,text,bigint,jsonb,uuid,text),public.revenuecat_transfer(uuid,text,text,uuid,uuid),
  public.revenuecat_accept_event(text,text,text,text,text,timestamptz,uuid[],text),public.revenuecat_finish_event(text,text,boolean),
  public.revenuecat_maintenance_work(text,text) from public,anon,authenticated;
grant execute on function public.revenuecat_begin(uuid,text,text),public.revenuecat_prepare(uuid,text,text,uuid,uuid,text,text[],uuid),
  public.revenuecat_cancel_intent(uuid,text,text,uuid),
  public.revenuecat_apply(uuid,text,text,bigint,jsonb,uuid,text),public.revenuecat_transfer(uuid,text,text,uuid,uuid),
  public.revenuecat_accept_event(text,text,text,text,text,timestamptz,uuid[],text),public.revenuecat_finish_event(text,text,boolean),
  public.revenuecat_maintenance_work(text,text) to service_role;
commit;
