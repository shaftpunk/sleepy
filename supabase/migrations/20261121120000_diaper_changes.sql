create table public.diaper_changes (
  id uuid primary key default gen_random_uuid(),
  baby_id uuid not null references public.babies(id) on delete cascade,
  type text not null check (type in ('wet', 'dirty', 'both')),
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);

create index diaper_changes_baby_changed_at_idx
  on public.diaper_changes (baby_id, changed_at desc);

alter table public.diaper_changes enable row level security;
revoke all on public.diaper_changes from anon, authenticated;
grant select, delete on public.diaper_changes to authenticated;
grant insert (baby_id, type, changed_at), update (type, changed_at)
  on public.diaper_changes to authenticated;

create policy diaper_changes_read on public.diaper_changes
  for select to authenticated using (private.can_access_baby(baby_id));

create policy diaper_changes_insert on public.diaper_changes
  for insert to authenticated
  with check (private.has_baby_role(baby_id, array['owner', 'parent', 'caregiver']));

create policy diaper_changes_update on public.diaper_changes
  for update to authenticated
  using (private.has_baby_role(baby_id, array['owner', 'parent', 'caregiver']))
  with check (private.has_baby_role(baby_id, array['owner', 'parent', 'caregiver']));

create policy diaper_changes_delete on public.diaper_changes
  for delete to authenticated
  using (private.has_baby_role(baby_id, array['owner', 'parent', 'caregiver']));
