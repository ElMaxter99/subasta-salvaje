-- Permisos de las funciones de la fase 2 de proveedores de IA. Solo Supabase.
revoke execute on function ss_provider_usage(jsonb), ss_set_usage_provider(jsonb) from public, anon, authenticated;
grant execute on function ss_provider_usage(jsonb), ss_set_usage_provider(jsonb) to service_role;
-- ss_settings_get / ss_settings_set conservan sus permisos (create or replace); se repiten por si la base se creó en otro orden.
revoke execute on function ss_settings_get(jsonb), ss_settings_set(jsonb) from public, anon, authenticated;
grant execute on function ss_settings_get(jsonb), ss_settings_set(jsonb) to service_role;
