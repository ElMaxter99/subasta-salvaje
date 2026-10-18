-- Biblioteca de medios: roles (foto de inicio de partida / producto de catálogo), categoría, huella perceptual y selector para anfitriones.
--  · `roles`: conjunto de usos de la imagen. Valores admitidos hoy: 'start' (foto de inicio de partida / casa) y 'product' (producto de catálogo).
--    Para añadir un rol nuevo: ampliar el check de abajo (migración nueva) y LIBRARY_ROLES en src/lib/library/taxonomy.ts.
--  · `category`: temática (Halloween, Paisajes…), distinta de `collection` (la carpeta física en el repositorio de fotos).
--  · `phash`: huella perceptual (dHash de 64 bits en hex) para avisar de imágenes MUY PARECIDAS al subir; null en las anteriores.
-- Lo ya existente se migra con un valor razonable: categoría = colección; rol 'start' si mide más de 768 px de ancho (escena),
-- 'product' si es de objeto (≤ 768 px) o ya la usa un producto del catálogo.
-- El selector de los anfitriones solo ve imágenes con el rol pedido Y revisadas por el superadmin (`reviewed`).

alter table library_images
  add column roles    text[] not null default '{}',
  add column category text   not null default '' check (char_length(category) <= 60),
  add column phash    text   check (phash is null or phash ~ '^[0-9a-f]{16}$');
alter table library_images add constraint library_images_roles_check check (roles <@ array['start', 'product']::text[]);
create index library_images_roles_idx on library_images using gin (roles);
create index library_images_category_idx on library_images (lower(category));

update library_images set category = collection where category = '';
update library_images i set roles = array_remove(array[
    case when coalesce(i.width, 0) > 768 then 'start' end,
    case when coalesce(i.width, 0) <= 768 or exists (select 1 from library_items it where it.image_id = i.id) then 'product' end
  ], null);

-- ---------------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------------
-- Lista JSON de roles → text[] canónico (solo valores admitidos, sin repetidos, en el orden start, product).
create or replace function ss_library_roles_array(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array(
    select u.r from unnest(array['start', 'product']) with ordinality as u(r, o)
     where exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) x where lower(btrim(x)) = u.r)
     order by u.o
  ), '{}')
$$;

-- (actual ∪ añadir) − quitar, sin repetidos y ordenado, con tope.
create or replace function ss_library_array_merge(cur text[], add text[], rm text[], lim int) returns text[] language sql immutable as $$
  select coalesce(array(
    select t from (select distinct t from unnest(coalesce(cur, '{}') || coalesce(add, '{}')) t) s
     where t <> all (coalesce(rm, '{}')) order by t limit lim
  ), '{}')
$$;

create or replace function ss_library_image_json(i library_images) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', i.id, 'url', i.url, 'path', i.path, 'title', i.title, 'collection', i.collection, 'tags', to_jsonb(i.tags),
    'credit', i.credit, 'width', i.width, 'height', i.height, 'bytes', i.bytes, 'created_at', i.created_at, 'reviewed', i.reviewed,
    'roles', to_jsonb(i.roles), 'category', i.category, 'has_phash', i.phash is not null)
$$;

-- Versión PÚBLICA (la ven los anfitriones): nada de ruta interna, huella, revisión ni autor del alta.
create or replace function ss_library_image_pick_json(i library_images) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', i.id, 'url', i.url, 'title', i.title, 'collection', i.collection, 'category', i.category, 'tags', to_jsonb(i.tags),
    'roles', to_jsonb(i.roles), 'credit', i.credit, 'width', i.width, 'height', i.height)
$$;

-- ---------------------------------------------------------------------------
-- Alta: acepta roles, categoría y huella (todo opcional; sin roles se deduce del tamaño).
-- ---------------------------------------------------------------------------
create or replace function ss_admin_library_image_add(p jsonb) returns jsonb language plpgsql as $$
declare
  i library_images; v_hash text := lower(coalesce(p->>'hash', ''));
  v_roles text[]; v_phash text := lower(btrim(coalesce(p->>'phash', '')));
