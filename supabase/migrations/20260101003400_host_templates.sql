-- Plantillas guardadas del anfitrión (el mismo JSON que se importa/exporta: formato subasta-salvaje/plantilla@1).
-- Máx. 20 por anfitrión y 256 KB cada una; el nombre es único por anfitrión (guardar con el mismo nombre la sustituye).
create table host_templates (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null,
  name        text not null check (char_length(name) between 1 and 80),
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index host_templates_name_idx on host_templates (host_id, lower(name));
create index host_templates_host_idx on host_templates (host_id, updated_at desc);

create or replace function ss_template_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'updated_at', t.updated_at,
    'items', coalesce(jsonb_array_length(t.data->'catalogo'), 0),
    'players', coalesce(jsonb_array_length(t.data->'jugadores'), 0)) order by t.updated_at desc), '[]'::jsonb)
  from host_templates t where t.host_id = (p->>'host_id')::uuid;
$$;

create or replace function ss_template_get(p jsonb) returns jsonb language plpgsql stable as $$
declare t host_templates;
begin
  select * into t from host_templates where id = (p->>'id')::uuid and host_id = (p->>'host_id')::uuid;
  if not found then perform ss_err('template_not_found'); end if;
  return jsonb_build_object('id', t.id, 'name', t.name, 'data', t.data, 'updated_at', t.updated_at);
end $$;

create or replace function ss_template_save(p jsonb) returns jsonb language plpgsql as $$
declare v_host uuid := (p->>'host_id')::uuid; v_name text := btrim(coalesce(p->>'name', '')); v_id uuid; v_new boolean := false;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 80 or jsonb_typeof(p->'data') <> 'object' then perform ss_err('invalid_input'); end if;
  if octet_length((p->'data')::text) > 262144 then perform ss_err('template_too_large'); end if;
  -- Serializa los guardados de un mismo anfitrión (el límite de 20 no se puede saltar con peticiones simultáneas)
  perform pg_advisory_xact_lock(hashtextextended('ss_template:' || v_host::text, 0));
  select id into v_id from host_templates where host_id = v_host and lower(name) = lower(v_name);
  if v_id is null then
    if (select count(*) from host_templates where host_id = v_host) >= 20 then perform ss_err('template_limit'); end if;
    insert into host_templates (host_id, name, data) values (v_host, v_name, p->'data') returning id into v_id;
    v_new := true;
  else
    update host_templates set name = v_name, data = p->'data', updated_at = now() where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'name', v_name, 'replaced', not v_new);
end $$;

create or replace function ss_template_delete(p jsonb) returns jsonb language plpgsql as $$
begin
  delete from host_templates where id = (p->>'id')::uuid and host_id = (p->>'host_id')::uuid;
  if not found then perform ss_err('template_not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Al borrar un usuario desde el superadmin también se borran sus plantillas (la función anterior pasa a ser _base).
alter function ss_admin_delete_user(jsonb) rename to ss_admin_delete_user_base;
create or replace function ss_admin_delete_user(p jsonb) returns jsonb language plpgsql as $$
begin
  delete from host_templates where host_id = (p->>'user_id')::uuid;
  return ss_admin_delete_user_base(p);
end $$;
