-- Permisos del sonido. Solo Supabase.
revoke execute on function ss_set_sound(jsonb) from public, anon, authenticated;
grant execute on function ss_set_sound(jsonb) to service_role;
revoke execute on function ss_get_state_prev2(jsonb) from public, anon, authenticated;
grant execute on function ss_get_state_prev2(jsonb) to service_role;
