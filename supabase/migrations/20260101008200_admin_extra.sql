-- Administración y contenido: moderación de la biblioteca (campo `reviewed`, filtros, duplicados), edición en bloque de productos,
-- plantilla del sistema creada desde una colección, vínculo partida↔plantilla del sistema y estadísticas de solo lectura.

-- ---------------------------------------------------------------------------
-- Moderación de imágenes de la biblioteca
-- ---------------------------------------------------------------------------
alter table library_images add column reviewed boolean not null default false;

create or replace function ss_library_image_json(i library_images) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', i.id, 'url', i.url, 'path', i.path, 'title', i.title, 'collection', i.collection, 'tags', to_jsonb(i.tags),
    'credit', i.credit, 'width', i.width, 'height', i.height, 'bytes', i.bytes, 'created_at', i.created_at, 'reviewed', i.reviewed)
$$;

-- Igual que antes + filtros `no_credit` (sin crédito) y `unreviewed` (sin revisar).
create or replace function ss_admin_library_image_list(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := lower(btrim(coalesce(p->>'q', '')));
  v_col text := p->>'collection';
  v_nocredit boolean := coalesce((p->>'no_credit')::boolean, false);
  v_unrev boolean := coalesce((p->>'unreviewed')::boolean, false);
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 60), 1), 200);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total int; v_images jsonb;
begin
  select count(*) into v_total from library_images i
   where (v_col is null or i.collection = v_col)
     and (not v_nocredit or btrim(i.credit) = '')
     and (not v_unrev or not i.reviewed)
     and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%' or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'));
  select coalesce(jsonb_agg(ss_library_image_json(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_images from (
    select * from library_images i
     where (v_col is null or i.collection = v_col)
       and (not v_nocredit or btrim(i.credit) = '')
       and (not v_unrev or not i.reviewed)
       and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%' or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'))
     order by i.created_at desc, i.id limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'images', v_images,
    'collections', coalesce((select jsonb_agg(jsonb_build_object('name', c.collection, 'count', c.n) order by c.collection)
                              from (select collection, count(*) n from library_images group by collection) c), '[]'::jsonb),
    'counts', jsonb_build_object('no_credit', (select count(*) from library_images where btrim(credit) = ''),
                                 'unreviewed', (select count(*) from library_images where not reviewed)));
end $$;

-- Igual que antes + `reviewed` (boolean) en el parche.
create or replace function ss_admin_library_image_update(p jsonb) returns jsonb language plpgsql as $$
declare v_ids uuid[]; v_n int; v_patch jsonb := coalesce(p->'patch', '{}'::jsonb);
begin
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then perform ss_err('invalid_input'); end if;
  if v_patch ? 'reviewed' and jsonb_typeof(v_patch->'reviewed') <> 'boolean' then perform ss_err('invalid_input'); end if;
  update library_images set
    title = case when v_patch ? 'title' then left(btrim(coalesce(v_patch->>'title', '')), 120) else title end,
    collection = case when v_patch ? 'collection' then left(btrim(coalesce(v_patch->>'collection', '')), 60) else collection end,
    tags = case when v_patch ? 'tags' then ss_library_text_array(v_patch->'tags') else tags end,
    credit = case when v_patch ? 'credit' then left(btrim(coalesce(v_patch->>'credit', '')), 200) else credit end,
    reviewed = case when v_patch ? 'reviewed' then (v_patch->>'reviewed')::boolean else reviewed end
   where id = any(v_ids);
  get diagnostics v_n = row_count;
  perform ss_audit(p->>'actor', 'library_images_updated', 'library', 'images', jsonb_build_object('count', v_n, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_patch) k)));
  return jsonb_build_object('updated', v_n);
end $$;

