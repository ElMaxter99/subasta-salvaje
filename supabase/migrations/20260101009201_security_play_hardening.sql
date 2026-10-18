-- Permisos de 20260101009200_play_hardening.sql. Solo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
