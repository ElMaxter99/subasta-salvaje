-- Biblioteca de medios del superadmin: imágenes generales (paisajes, objetos divertidos…) subidas en bloque al repositorio público
-- de fotos (GitHub + jsDelivr) y catálogo general de productos reutilizable al configurar partidas.
-- Aquí solo viven los METADATOS y los enlaces: los archivos están en GitHub (nunca en Supabase Storage).
-- Las imágenes se identifican por el hash de su contenido: la misma foto no se registra dos veces.

create table library_images (
  id          uuid primary key default gen_random_uuid(),
  hash        text not null unique check (hash ~ '^[0-9a-f]{12,64}$'),
  path        text not null unique check (char_length(path) between 3 and 240),
  url         text not null check (url ~ '^https://' and char_length(url) <= 500),
  sha         text,
  title       text not null default '' check (char_length(title) <= 120),
  collection  text not null default '' check (char_length(collection) <= 60),
  tags        text[] not null default '{}' check (cardinality(tags) <= 20),
  credit      text not null default '' check (char_length(credit) <= 200),
  width       integer,
  height      integer,
  bytes       integer,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index library_images_collection_idx on library_images (collection, created_at desc);

create table library_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  emoji       text check (emoji is null or char_length(emoji) <= 8),
  image_id    uuid references library_images(id) on delete set null,
  collection  text not null default '' check (char_length(collection) <= 60),
  tags        text[] not null default '{}' check (cardinality(tags) <= 20),
  credit      text not null default '' check (char_length(credit) <= 120),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index library_items_unique_idx on library_items (lower(collection), lower(btrim(name)));
create index library_items_collection_idx on library_items (collection, name);

create or replace function ss_library_text_array(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array(
    select distinct left(lower(btrim(x)), 30) from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) x
    where btrim(x) <> '' limit 20), '{}')
$$;

create or replace function ss_library_image_json(i library_images) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', i.id, 'url', i.url, 'path', i.path, 'title', i.title, 'collection', i.collection, 'tags', to_jsonb(i.tags),
    'credit', i.credit, 'width', i.width, 'height', i.height, 'bytes', i.bytes, 'created_at', i.created_at)
$$;

-- Alta idempotente por hash: si la imagen ya está registrada se devuelve la existente (existed = true) sin tocarla.
create or replace function ss_admin_library_image_add(p jsonb) returns jsonb language plpgsql as $$
declare i library_images; v_hash text := lower(coalesce(p->>'hash', ''));
begin
  select * into i from library_images where hash = v_hash;
  if i.id is not null then
    return jsonb_build_object('existed', true, 'image', ss_library_image_json(i));
  end if;
  insert into library_images (hash, path, url, sha, title, collection, tags, credit, width, height, bytes, created_by)
  values (v_hash, p->>'path', p->>'url', p->>'sha', left(btrim(coalesce(p->>'title', '')), 120), left(btrim(coalesce(p->>'collection', '')), 60),
          ss_library_text_array(p->'tags'), left(btrim(coalesce(p->>'credit', '')), 200),
          nullif(p->>'width', '')::int, nullif(p->>'height', '')::int, nullif(p->>'bytes', '')::int, p->>'actor')
  returning * into i;
  return jsonb_build_object('existed', false, 'image', ss_library_image_json(i));
end $$;

-- Listado con filtros (texto en título/etiquetas/colección, colección exacta) y paginación; devuelve también las colecciones.
create or replace function ss_admin_library_image_list(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := lower(btrim(coalesce(p->>'q', '')));
  v_col text := p->>'collection';
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 60), 1), 200);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total int; v_images jsonb;
begin
  select count(*) into v_total from library_images i
   where (v_col is null or i.collection = v_col)
     and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%' or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'));
  select coalesce(jsonb_agg(ss_library_image_json(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_images from (
    select * from library_images i
     where (v_col is null or i.collection = v_col)
       and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%' or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'))
     order by i.created_at desc, i.id limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'images', v_images,
    'collections', coalesce((select jsonb_agg(jsonb_build_object('name', c.collection, 'count', c.n) order by c.collection)
                              from (select collection, count(*) n from library_images group by collection) c), '[]'::jsonb));
end $$;

-- Cambia título, colección, etiquetas o crédito de varias imágenes a la vez (solo los campos presentes en p.patch).
create or replace function ss_admin_library_image_update(p jsonb) returns jsonb language plpgsql as $$
declare v_ids uuid[]; v_n int; v_patch jsonb := coalesce(p->'patch', '{}'::jsonb);
begin
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then perform ss_err('invalid_input'); end if;
  update library_images set
    title = case when v_patch ? 'title' then left(btrim(coalesce(v_patch->>'title', '')), 120) else title end,
    collection = case when v_patch ? 'collection' then left(btrim(coalesce(v_patch->>'collection', '')), 60) else collection end,
    tags = case when v_patch ? 'tags' then ss_library_text_array(v_patch->'tags') else tags end,
    credit = case when v_patch ? 'credit' then left(btrim(coalesce(v_patch->>'credit', '')), 200) else credit end
   where id = any(v_ids);
  get diagnostics v_n = row_count;
  perform ss_audit(p->>'actor', 'library_images_updated', 'library', 'images', jsonb_build_object('count', v_n, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_patch) k)));
  return jsonb_build_object('updated', v_n);
end $$;

-- Borra los registros (el archivo permanece en el repositorio de fotos: no se borra de GitHub). Los productos que la usaban
-- se quedan sin foto.
create or replace function ss_admin_library_image_delete(p jsonb) returns jsonb language plpgsql as $$
declare v_ids uuid[]; v_n int;
begin
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then perform ss_err('invalid_input'); end if;
  delete from library_images where id = any(v_ids);
  get diagnostics v_n = row_count;
  perform ss_audit(p->>'actor', 'library_images_deleted', 'library', 'images', jsonb_build_object('count', v_n));
  return jsonb_build_object('deleted', v_n);
