-- Permisos del modo espectador. Solo Supabase.
revoke execute on function ss_set_spectator(jsonb) from public, anon, authenticated;
grant execute on function ss_set_spectator(jsonb) to service_role;
revoke execute on function ss_get_state_pre_spectator(jsonb) from public, anon, authenticated;
grant execute on function ss_get_state_pre_spectator(jsonb) to service_role;
revoke execute on function ss_get_state(jsonb) from public, anon, authenticated;
grant execute on function ss_get_state(jsonb) to service_role;
