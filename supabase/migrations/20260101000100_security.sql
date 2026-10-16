-- =============================================================================
-- Subasta Salvaje · seguridad específica de Supabase (RLS, permisos y Storage)
--
-- Modelo de seguridad:
--   · TODO acceso a datos pasa por el servidor de Next.js con la clave service_role,
--     que verifica la identidad del anfitrión (Supabase Auth) antes de llamar a ss_*.
--   · Las claves anon/authenticated NO pueden leer ni escribir ninguna tabla ni
--     ejecutar ninguna función: RLS activado y sin permisos = denegado por defecto.
--   · La pantalla pública recibe los datos a través de /api/public/... (el servidor
--     devuelve únicamente la vista pública) y se avisa de cambios por Realtime Broadcast.
--   · Storage: bucket de lectura pública (rutas con UUID impredecibles); sólo el
--     servidor (service_role) puede escribir.
-- Requiere los esquemas de Supabase (auth, storage); no se aplica en el modo demo.
-- =============================================================================

alter table games             enable row level security;
alter table players           enable row level security;
alter table auction_items     enable row level security;
alter table auctions          enable row level security;
alter table bids              enable row level security;
alter table purchases         enable row level security;
alter table image_versions    enable row level security;
alter table image_jobs        enable row level security;
alter table game_events       enable row level security;
alter table idempotency_keys  enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Políticas explícitas de "denegar todo": documentan la intención y protegen
-- frente a futuros GRANT accidentales.
create policy deny_all_games            on games            for all to anon, authenticated using (false) with check (false);
create policy deny_all_players          on players          for all to anon, authenticated using (false) with check (false);
create policy deny_all_auction_items    on auction_items    for all to anon, authenticated using (false) with check (false);
create policy deny_all_auctions         on auctions         for all to anon, authenticated using (false) with check (false);
create policy deny_all_bids             on bids             for all to anon, authenticated using (false) with check (false);
create policy deny_all_purchases        on purchases        for all to anon, authenticated using (false) with check (false);
create policy deny_all_image_versions   on image_versions   for all to anon, authenticated using (false) with check (false);
create policy deny_all_image_jobs       on image_jobs       for all to anon, authenticated using (false) with check (false);
create policy deny_all_game_events      on game_events      for all to anon, authenticated using (false) with check (false);
create policy deny_all_idempotency_keys on idempotency_keys for all to anon, authenticated using (false) with check (false);

-- Storage: bucket público (lectura por URL); la escritura sólo con service_role
-- (que se salta RLS). Sin políticas para anon/authenticated => no pueden subir,
-- modificar, borrar ni listar objetos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-images', 'game-images', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
