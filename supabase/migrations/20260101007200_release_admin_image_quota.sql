-- Si la generación de IA de un producto del catálogo general falla, se devuelve la cuota reservada (igual que ocurre con los trabajos de las partidas).
create or replace function ss_release_admin_image_quota(p jsonb) returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  select id into v_id from image_usage where game_id is null and job_id is null and provider = coalesce(p->>'provider', 'unknown') order by id desc limit 1;
  if v_id is not null then delete from image_usage where id = v_id; end if;
  return jsonb_build_object('ok', true, 'released', v_id is not null);
end $$;