end $$;

create or replace function ss_library_item_json(it library_items) returns jsonb language sql stable as $$
  select jsonb_build_object('id', it.id, 'name', it.name, 'description', it.description, 'emoji', it.emoji, 'collection', it.collection,
    'tags', to_jsonb(it.tags), 'credit', it.credit, 'image_id', it.image_id,
    'photo_url', (select i.url from library_images i where i.id = it.image_id),
    'photo_credit', (select i.credit from library_images i where i.id = it.image_id), 'updated_at', it.updated_at)
$$;

-- Alta en bloque de productos (máx. 500). Los repetidos (misma colección y nombre) se omiten y se cuentan.
create or replace function ss_admin_library_item_add_many(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb; v_added int := 0; v_skipped int := 0; v_ids uuid[] := '{}'; v_id uuid;
begin
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 500 then perform ss_err('invalid_input'); end if;
  for r in select * from jsonb_array_elements(p->'items') loop
    insert into library_items (name, description, emoji, image_id, collection, tags, credit, created_by)
    values (btrim(r->>'name'), left(btrim(coalesce(r->>'description', '')), 500), nullif(btrim(coalesce(r->>'emoji', '')), ''),
            (select i.id from library_images i where i.id = nullif(r->>'image_id', '')::uuid),
            left(btrim(coalesce(r->>'collection', '')), 60), ss_library_text_array(r->'tags'), left(btrim(coalesce(r->>'credit', '')), 120), p->>'actor')
    on conflict (lower(collection), lower(btrim(name))) do nothing
    returning id into v_id;
    if v_id is null then v_skipped := v_skipped + 1; else v_added := v_added + 1; v_ids := v_ids || v_id; end if;
    v_id := null;
  end loop;
  perform ss_audit(p->>'actor', 'library_items_added', 'library', 'items', jsonb_build_object('added', v_added, 'skipped', v_skipped));
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'ids', to_jsonb(v_ids));
end $$;

create or replace function ss_admin_library_item_update(p jsonb) returns jsonb language plpgsql as $$
declare it library_items; v_patch jsonb := coalesce(p->'patch', '{}'::jsonb);
begin
  update library_items set
    name = case when v_patch ? 'name' then btrim(v_patch->>'name') else name end,
    description = case when v_patch ? 'description' then left(btrim(coalesce(v_patch->>'description', '')), 500) else description end,
    emoji = case when v_patch ? 'emoji' then nullif(btrim(coalesce(v_patch->>'emoji', '')), '') else emoji end,
    image_id = case when v_patch ? 'image_id' then (select i.id from library_images i where i.id = nullif(v_patch->>'image_id', '')::uuid) else image_id end,
    collection = case when v_patch ? 'collection' then left(btrim(coalesce(v_patch->>'collection', '')), 60) else collection end,
    tags = case when v_patch ? 'tags' then ss_library_text_array(v_patch->'tags') else tags end,
    credit = case when v_patch ? 'credit' then left(btrim(coalesce(v_patch->>'credit', '')), 120) else credit end,
    updated_at = now()
   where id = (p->>'id')::uuid returning * into it;
  if it.id is null then perform ss_err('library_not_found'); end if;
  perform ss_audit(p->>'actor', 'library_item_updated', 'library', it.id::text, jsonb_build_object('name', it.name));
  return ss_library_item_json(it);
end $$;

create or replace function ss_admin_library_item_delete(p jsonb) returns jsonb language plpgsql as $$
declare v_ids uuid[]; v_n int;
begin
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then perform ss_err('invalid_input'); end if;
  delete from library_items where id = any(v_ids);
  get diagnostics v_n = row_count;
  perform ss_audit(p->>'actor', 'library_items_deleted', 'library', 'items', jsonb_build_object('count', v_n));
  return jsonb_build_object('deleted', v_n);
end $$;

-- Lectura del catálogo general (la usan el superadmin y los anfitriones al configurar una partida).
create or replace function ss_library_item_list(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := lower(btrim(coalesce(p->>'q', '')));
  v_col text := p->>'collection';
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 500);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total int; v_items jsonb;
begin
  select count(*) into v_total from library_items it
   where (v_col is null or it.collection = v_col)
     and (v_q = '' or lower(it.name) like '%' || v_q || '%' or lower(it.description) like '%' || v_q || '%' or exists (select 1 from unnest(it.tags) t where t like '%' || v_q || '%'));
  select coalesce(jsonb_agg(ss_library_item_json(x) order by x.collection, lower(x.name)), '[]'::jsonb) into v_items from (
    select * from library_items it
     where (v_col is null or it.collection = v_col)
       and (v_q = '' or lower(it.name) like '%' || v_q || '%' or lower(it.description) like '%' || v_q || '%' or exists (select 1 from unnest(it.tags) t where t like '%' || v_q || '%'))
     order by it.collection, lower(it.name) limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'items', v_items,
    'collections', coalesce((select jsonb_agg(jsonb_build_object('name', c.collection, 'count', c.n) order by c.collection)
                              from (select collection, count(*) n from library_items group by collection) c), '[]'::jsonb));
end $$;

-- Consulta por hash (evita llamar a GitHub si la imagen ya está registrada).
create or replace function ss_admin_library_image_by_hash(p jsonb) returns jsonb language sql stable as $$
  select (select ss_library_image_json(i) from library_images i where i.hash = lower(coalesce(p->>'hash', '')))
$$;
