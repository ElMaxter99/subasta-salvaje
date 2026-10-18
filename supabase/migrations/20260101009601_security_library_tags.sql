-- Permisos de las funciones de la biblioteca (roles, categoría, selector, huella, cobertura). Solo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
