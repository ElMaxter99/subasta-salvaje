-- Partidas del sistema: plantillas creadas por el superadmin que los anfitriones pueden cargar en «Nueva partida».
-- Los borradores solo los ve el superadmin. El contenido (`data`) es el mismo formato `subasta-salvaje/plantilla@1` que las
-- plantillas de usuario (con `portada` y `casa_inicial` opcionales); las fotos son enlaces https a un proveedor externo.
-- La validación fuerte vive en TypeScript (Zod, como host_templates); aquí se comprueban los límites básicos y la auditoría.

create table system_templates (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  title        text not null check (char_length(title) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 300),
  cover_url    text check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 500)),
  data         jsonb not null check (jsonb_typeof(data) = 'object'),
  status       text not null default 'draft' check (status in ('draft','published')),
  sort_order   integer not null default 100 check (sort_order between 0 and 100000),
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);
create index system_templates_list_idx on system_templates (status, sort_order, title);

create or replace function ss_system_template_summary(t system_templates) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'title', t.title, 'description', t.description, 'cover_url', t.cover_url,
    'status', t.status, 'sort_order', t.sort_order, 'updated_at', t.updated_at, 'published_at', t.published_at,
    'items', coalesce(jsonb_array_length(t.data->'catalogo'), 0),
    'players', coalesce(jsonb_array_length(t.data->'jugadores'), 0),
    'has_initial_image', coalesce(nullif(t.data->>'casa_inicial', ''), '') <> '')
$$;

-- Listado: solo publicadas, o todas si p.admin = true (el servidor solo lo pasa para el superadmin).
create or replace function ss_system_template_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(ss_system_template_summary(t) order by t.sort_order, t.title), '[]'::jsonb)
  from system_templates t
  where coalesce((p->>'admin')::boolean, false) or t.status = 'published'
$$;

-- Lectura de una plantilla (por id o slug). Un borrador solo se entrega con p.admin = true.
create or replace function ss_system_template_get(p jsonb) returns jsonb language plpgsql stable as $$
declare t system_templates; v_admin boolean := coalesce((p->>'admin')::boolean, false);
begin
  if p->>'id' is not null then select * into t from system_templates where id = (p->>'id')::uuid;
  else select * into t from system_templates where slug = lower(coalesce(p->>'slug', '')); end if;
  if t.id is null or (t.status <> 'published' and not v_admin) then perform ss_err('template_not_found'); end if;
  return ss_system_template_summary(t) || jsonb_build_object('data', t.data);
end $$;

-- Crea o actualiza (por id). El estado no cambia aquí: se publica con ss_admin_system_template_set_status.
create or replace function ss_admin_system_template_upsert(p jsonb) returns jsonb language plpgsql as $$
declare v_id uuid := (p->>'id')::uuid; v_slug text := lower(btrim(coalesce(p->>'slug', ''))); t system_templates;
begin
  if jsonb_typeof(p->'data') <> 'object' then perform ss_err('invalid_input'); end if;
  if octet_length((p->'data')::text) > 262144 then perform ss_err('template_too_large'); end if;
  if exists (select 1 from system_templates where slug = v_slug and (v_id is null or id <> v_id)) then perform ss_err('slug_taken'); end if;
  if v_id is null then
    insert into system_templates (slug, title, description, cover_url, data, sort_order, created_by)
    values (v_slug, btrim(coalesce(p->>'title', '')), btrim(coalesce(p->>'description', '')), nullif(btrim(coalesce(p->>'cover_url', '')), ''),
            p->'data', coalesce((p->>'sort_order')::int, 100), p->>'actor')
    returning * into t;
    perform ss_audit(p->>'actor', 'system_template_created', 'system_template', t.id::text, jsonb_build_object('slug', t.slug, 'title', t.title));
  else
    update system_templates set slug = v_slug, title = btrim(coalesce(p->>'title', '')), description = btrim(coalesce(p->>'description', '')),
           cover_url = nullif(btrim(coalesce(p->>'cover_url', '')), ''), data = p->'data', sort_order = coalesce((p->>'sort_order')::int, sort_order), updated_at = now()
     where id = v_id returning * into t;
    if t.id is null then perform ss_err('template_not_found'); end if;
    perform ss_audit(p->>'actor', 'system_template_updated', 'system_template', t.id::text, jsonb_build_object('slug', t.slug, 'title', t.title));
  end if;
  return ss_system_template_summary(t);
end $$;

create or replace function ss_admin_system_template_set_status(p jsonb) returns jsonb language plpgsql as $$
declare t system_templates; v_status text := p->>'status';
begin
  if v_status not in ('draft','published') then perform ss_err('invalid_input'); end if;
  update system_templates set status = v_status, updated_at = now(),
         published_at = case when v_status = 'published' then coalesce(published_at, now()) else published_at end
   where id = (p->>'id')::uuid returning * into t;
  if t.id is null then perform ss_err('template_not_found'); end if;
  perform ss_audit(p->>'actor', case when v_status = 'published' then 'system_template_published' else 'system_template_unpublished' end, 'system_template', t.id::text, jsonb_build_object('slug', t.slug));
  return ss_system_template_summary(t);
end $$;

create or replace function ss_admin_system_template_delete(p jsonb) returns jsonb language plpgsql as $$
declare t system_templates;
begin
  delete from system_templates where id = (p->>'id')::uuid returning * into t;
  if t.id is null then perform ss_err('template_not_found'); end if;
  perform ss_audit(p->>'actor', 'system_template_deleted', 'system_template', t.id::text, jsonb_build_object('slug', t.slug, 'title', t.title));
  return jsonb_build_object('ok', true);
end $$;
