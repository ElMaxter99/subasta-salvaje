-- La tarjeta de «Partidas del sistema» muestra los créditos (autoría/fuente) de las imágenes de la plantilla, si los tiene.
create or replace function ss_system_template_summary(t system_templates) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'title', t.title, 'description', t.description, 'cover_url', t.cover_url,
    'status', t.status, 'sort_order', t.sort_order, 'updated_at', t.updated_at, 'published_at', t.published_at,
    'items', coalesce(jsonb_array_length(t.data->'catalogo'), 0),
    'players', coalesce(jsonb_array_length(t.data->'jugadores'), 0),
    'has_initial_image', coalesce(nullif(t.data->>'casa_inicial', ''), '') <> '',
    'credits', nullif(t.data->>'creditos', ''))
$$;
