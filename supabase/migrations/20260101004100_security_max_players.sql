-- Permisos del máximo de jugadores. Solo Supabase.
revoke execute on function ss_max_players_cap(), ss_get_state_pre_maxplayers(jsonb), ss_get_state(jsonb) from public, anon, authenticated;
grant execute on function ss_max_players_cap(), ss_get_state_pre_maxplayers(jsonb), ss_get_state(jsonb) to service_role;
