-- Permisos tras el panel de superadmin. Sólo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
revoke all on table app_settings, host_profiles, host_invites, admin_audit from anon, authenticated;
alter table app_settings enable row level security;
alter table host_profiles enable row level security;
alter table host_invites enable row level security;
alter table admin_audit enable row level security;
create policy deny_all_app_settings on app_settings for all to anon, authenticated using (false) with check (false);
create policy deny_all_host_profiles on host_profiles for all to anon, authenticated using (false) with check (false);
create policy deny_all_host_invites on host_invites for all to anon, authenticated using (false) with check (false);
create policy deny_all_admin_audit on admin_audit for all to anon, authenticated using (false) with check (false);
