-- Permisos de las plantillas del sistema. Solo Supabase.
revoke all on table system_templates from anon, authenticated;
alter table system_templates enable row level security;
create policy deny_all_system_templates on system_templates for all to anon, authenticated using (false) with check (false);
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
