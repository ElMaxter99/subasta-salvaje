-- Permisos de las plantillas guardadas. Solo Supabase.
revoke all on table host_templates from anon, authenticated;
alter table host_templates enable row level security;
create policy deny_all_host_templates on host_templates for all to anon, authenticated using (false) with check (false);
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