begin
  select * into i from library_images where hash = v_hash;
  if i.id is not null then
    -- Imagen repetida: si aún no tenía huella se aprovecha para guardarla; lo demás no se toca.
    if i.phash is null and v_phash ~ '^[0-9a-f]{16}$' then update library_images set phash = v_phash where id = i.id returning * into i; end if;
    return jsonb_build_object('existed', true, 'image', ss_library_image_json(i));
  end if;
  if p ? 'roles' then v_roles := ss_library_roles_array(p->'roles');
  else v_roles := case when coalesce(nullif(p->>'width', '')::int, 0) > 768 then array['start'] else array['product'] end; end if;
  insert into library_images (hash, path, url, sha, title, collection, tags, credit, width, height, bytes, created_by, roles, category, phash)
  values (v_hash, p->>'path', p->>'url', p->>'sha', left(btrim(coalesce(p->>'title', '')), 120), left(btrim(coalesce(p->>'collection', '')), 60),
          ss_library_text_array(p->'tags'), left(btrim(coalesce(p->>'credit', '')), 200),
          nullif(p->>'width', '')::int, nullif(p->>'height', '')::int, nullif(p->>'bytes', '')::int, p->>'actor',
          v_roles,
          case when p ? 'category' then left(btrim(coalesce(p->>'category', '')), 60) else left(btrim(coalesce(p->>'collection', '')), 60) end,
          case when v_phash ~ '^[0-9a-f]{16}$' then v_phash else null end)
  returning * into i;
  return jsonb_build_object('existed', false, 'image', ss_library_image_json(i));
end $$;

-- ---------------------------------------------------------------------------
-- Listado del superadmin: + filtros por rol ('start' | 'product' | 'none') y categoría, y recuentos por rol y categoría.
-- ---------------------------------------------------------------------------
create or replace function ss_admin_library_image_list(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := lower(btrim(coalesce(p->>'q', '')));
  v_col text := p->>'collection';
  v_cat text := nullif(lower(btrim(coalesce(p->>'category', ''))), '');
  v_role text := nullif(lower(btrim(coalesce(p->>'role', ''))), '');
  v_nocredit boolean := coalesce((p->>'no_credit')::boolean, false);
  v_unrev boolean := coalesce((p->>'unreviewed')::boolean, false);
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 60), 1), 200);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total int; v_images jsonb;
begin
  if v_role is not null and v_role not in ('start', 'product', 'none') then perform ss_err('invalid_input'); end if;
  select count(*) into v_total from library_images i
   where (v_col is null or i.collection = v_col)
     and (v_cat is null or lower(i.category) = v_cat)
     and (v_role is null or (v_role = 'none' and cardinality(i.roles) = 0) or (v_role <> 'none' and i.roles @> array[v_role]))
     and (not v_nocredit or btrim(i.credit) = '')
     and (not v_unrev or not i.reviewed)
     and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%' or lower(i.category) like '%' || v_q || '%'
          or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'));
  select coalesce(jsonb_agg(ss_library_image_json(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_images from (
    select * from library_images i
     where (v_col is null or i.collection = v_col)
       and (v_cat is null or lower(i.category) = v_cat)
       and (v_role is null or (v_role = 'none' and cardinality(i.roles) = 0) or (v_role <> 'none' and i.roles @> array[v_role]))
       and (not v_nocredit or btrim(i.credit) = '')
       and (not v_unrev or not i.reviewed)
       and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%' or lower(i.category) like '%' || v_q || '%'
            or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'))
     order by i.created_at desc, i.id limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'images', v_images,
    'collections', coalesce((select jsonb_agg(jsonb_build_object('name', c.collection, 'count', c.n) order by c.collection)
                              from (select collection, count(*) n from library_images group by collection) c), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'count', c.n) order by lower(c.name))
                             from (select min(category) name, count(*) n from library_images where btrim(category) <> '' group by lower(category)) c), '[]'::jsonb),
    'counts', jsonb_build_object('no_credit', (select count(*) from library_images where btrim(credit) = ''),
                                 'unreviewed', (select count(*) from library_images where not reviewed),
                                 'start', (select count(*) from library_images where roles @> array['start']),
                                 'product', (select count(*) from library_images where roles @> array['product']),
                                 'none', (select count(*) from library_images where cardinality(roles) = 0)));
end $$;

-- ---------------------------------------------------------------------------
-- Edición individual y en bloque: reemplazar (roles, tags, category) o ajustar sin pisar lo demás (roles_add/roles_remove, tags_add/tags_remove).
-- ---------------------------------------------------------------------------
create or replace function ss_admin_library_image_update(p jsonb) returns jsonb language plpgsql as $$
declare
  v_ids uuid[]; v_n int; v_patch jsonb := coalesce(p->'patch', '{}'::jsonb);
  v_tadd text[] := ss_library_text_array(v_patch->'tags_add'); v_trm text[] := ss_library_text_array(v_patch->'tags_remove');
  v_radd text[] := ss_library_roles_array(v_patch->'roles_add'); v_rrm text[] := ss_library_roles_array(v_patch->'roles_remove');
  v_k text;
