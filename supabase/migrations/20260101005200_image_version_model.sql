-- Registro del MODELO de IA que generó cada versión de imagen (hasta ahora solo se guardaba el proveedor y el prompt).
-- Se guarda aparte con envoltorios para no copiar las funciones grandes: la versión se identifica por su archivo.
alter table image_versions add column if not exists model text check (model is null or char_length(model) <= 200);

alter function ss_complete_image_job(jsonb) rename to ss_complete_image_job_pre_model;
create or replace function ss_complete_image_job(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := ss_complete_image_job_pre_model(p);
  if nullif(p->>'model', '') is not null and p->>'storage_path' is not null then
    update image_versions set model = left(p->>'model', 200) where storage_path = p->>'storage_path' and model is null;
  end if;
  return r;
end $$;

-- El historial del anfitrión recibe también el modelo de cada versión.
alter function ss_get_state(jsonb) rename to ss_get_state_pre_model;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare r jsonb;
begin
  r := ss_get_state_pre_model(p);
  if r ? 'versions' and jsonb_typeof(r->'versions') = 'array' then
    r := jsonb_set(r, '{versions}', coalesce((
      select jsonb_agg(t.e || jsonb_build_object('model', (select v.model from image_versions v where v.id = (t.e->>'id')::uuid)) order by t.ord)
      from jsonb_array_elements(r->'versions') with ordinality as t(e, ord)), '[]'::jsonb));
  end if;
  return r;
end $$;
