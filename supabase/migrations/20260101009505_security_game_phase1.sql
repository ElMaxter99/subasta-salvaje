-- Permisos de «volver a pujar», pausa de gracia y premios ampliados. Solo Supabase (solo funciones y columnas, sin tablas nuevas).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
