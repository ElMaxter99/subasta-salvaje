-- Permisos tras el endurecimiento. Sólo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
