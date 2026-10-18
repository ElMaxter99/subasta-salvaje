-- Una imagen de la biblioteca por id (la usa el comparador de modelos del superadmin para leer la imagen elegida sin aceptar nunca una URL escrita).
create or replace function ss_admin_library_image_get(p jsonb) returns jsonb language plpgsql stable as $$
declare i library_images;
begin
  select * into i from library_images where id = (p->>'id')::uuid;
  if i.id is null then perform ss_err('invalid_input'); end if;
  return ss_library_image_json(i);
end $$;
