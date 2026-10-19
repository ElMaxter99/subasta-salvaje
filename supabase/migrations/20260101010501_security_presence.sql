-- Permisos de la presencia y los retirados. Solo Supabase (PGlite no ejecuta archivos «_security_»).
revoke execute on function ss_presence_window() from public, anon, authenticated;
grant execute on function ss_presence_window() to service_role;
revoke execute on function ss_players_presence_claim() from public, anon, authenticated;
grant execute on function ss_players_presence_claim() to service_role;
revoke execute on function ss_unretire_on_reset() from public, anon, authenticated;
grant execute on function ss_unretire_on_reset() to service_role;
revoke execute on function ss_player_ping(jsonb) from public, anon, authenticated;
grant execute on function ss_player_ping(jsonb) to service_role;
revoke execute on function ss_presence_sweep(jsonb) from public, anon, authenticated;
grant execute on function ss_presence_sweep(jsonb) to service_role;
revoke execute on function ss_player_retire(jsonb) from public, anon, authenticated;
grant execute on function ss_player_retire(jsonb) to service_role;
revoke execute on function ss_player_unretire(jsonb) from public, anon, authenticated;
grant execute on function ss_player_unretire(jsonb) to service_role;
revoke execute on function ss_assert_not_retired(jsonb) from public, anon, authenticated;
grant execute on function ss_assert_not_retired(jsonb) to service_role;
revoke execute on function ss_player_bid_pre_retire(jsonb) from public, anon, authenticated;
grant execute on function ss_player_bid_pre_retire(jsonb) to service_role;
revoke execute on function ss_yield_bid_pre_retire(jsonb) from public, anon, authenticated;
grant execute on function ss_yield_bid_pre_retire(jsonb) to service_role;
revoke execute on function ss_unyield_bid_pre_retire(jsonb) from public, anon, authenticated;
grant execute on function ss_unyield_bid_pre_retire(jsonb) to service_role;
revoke execute on function ss_send_reaction_pre_retire(jsonb) from public, anon, authenticated;
grant execute on function ss_send_reaction_pre_retire(jsonb) to service_role;
revoke execute on function ss_get_state_pre_presence(jsonb) from public, anon, authenticated;
grant execute on function ss_get_state_pre_presence(jsonb) to service_role;
-- Los envoltorios nuevos (ss_player_bid, ss_yield_bid, ss_unyield_bid, ss_send_reaction, ss_get_state) son funciones NUEVAS: se les dan permisos.
-- (ss_bid_internal, ss_yield_pending y ss_all_broke se redefinen con create or replace y conservan los suyos.)
revoke execute on function ss_player_bid(jsonb) from public, anon, authenticated;
grant execute on function ss_player_bid(jsonb) to service_role;
revoke execute on function ss_yield_bid(jsonb) from public, anon, authenticated;
grant execute on function ss_yield_bid(jsonb) to service_role;
revoke execute on function ss_unyield_bid(jsonb) from public, anon, authenticated;
grant execute on function ss_unyield_bid(jsonb) to service_role;
revoke execute on function ss_send_reaction(jsonb) from public, anon, authenticated;
grant execute on function ss_send_reaction(jsonb) to service_role;
revoke execute on function ss_get_state(jsonb) from public, anon, authenticated;
grant execute on function ss_get_state(jsonb) to service_role;
