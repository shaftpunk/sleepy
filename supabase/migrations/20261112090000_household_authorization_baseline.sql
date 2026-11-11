-- Metadata-only baseline guard. Captured deployed definitions are in
-- supabase/baselines/household-authorization.json; local tests install that snapshot.
-- This migration never replaces a function, policy, membership or invitation.
begin;
do $baseline$
begin
  if to_regprocedure('private.has_household_role(uuid,text[])') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('private.has_household_role(uuid,text[])')),chr(13),'')) <> '1847bad0e45d94d920131dfa9ece6853' then
    raise exception 'Household baseline drift: private.has_household_role';
  end if;
  if to_regprocedure('private.can_access_baby(uuid)') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('private.can_access_baby(uuid)')),chr(13),'')) <> 'a23338be07c77b63d840e5f72a2e6750' then
    raise exception 'Household baseline drift: private.can_access_baby';
  end if;
  if to_regprocedure('private.is_household_member(uuid)') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('private.is_household_member(uuid)')),chr(13),'')) <> '608ed6945d554515e2170119d5b2ab94' then
    raise exception 'Household baseline drift: private.is_household_member';
  end if;
  if to_regprocedure('private.has_baby_role(uuid,text[])') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('private.has_baby_role(uuid,text[])')),chr(13),'')) <> '3bd751e5273d7ad52aeb9cf8b980b1cc' then
    raise exception 'Household baseline drift: private.has_baby_role';
  end if;
  if to_regprocedure('public.handle_new_user()') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('public.handle_new_user()')),chr(13),'')) <> 'c93a5843c868135cec231e4411cbef29' then
    raise exception 'Household baseline drift: public.handle_new_user';
  end if;
  if to_regprocedure('public.create_household_with_baby(text,text,date)') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('public.create_household_with_baby(text,text,date)')),chr(13),'')) <> 'b707eb43a5a6bff66821cf93e1026910' then
    raise exception 'Household baseline drift: public.create_household_with_baby';
  end if;
  if to_regprocedure('public.create_household_invitation(uuid,text,integer)') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('public.create_household_invitation(uuid,text,integer)')),chr(13),'')) <> '70c94bbfc95fa538eec01f54232a971a' then
    raise exception 'Household baseline drift: public.create_household_invitation';
  end if;
  if to_regprocedure('public.accept_household_invitation(text)') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('public.accept_household_invitation(text)')),chr(13),'')) <> 'a560cb7ee66376a4f2422d3f460b3587' then
    raise exception 'Household baseline drift: public.accept_household_invitation';
  end if;
  if to_regprocedure('public.create_baby_for_household(uuid,text,date)') is null or
     md5(replace(pg_get_functiondef(to_regprocedure('public.create_baby_for_household(uuid,text,date)')),chr(13),'')) <> 'e69f6cf85e2a1ed1a089fa3d5b11df8d' then
    raise exception 'Household baseline drift: public.create_baby_for_household';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='babies' and policyname='babies_insert_authenticated'
    and cmd='INSERT' and roles::text='{authenticated}'
    and qual is not distinct from null and with_check is not distinct from '(created_by_user_id = ( SELECT auth.uid() AS uid))') then
    raise exception 'Household baseline policy drift: babies_insert_authenticated';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='babies' and policyname='babies_select_member'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from '( SELECT private.can_access_baby(babies.id) AS can_access_baby)' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: babies_select_member';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='babies' and policyname='babies_update_parent'
    and cmd='UPDATE' and roles::text='{authenticated}'
    and qual is not distinct from '( SELECT private.has_baby_role(babies.id, ARRAY[''owner''::text, ''parent''::text]) AS has_baby_role)' and with_check is not distinct from '( SELECT private.has_baby_role(babies.id, ARRAY[''owner''::text, ''parent''::text]) AS has_baby_role)') then
    raise exception 'Household baseline policy drift: babies_update_parent';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='baby_households' and policyname='baby_households_select_member'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from '( SELECT private.is_household_member(baby_households.household_id) AS is_household_member)' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: baby_households_select_member';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feed' and policyname='feed_insert_caregiver'
    and cmd='INSERT' and roles::text='{authenticated}'
    and qual is not distinct from null and with_check is not distinct from 'private.has_baby_role(baby_id, ARRAY[''owner''::text, ''parent''::text, ''caregiver''::text])') then
    raise exception 'Household baseline policy drift: feed_insert_caregiver';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feed' and policyname='feed_select_household'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from 'private.can_access_baby(baby_id)' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: feed_select_household';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feed' and policyname='feed_update_caregiver'
    and cmd='UPDATE' and roles::text='{authenticated}'
    and qual is not distinct from 'private.has_baby_role(baby_id, ARRAY[''owner''::text, ''parent''::text, ''caregiver''::text])' and with_check is not distinct from 'private.has_baby_role(baby_id, ARRAY[''owner''::text, ''parent''::text, ''caregiver''::text])') then
    raise exception 'Household baseline policy drift: feed_update_caregiver';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='household_members' and policyname='household_members_select_member'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from '( SELECT private.is_household_member(household_members.household_id) AS is_household_member)' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: household_members_select_member';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='households' and policyname='households_insert_authenticated'
    and cmd='INSERT' and roles::text='{authenticated}'
    and qual is not distinct from null and with_check is not distinct from '(created_by_user_id = ( SELECT auth.uid() AS uid))') then
    raise exception 'Household baseline policy drift: households_insert_authenticated';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='households' and policyname='households_select_member'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from '( SELECT private.is_household_member(households.id) AS is_household_member)' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: households_select_member';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='households' and policyname='households_update_owner'
    and cmd='UPDATE' and roles::text='{authenticated}'
    and qual is not distinct from '( SELECT private.has_household_role(households.id, ARRAY[''owner''::text]) AS has_household_role)' and with_check is not distinct from '( SELECT private.has_household_role(households.id, ARRAY[''owner''::text]) AS has_household_role)') then
    raise exception 'Household baseline policy drift: households_update_owner';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_insert_own'
    and cmd='INSERT' and roles::text='{authenticated}'
    and qual is not distinct from null and with_check is not distinct from '(user_id = ( SELECT auth.uid() AS uid))') then
    raise exception 'Household baseline policy drift: profiles_insert_own';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from '(user_id = ( SELECT auth.uid() AS uid))' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: profiles_select_own';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own'
    and cmd='UPDATE' and roles::text='{authenticated}'
    and qual is not distinct from '(user_id = ( SELECT auth.uid() AS uid))' and with_check is not distinct from '(user_id = ( SELECT auth.uid() AS uid))') then
    raise exception 'Household baseline policy drift: profiles_update_own';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sleep' and policyname='sleep_insert_caregiver'
    and cmd='INSERT' and roles::text='{authenticated}'
    and qual is not distinct from null and with_check is not distinct from 'private.has_baby_role(baby_id, ARRAY[''owner''::text, ''parent''::text, ''caregiver''::text])') then
    raise exception 'Household baseline policy drift: sleep_insert_caregiver';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sleep' and policyname='sleep_select_household'
    and cmd='SELECT' and roles::text='{authenticated}'
    and qual is not distinct from 'private.can_access_baby(baby_id)' and with_check is not distinct from null) then
    raise exception 'Household baseline policy drift: sleep_select_household';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sleep' and policyname='sleep_update_caregiver'
    and cmd='UPDATE' and roles::text='{authenticated}'
    and qual is not distinct from 'private.has_baby_role(baby_id, ARRAY[''owner''::text, ''parent''::text, ''caregiver''::text])' and with_check is not distinct from 'private.has_baby_role(baby_id, ARRAY[''owner''::text, ''parent''::text, ''caregiver''::text])') then
    raise exception 'Household baseline policy drift: sleep_update_caregiver';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='babies' and c.relrowsecurity=true and c.relforcerowsecurity=false) then raise exception 'Household baseline RLS drift: babies'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='baby_households' and c.relrowsecurity=true and c.relforcerowsecurity=false) then raise exception 'Household baseline RLS drift: baby_households'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='household_invitations' and c.relrowsecurity=true and c.relforcerowsecurity=false) then raise exception 'Household baseline RLS drift: household_invitations'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='household_members' and c.relrowsecurity=true and c.relforcerowsecurity=false) then raise exception 'Household baseline RLS drift: household_members'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='households' and c.relrowsecurity=true and c.relforcerowsecurity=false) then raise exception 'Household baseline RLS drift: households'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='profiles' and c.relrowsecurity=true and c.relforcerowsecurity=false) then raise exception 'Household baseline RLS drift: profiles'; end if;
end
$baseline$;
commit;