-- Posibles duplicados: imágenes con el mismo título (sin distinguir mayúsculas ni espacios) dentro de la misma colección.
-- No es una comparación de contenido (el contenido idéntico ya lo evita el hash al subir).
create or replace function ss_admin_library_duplicates(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(g order by g->>'collection', g->>'title'), '[]'::jsonb) from (
    select jsonb_build_object('collection', i.collection, 'title', min(i.title), 'images',
             jsonb_agg(ss_library_image_json(i) order by i.created_at, i.id)) as g
      from library_images i
     where btrim(i.title) <> ''
     group by i.collection, lower(btrim(i.title))
    having count(*) > 1
     order by i.collection, lower(btrim(i.title))
     limit least(greatest(coalesce((p->>'limit')::int, 50), 1), 200)
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Edición en bloque de productos del catálogo (transaccional: todo o nada) con una sola entrada de auditoría.
-- p.change: {"collection": "…"} | {"emoji": "🎃" | null} | {"image_id": null} | {"delete": true}
-- Al mover de colección, los que chocarían con un producto del mismo nombre en el destino se omiten y se cuentan.
-- ---------------------------------------------------------------------------
create or replace function ss_admin_library_item_update_many(p jsonb) returns jsonb language plpgsql as $$
declare
  v_ids uuid[]; v_ch jsonb := coalesce(p->'change', '{}'::jsonb); v_n int := 0; v_skipped int := 0; v_id uuid; v_kind text;
begin
  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 200 then perform ss_err('invalid_input'); end if;
  if (select count(*) from jsonb_object_keys(v_ch)) <> 1 then perform ss_err('invalid_input'); end if;
  v_kind := (select k from jsonb_object_keys(v_ch) k);
  if v_kind = 'collection' then
    if jsonb_typeof(v_ch->'collection') <> 'string' then perform ss_err('invalid_input'); end if;
    for v_id in select id from library_items where id = any(v_ids) order by id loop
      begin
        update library_items set collection = left(btrim(v_ch->>'collection'), 60), updated_at = now() where id = v_id;
        v_n := v_n + 1;
      exception when unique_violation then v_skipped := v_skipped + 1;
      end;
    end loop;
  elsif v_kind = 'emoji' then
    if jsonb_typeof(v_ch->'emoji') not in ('string', 'null') or char_length(coalesce(v_ch->>'emoji', '')) > 8 then perform ss_err('invalid_input'); end if;
    update library_items set emoji = nullif(btrim(coalesce(v_ch->>'emoji', '')), ''), updated_at = now() where id = any(v_ids);
    get diagnostics v_n = row_count;
  elsif v_kind = 'image_id' then
    if jsonb_typeof(v_ch->'image_id') <> 'null' then perform ss_err('invalid_input'); end if; -- solo se admite QUITAR la foto
    update library_items set image_id = null, updated_at = now() where id = any(v_ids);
    get diagnostics v_n = row_count;
  elsif v_kind = 'delete' then
    if v_ch->'delete' <> 'true'::jsonb then perform ss_err('invalid_input'); end if;
    delete from library_items where id = any(v_ids);
    get diagnostics v_n = row_count;
  else
    perform ss_err('invalid_input');
  end if;
  perform ss_audit(p->>'actor', 'library_items_bulk_updated', 'library', 'items',
    jsonb_build_object('action', v_kind, 'requested', cardinality(v_ids), 'changed', v_n, 'skipped', v_skipped,
                       'value', case when v_kind in ('collection', 'emoji') then v_ch->v_kind else null end));
  return jsonb_build_object('changed', v_n, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- Plantilla del sistema desde una colección: devuelve el contenido (formato subasta-salvaje/plantilla@1) y un slug libre.
-- Solo lee: el servidor lo valida con Zod y lo guarda como BORRADOR con ss_admin_system_template_upsert. No copia imágenes (enlaces).
-- p: {collection, house_image_id?, cover_item_id?}
-- ---------------------------------------------------------------------------
create or replace function ss_slugify(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(translate(lower(coalesce(t, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9]+', '-', 'g'), '-')
$$;

create or replace function ss_admin_collection_template(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_col text := btrim(coalesce(p->>'collection', ''));
  v_total int; v_cover text; v_house text; v_slug text; v_base text; v_n int := 1; v_items jsonb; v_credits text;
  v_cover_id uuid := nullif(p->>'cover_item_id', '')::uuid;
  v_house_id uuid := nullif(p->>'house_image_id', '')::uuid;
begin
  if v_col = '' then perform ss_err('invalid_input'); end if;
  select count(*) into v_total from library_items where collection = v_col;
  if v_total = 0 then perform ss_err('library_not_found'); end if;
  if v_house_id is not null then
    select url into v_house from library_images where id = v_house_id;
    if v_house is null then perform ss_err('library_not_found'); end if;
  end if;
  -- Catálogo: hasta 100 productos (el máximo de una plantilla), por nombre.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('titulo', x.name, 'descripcion', x.description, 'emoji', x.emoji, 'foto', x.url, 'credito', nullif(left(x.icredit, 120), ''))) order by lower(x.name)), '[]'::jsonb)
    into v_items from (
      select it.name, it.description, it.emoji, i.url, i.credit as icredit from library_items it left join library_images i on i.id = it.image_id
       where it.collection = v_col order by lower(it.name) limit 100) x;
  -- Portada: la foto del producto elegido o, si no, la del primero (por nombre) que tenga foto.
  if v_cover_id is not null then
    select i.url into v_cover from library_items it join library_images i on i.id = it.image_id where it.id = v_cover_id and it.collection = v_col;
    if v_cover is null then perform ss_err('invalid_input'); end if;
  else
    select i.url into v_cover from library_items it join library_images i on i.id = it.image_id where it.collection = v_col order by lower(it.name) limit 1;
  end if;
  select left(string_agg(distinct nullif(btrim(i.credit), ''), ' · '), 200) into v_credits
    from library_items it join library_images i on i.id = it.image_id where it.collection = v_col;
  v_base := left(coalesce(nullif(ss_slugify(v_col), ''), 'coleccion'), 54);
  v_slug := v_base;
  while exists (select 1 from system_templates where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  if char_length(v_slug) < 2 then v_slug := v_slug || '-1'; end if;
  return jsonb_build_object('slug', v_slug, 'title', left(v_col, 80), 'truncated', v_total > 100, 'total', v_total,
    'data', jsonb_strip_nulls(jsonb_build_object('formato', 'subasta-salvaje/plantilla@1', 'nombre', left(v_col, 80), 'tematica', left(v_col, 120),
      'portada', v_cover, 'casa_inicial', v_house, 'creditos', v_credits, 'catalogo', v_items)));
end $$;

-- ---------------------------------------------------------------------------
-- Vínculo partida ↔ plantilla del sistema (para las estadísticas). Es informativo: nunca bloquea crear la partida.
-- ---------------------------------------------------------------------------
alter table games add column template_slug text check (template_slug is null or template_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create index games_template_slug_idx on games (template_slug) where template_slug is not null;

create or replace function ss_set_game_template(p jsonb) returns jsonb language plpgsql as $$
declare v_slug text := lower(btrim(coalesce(p->>'template_slug', ''))); v_n int;
begin
  -- Solo si la plantilla existe y está publicada, y solo la persona anfitriona de la partida.
  if not exists (select 1 from system_templates where slug = v_slug and status = 'published') then return jsonb_build_object('linked', false); end if;
  update games set template_slug = v_slug where room_code = upper(coalesce(p->>'room_code', '')) and host_id = (p->>'host_id')::uuid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('linked', v_n > 0);
end $$;

-- ---------------------------------------------------------------------------
-- Estadísticas (solo lectura). Los días son UTC. Las partidas caducadas se purgan, así que solo cuentan las que aún existen.
-- ---------------------------------------------------------------------------
create or replace function ss_admin_stats_games(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'per_day', (select jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'count', coalesce(c.n, 0)) order by d)
                  from generate_series(((now() at time zone 'utc')::date - 29), (now() at time zone 'utc')::date, interval '1 day') d
                  left join (select (created_at at time zone 'utc')::date as day, count(*)::int n from games group by 1) c on c.day = d::date),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*)::int n from games group by status) s),
    'total', (select count(*) from games))
$$;

create or replace function ss_admin_stats_templates(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'games', t.n, 'last_at', t.last_at) order by t.n desc, t.title), '[]'::jsonb) from (
    select g.template_slug as slug, coalesce(max(st.title), g.template_slug) as title, count(*)::int n, max(g.created_at) as last_at
      from games g left join system_templates st on st.slug = g.template_slug
     where g.template_slug is not null group by g.template_slug order by count(*) desc, g.template_slug limit 20) t