begin
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then perform ss_err('invalid_input'); end if;
  if v_patch ? 'reviewed' and jsonb_typeof(v_patch->'reviewed') <> 'boolean' then perform ss_err('invalid_input'); end if;
  foreach v_k in array array['roles', 'tags', 'roles_add', 'roles_remove', 'tags_add', 'tags_remove'] loop
    if v_patch ? v_k and jsonb_typeof(v_patch->v_k) <> 'array' then perform ss_err('invalid_input'); end if;
  end loop;
  update library_images set
    title = case when v_patch ? 'title' then left(btrim(coalesce(v_patch->>'title', '')), 120) else title end,
    collection = case when v_patch ? 'collection' then left(btrim(coalesce(v_patch->>'collection', '')), 60) else collection end,
    category = case when v_patch ? 'category' then left(btrim(coalesce(v_patch->>'category', '')), 60) else category end,
    tags = case when v_patch ? 'tags' then ss_library_text_array(v_patch->'tags')
                when v_patch ? 'tags_add' or v_patch ? 'tags_remove' then ss_library_array_merge(tags, v_tadd, v_trm, 20)
                else tags end,
    roles = case when v_patch ? 'roles' then ss_library_roles_array(v_patch->'roles')
                 when v_patch ? 'roles_add' or v_patch ? 'roles_remove' then ss_library_roles_array(to_jsonb(ss_library_array_merge(roles, v_radd, v_rrm, 10)))
                 else roles end,
    credit = case when v_patch ? 'credit' then left(btrim(coalesce(v_patch->>'credit', '')), 200) else credit end,
    reviewed = case when v_patch ? 'reviewed' then (v_patch->>'reviewed')::boolean else reviewed end
   where id = any(v_ids);
  get diagnostics v_n = row_count;
  perform ss_audit(p->>'actor', 'library_images_updated', 'library', 'images', jsonb_build_object('count', v_n, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_patch) k)));
  return jsonb_build_object('updated', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Selector de los anfitriones (SOLO LECTURA): imágenes con el rol pedido y revisadas. Sin ruta interna ni datos de gestión.
-- ---------------------------------------------------------------------------
create or replace function ss_library_pick_list(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_role text := lower(btrim(coalesce(p->>'role', '')));
  v_q text := lower(btrim(coalesce(p->>'q', '')));
  v_cat text := nullif(lower(btrim(coalesce(p->>'category', ''))), '');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 24), 1), 60);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total int; v_images jsonb;
begin
  if v_role not in ('start', 'product') then perform ss_err('invalid_input'); end if;
  select count(*) into v_total from library_images i
   where i.reviewed and i.roles @> array[v_role]
     and (v_cat is null or lower(i.category) = v_cat)
     and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.category) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%'
          or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'));
  select coalesce(jsonb_agg(ss_library_image_pick_json(x) order by lower(x.category), lower(x.title), x.id), '[]'::jsonb) into v_images from (
    select * from library_images i
     where i.reviewed and i.roles @> array[v_role]
       and (v_cat is null or lower(i.category) = v_cat)
       and (v_q = '' or lower(i.title) like '%' || v_q || '%' or lower(i.category) like '%' || v_q || '%' or lower(i.collection) like '%' || v_q || '%'
            or exists (select 1 from unnest(i.tags) t where t like '%' || v_q || '%'))
     order by lower(i.category), lower(i.title), i.id limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'images', v_images,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'count', c.n) order by lower(c.name))
                             from (select min(category) name, count(*) n from library_images
                                    where reviewed and roles @> array[v_role] and btrim(category) <> '' group by lower(category)) c), '[]'::jsonb));
end $$;

-- Una imagen concreta del selector (para aplicarla a una partida): debe tener el rol pedido y estar revisada.
create or replace function ss_library_pick_get(p jsonb) returns jsonb language plpgsql stable as $$
declare i library_images; v_role text := lower(btrim(coalesce(p->>'role', '')));
begin
  if v_role not in ('start', 'product') or coalesce(p->>'id', '') !~* '^[0-9a-f-]{36}$' then perform ss_err('invalid_input'); end if;
  select * into i from library_images where id = (p->>'id')::uuid and reviewed and roles @> array[v_role];
  if i.id is null then perform ss_err('library_not_found'); end if;
  return ss_library_image_pick_json(i);
