-- Permisos y RLS de la observabilidad. Solo Supabase (en PGlite no se ejecuta).
revoke all on table app_errors, app_error_hourly, usage_metrics from anon, authenticated;
alter table app_errors enable row level security;
alter table app_error_hourly enable row level security;
alter table usage_metrics enable row level security;
create policy deny_all_app_errors on app_errors for all to anon, authenticated using (false) with check (false);
create policy deny_all_app_error_hourly on app_error_hourly for all to anon, authenticated using (false) with check (false);
create policy deny_all_usage_metrics on usage_metrics for all to anon, authenticated using (false) with check (false);

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
