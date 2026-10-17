-- Permisos de ss_admin_audit_event. Solo Supabase.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
