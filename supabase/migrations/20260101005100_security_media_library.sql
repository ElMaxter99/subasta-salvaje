-- Permisos de la biblioteca de medios. Solo Supabase: tablas cerradas (el servidor usa la clave de servicio).
revoke all on table library_images, library_items from anon, authenticated;
alter table library_images enable row level security;
alter table library_items enable row level security;
create policy deny_all_library_images on library_images for all to anon, authenticated using (false) with check (false);
create policy deny_all_library_items on library_items for all to anon, authenticated using (false) with check (false);
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
