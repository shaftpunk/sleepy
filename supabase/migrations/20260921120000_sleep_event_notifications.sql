-- Sleep start / wake-up push notifications.
--
-- Adds per-user, per-baby opt-in (notify_sleep_started / notify_sleep_ended,
-- both already present on notification_settings) and a database trigger that
-- fires a webhook to a new "sleep-notify" Edge Function whenever a sleep
-- session genuinely starts or ends - never on historical edits/splits.
--
-- Also tightens two tables that were left fully permissive (readable/
-- writable by anon AND authenticated, unconditionally) from before
-- multi-user support: notification_settings and push_subscriptions.
begin;

-- ---------------------------------------------------------------------
-- 1. Schema: let the legacy bbyid column be absent for the new per-baby
--    rows. Existing rows are untouched; the CHECK constraint already
--    passes on NULL (SQL CHECK only rejects FALSE, not NULL), so the
--    'Hamar'/'Drammen' constraint stays exactly as it is for legacy rows.
-- ---------------------------------------------------------------------

alter table public.notification_settings alter column bbyid drop not null;

-- One row per (user, baby) for the new sleep-event preferences. Existing
-- legacy rows (user_id/baby_id both null) are unaffected - Postgres treats
-- NULLs as distinct from each other in a unique index.
create unique index if not exists notification_settings_user_baby_key
  on public.notification_settings (user_id, baby_id);

-- ---------------------------------------------------------------------
-- 2. RLS: replace the legacy "anyone, including anon" policies with
--    per-user scoping. Rows that pre-date per-user attribution (user_id
--    is null - the legacy bbyid-only feeding-reminder rows / subscriptions)
--    remain reachable by any signed-in user exactly as they are today, so
--    the existing feeding-reminder settings UI keeps working unchanged.
--    Anonymous access is removed entirely; it was never required by the
--    application (the whole app sits behind AuthGate).
-- ---------------------------------------------------------------------

drop policy if exists "Allow notification settings select" on public.notification_settings;
drop policy if exists "Allow notification settings insert" on public.notification_settings;
drop policy if exists "Allow notification settings update" on public.notification_settings;

create policy notification_settings_select_own on public.notification_settings
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy notification_settings_insert_own on public.notification_settings
  for insert to authenticated
  with check (
    (user_id is null or user_id = (select auth.uid()))
    and (baby_id is null or private.can_access_baby(baby_id))
  );

create policy notification_settings_update_own on public.notification_settings
  for update to authenticated
  using (user_id is null or user_id = (select auth.uid()))
  with check (
    (user_id is null or user_id = (select auth.uid()))
    and (baby_id is null or private.can_access_baby(baby_id))
  );

drop policy if exists "Allow push select" on public.push_subscriptions;
drop policy if exists "Allow push insert" on public.push_subscriptions;
drop policy if exists "Allow push update" on public.push_subscriptions;
drop policy if exists "Allow push delete" on public.push_subscriptions;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id is null or user_id = (select auth.uid()));

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id is null or user_id = (select auth.uid()))
  with check (user_id is null or user_id = (select auth.uid()));

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id is null or user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Shared secret for the sleep -> Edge Function webhook, stored in
--    Vault so it never appears in git or in a client bundle. Generated
--    once here; the same value must be set as the sleep-notify function's
--    SLEEP_EVENT_WEBHOOK_SECRET secret (see deployment instructions).
--    Safe to run more than once: skips creation if it already exists.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sleep_notify_webhook_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'sleep_notify_webhook_secret',
      'Shared secret the sleep-event trigger sends to the sleep-notify Edge Function.'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Trigger: detect a genuine "sleep started" (fresh active session) or
--    "sleep ended" (active session just completed) transition and hand
--    off recipient selection + push delivery to the sleep-notify Edge
--    Function, which runs with the service role key. Recipient lookup and
--    push credentials never touch the client.
--
--    - INSERT with endtime already set (createManualSleep, a historical
--      entry) is NOT a "started" event and is skipped.
--    - UPDATE is only a "ended" event on a genuine null -> non-null
--      endtime transition. Editing an already-completed session
--      (updateSleep) and split_sleep_session both only ever touch rows
--      whose endtime was already non-null, so neither can trigger this.
--    - Dispatch failures (missing secret, pg_net error, etc.) are caught
--      and logged as a WARNING; they never fail the sleep write itself.
-- ---------------------------------------------------------------------

create or replace function public.notify_sleep_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_actor_user_id uuid;
  v_secret text;
begin
  if tg_op = 'INSERT' then
    if new.endtime is not null then
      return new;
    end if;
    v_event := 'started';
    v_actor_user_id := new.created_by_user_id;
  elsif tg_op = 'UPDATE' then
    if old.endtime is not null or new.endtime is null then
      return new;
    end if;
    v_event := 'ended';
    v_actor_user_id := new.updated_by_user_id;
  else
    return new;
  end if;

  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'sleep_notify_webhook_secret'
    limit 1;

    if v_secret is null then
      raise warning 'notify_sleep_event: webhook secret not configured, skipping dispatch';
      return new;
    end if;

    perform net.http_post(
      url := 'https://zebrmlignzctngbxijql.supabase.co/functions/v1/sleep-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sleepy-webhook-secret', v_secret
      ),
      body := jsonb_build_object(
        'sleep_id', new.id,
        'baby_id', new.baby_id,
        'event', v_event,
        'actor_user_id', v_actor_user_id
      )
    );
  exception when others then
    raise warning 'notify_sleep_event: dispatch failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists sleep_notify_event on public.sleep;

create trigger sleep_notify_event
  after insert or update on public.sleep
  for each row
  execute function public.notify_sleep_event();

commit;
