-- Permisos de ss_gallery_vote tras reemplazarla. Solo Supabase.
revoke execute on function ss_gallery_vote(jsonb) from public, anon, authenticated;
grant execute on function ss_gallery_vote(jsonb) to service_role;
