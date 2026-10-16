-- Permisos de las funciones del modo móviles. Sólo Supabase (roles anon/authenticated/service_role).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
