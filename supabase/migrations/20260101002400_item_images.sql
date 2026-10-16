-- =============================================================================
-- Foto propia para un elemento del catálogo: el anfitrión puede subir (o quitar) la imagen de un elemento. Esa imagen
-- (subida o generada con IA) se usa como REFERENCIA cuando alguien gana el elemento: la edición de la casa del ganador
-- mezcla la foto del elemento con la foto de su casa. Ejecutar DESPUÉS de 20260101002200_superadmin.sql.
-- =============================================================================

create or replace function ss_set_item_image(p jsonb) returns jsonb language plpgsql as $$
declare g games; it auction_items; v_old text; v_path text := nullif(p->>'storage_path', '');
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  select * into it from auction_items where id = (p->>'item_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('item_not_found'); end if;
  v_old := it.image_path;
  update auction_items set image_path = v_path where id = it.id;
  perform ss_log(g.id, g.host_id, case when v_path is null then 'item_image_cleared' else 'item_image_uploaded' end,
                 jsonb_build_object('item_id', it.id, 'item', it.name));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'old_path', v_old);
end $$;
