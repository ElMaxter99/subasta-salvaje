-- Permisos de las reglas extra (relámpago, sobre cerrado, presupuesto individual, equipos). Solo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
