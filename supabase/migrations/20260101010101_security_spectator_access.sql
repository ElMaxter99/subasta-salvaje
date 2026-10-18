-- Permisos del control de acceso del espectador. Solo Supabase (sin tablas nuevas; la columna ya hereda la RLS deny-all de `games`).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
