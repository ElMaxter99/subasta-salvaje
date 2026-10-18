-- Permisos de las funciones de administración extra (moderación, edición en bloque, plantilla desde colección, estadísticas). Solo Supabase.
-- `games.template_slug` y `library_images.reviewed` son columnas de tablas ya cerradas (RLS deny-all).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
