-- Permisos de las estadísticas por jugador. Solo Supabase (solo funciones, sin tablas nuevas).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
