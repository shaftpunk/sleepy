alter table public.diaper_changes
  drop constraint diaper_changes_type_check,
  add constraint diaper_changes_type_check check (type in ('wet', 'dirty', 'both', 'dry'));
