-- Permisos de las funciones de la nota del proveedor. Solo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
