-- Permisos de ss_apply_settings y del nuevo ss_item_op. Solo Supabase (sin tablas nuevas).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
