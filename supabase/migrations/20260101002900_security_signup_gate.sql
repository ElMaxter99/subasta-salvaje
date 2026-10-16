-- Permisos de ss_signup_allowed. Solo Supabase.
revoke execute on function ss_signup_allowed(jsonb) from public, anon, authenticated;
grant execute on function ss_signup_allowed(jsonb) to service_role;
