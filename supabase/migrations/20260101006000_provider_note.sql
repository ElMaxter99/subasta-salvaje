-- Por qué se usó cada proveedor: nota por versión de imagen (cadena y saltos, proveedor forzado al regenerar, proveedor único).
alter table image_versions add column if not exists provider_note text check (provider_note is null or char_length(provider_note) <= 700);

alter function ss_complete_image_job(jsonb) rename to ss_complete_image_job_pre_note;
create or replace function ss_complete_image_job(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := ss_complete_image_job_pre_note(p);
  if nullif(p->>'provider_note', '') is not null and p->>'storage_path' is not null then
    update image_versions set provider_note = left(p->>'provider_note', 700) where storage_path = p->>'storage_path' and provider_note is null;
  end if;
  return r;
end $$;

alter function ss_get_state(jsonb) rename to ss_get_state_pre_note;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare r jsonb;
begin
  r := ss_get_state_pre_note(p);
  if r ? 'versions' and jsonb_typeof(r->'versions') = 'array' then
    r := jsonb_set(r, '{versions}', coalesce((
      select jsonb_agg(t.e || jsonb_build_object('provider_note', (select v.provider_note from image_versions v where v.id = (t.e->>'id')::uuid)) order by t.ord)
      from jsonb_array_elements(r->'versions') with ordinality as t(e, ord)), '[]'::jsonb));
  end if;
  return r;
end $$;