$$;

-- IA: versiones de imagen generadas (se excluyen las subidas a mano) por proveedor y día; trabajos por estado; reservas de cuota de hoy.
create or replace function ss_admin_stats_ai(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'per_day', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'provider', provider, 'ok', ok, 'failed', failed) order by day, provider), '[]'::jsonb) from (
        select (created_at at time zone 'utc')::date as day, provider,
               count(*) filter (where generation_status = 'completed')::int as ok, count(*) filter (where generation_status = 'failed')::int as failed
          from image_versions
         where origin <> 'uploaded' and (created_at at time zone 'utc')::date >= (now() at time zone 'utc')::date - 13
         group by 1, 2) a),
    'by_provider', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'ok', ok, 'failed', failed) order by ok + failed desc, provider), '[]'::jsonb) from (
        select provider, count(*) filter (where generation_status = 'completed')::int as ok, count(*) filter (where generation_status = 'failed')::int as failed
          from image_versions
         where origin <> 'uploaded' and (created_at at time zone 'utc')::date >= (now() at time zone 'utc')::date - 13
         group by provider) b),
    'jobs', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*)::int n from image_jobs group by status) j),
    'usage_today', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
        select provider, count(*)::int n from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date group by provider) u),
    'usage_today_total', (select count(*)::int from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date))
$$;
