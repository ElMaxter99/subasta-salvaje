-- Permisos tras la imagen base compartida. Sólo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
