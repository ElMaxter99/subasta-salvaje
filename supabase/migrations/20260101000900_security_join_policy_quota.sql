-- Permisos tras la política de altas y la cuota. Sólo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
revoke all on table image_usage from anon, authenticated;
alter table image_usage enable row level security;
create policy deny_all_image_usage on image_usage for all to anon, authenticated using (false) with check (false);
