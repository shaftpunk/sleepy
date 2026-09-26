create or replace function public.create_baby_for_household(
  target_household_id uuid,
  baby_name text,
  baby_birth_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := trim(baby_name);
  new_baby_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if target_household_id is null then
    raise exception 'Household is required';
  end if;

  if not exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = current_user_id
      and hm.role in ('owner', 'parent')
  ) then
    raise exception 'Only household owners and parents can add children';
  end if;

  if normalized_name is null
     or char_length(normalized_name) < 1
     or char_length(normalized_name) > 100 then
    raise exception 'Invalid child name';
  end if;

  if baby_birth_date is not null and baby_birth_date > current_date then
    raise exception 'Birth date cannot be in the future';
  end if;

  insert into public.babies (
    name,
    birth_date,
    created_by_user_id
  )
  values (
    normalized_name,
    baby_birth_date,
    current_user_id
  )
  returning id into new_baby_id;

  insert into public.baby_households (
    baby_id,
    household_id
  )
  values (
    new_baby_id,
    target_household_id
  );

  return jsonb_build_object(
    'id', new_baby_id,
    'name', normalized_name,
    'birth_date', baby_birth_date
  );
end;
$$;

revoke all on function public.create_baby_for_household(uuid, text, date) from public;
grant execute on function public.create_baby_for_household(uuid, text, date) to authenticated;

