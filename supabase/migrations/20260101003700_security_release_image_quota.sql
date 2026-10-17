-- Permisos de ss_release_image_quota. Solo Supabase.
revoke execute on function ss_release_image_quota(jsonb) from public, anon, authenticated;
grant execute on function ss_release_image_quota(jsonb) to service_role;
