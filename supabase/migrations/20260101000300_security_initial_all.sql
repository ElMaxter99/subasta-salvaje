-- Permisos de la función nueva y bucket con SVG (proveedor de muestra / galería). Sólo Supabase.
revoke execute on function ss_set_initial_all(jsonb) from public, anon, authenticated;
grant execute on function ss_set_initial_all(jsonb) to service_role;

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
where id = 'game-images';