end $$;

-- ---------------------------------------------------------------------------
-- Huella perceptual: imágenes parecidas (para avisar al subir y para el panel de revisión)
-- ---------------------------------------------------------------------------
create or replace function ss_admin_library_image_near(p jsonb) returns jsonb language plpgsql stable as $$
declare v_h text := lower(btrim(coalesce(p->>'phash', ''))); v_max int := least(greatest(coalesce((p->>'max_distance')::int, 6), 0), 32);
begin
  if v_h !~ '^[0-9a-f]{16}$' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(ss_library_image_json(s.i) || jsonb_build_object('distance', s.d) order by s.d, s.created_at)
    from (select i, i.created_at, bit_count(('x' || i.phash)::bit(64) # ('x' || v_h)::bit(64)) d
            from library_images i where i.phash is not null
             and bit_count(('x' || i.phash)::bit(64) # ('x' || v_h)::bit(64)) <= v_max
           order by 3, 2 limit 5) s), '[]'::jsonb);
end $$;

-- Pares de imágenes ya registradas que se parecen (distancia de Hamming ≤ max_distance). Compara contenido, no títulos.
create or replace function ss_admin_library_similar(p jsonb) returns jsonb language plpgsql stable as $$
declare v_max int := least(greatest(coalesce((p->>'max_distance')::int, 6), 0), 32); v_lim int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 300);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('distance', s.d, 'a', ss_library_image_json(s.a), 'b', ss_library_image_json(s.b)) order by s.d, s.ca)
    from (select a, b, a.created_at ca, bit_count(('x' || a.phash)::bit(64) # ('x' || b.phash)::bit(64)) d
            from library_images a join library_images b on a.id < b.id
           where a.phash is not null and b.phash is not null
             and bit_count(('x' || a.phash)::bit(64) # ('x' || b.phash)::bit(64)) <= v_max
           order by 4, 3 limit v_lim) s), '[]'::jsonb);
end $$;

-- Imágenes anteriores sin huella (se calculan descargándolas desde el servidor; ver library-service).
create or replace function ss_admin_library_phash_missing(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'remaining', (select count(*) from library_images where phash is null),
    'images', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'url', x.url) order by x.created_at, x.id)
                          from (select id, url, created_at from library_images where phash is null order by created_at, id
                                limit least(greatest(coalesce((p->>'limit')::int, 20), 1), 100)) x), '[]'::jsonb))
$$;

create or replace function ss_admin_library_phash_set(p jsonb) returns jsonb language plpgsql as $$
declare v_h text := lower(btrim(coalesce(p->>'phash', ''))); v_n int;
begin
  if v_h !~ '^[0-9a-f]{16}$' then perform ss_err('invalid_input'); end if;
  update library_images set phash = v_h where id = (p->>'id')::uuid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Cobertura: cuántas imágenes hay por rol y categoría (todas / publicadas = revisadas, las que ve el selector).
-- Los objetivos de volumen viven en TypeScript (LIBRARY_CATEGORIES); aquí solo se cuenta.
-- ---------------------------------------------------------------------------
create or replace function ss_admin_library_coverage(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', (select count(*) from library_images),
    'published', (select count(*) from library_images where reviewed),
    'no_role', (select count(*) from library_images where cardinality(roles) = 0),
    'no_category', (select count(*) from library_images where btrim(category) = ''),
    'no_credit', (select count(*) from library_images where btrim(credit) = ''),
    'no_phash', (select count(*) from library_images where phash is null),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'name', c.name, 'total', c.total, 'start', c.s, 'product', c.pr, 'published', c.pub, 'pub_start', c.pub_s, 'pub_product', c.pub_pr) order by lower(c.name))
      from (select (array_agg(category order by created_at))[1] name, count(*) total,
                   count(*) filter (where roles @> array['start']) s, count(*) filter (where roles @> array['product']) pr,
                   count(*) filter (where reviewed) pub,
                   count(*) filter (where reviewed and roles @> array['start']) pub_s, count(*) filter (where reviewed and roles @> array['product']) pub_pr
              from library_images where btrim(category) <> '' group by lower(category)) c), '[]'::jsonb))
$$;
