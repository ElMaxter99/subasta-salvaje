-- Permisos de ss_rounds_done y funciones redefinidas. Solo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
