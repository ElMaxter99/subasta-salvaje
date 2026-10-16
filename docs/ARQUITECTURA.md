# Arquitectura

## Principio: una sola implementación autoritativa
Las reglas viven en **funciones SQL `ss_*`** (plpgsql, un parámetro `p jsonb`). Se ejecutan:
- en producción vía `supabase.rpc('ss_*', { p })` (con la clave `service_role`, solo en servidor);
- en demo y tests sobre **PGlite** (Postgres WASM) con el *mismo* SQL (`src/lib/db/pglite.ts`);
- en `tests/postgres-real.test.ts` sobre Postgres 16 real (concurrencia, privilegios, RLS).

Convenciones SQL: importes en céntimos enteros; errores `RAISE EXCEPTION 'ERR:codigo'` (P0001) que `toDomainError` traduce a
`DomainError` con mensaje en español y estado HTTP (`src/lib/domain/errors.ts`); toda función mutante empieza con
`ss_lock_game(room, host)` (o `ss_lock_game_public(room)` si la llama un jugador) que bloquea la fila de `games` (`FOR UPDATE`),
serializando la partida; idempotencia con `ss_idem_get/ss_idem_put` (tabla `idempotency_keys`, clave de 8–100 caracteres);
`ss_log` registra en `game_events`; `ss_touch` incrementa `games.version` (lo que dispara la actualización de TV/móviles).

## Capas
```
Navegador (TV / panel / móvil)  ──fetch──▶  /api/* (route handlers: handle(), assertSameOrigin, limit())
                                              │  valida con Zod (schemas.ts) y autentica (host: Supabase Auth; jugador: cookie token)
                                              ▼
                                  services/{game,play,jobs}-service.ts   ──ctx.db.rpc('ss_*')──▶ Postgres (ss_* + RLS deny-all)
                                              │                                  ▲ PGlite en demo/tests
                                              ├─ ctx.storage (Supabase Storage | disco local)
                                              ├─ ctx.publisher (Realtime Broadcast | noop)
                                              └─ ctx.provider / ctx.stickers (proveedores de imagen)
```
- `AppContext` (`services/context.ts`) es un singleton por proceso: `mode` (`supabase`|`demo`|`unconfigured`), `db`, `storage`,
  `publisher`, `provider` (IA real o `null`) y `stickers` (proveedor demo/pegatinas, siempre disponible).
- El modo se decide en `config/env.ts` (`getRuntimeMode`): con credenciales de Supabase → `supabase`; sin ellas y sin producción → demo.

## Tiempo real
El cliente usa `useLiveGame` (`lib/client/use-live-game.ts`): instantánea inicial (SSR) + suscripción a **Realtime Broadcast**
(`publisher.publish(room, version)`) + **sondeo** de respaldo. Solo se aplica una instantánea si su `version` es mayor
(protege de respuestas atrasadas). La cuenta atrás de la adjudicación automática usa `server_time` de la instantánea, no el reloj del cliente.
Tres vistas de estado: `ss_get_state` con `view` = `public` (TV, móviles, resultados), `host` (añade `jobs`, `versions`, `events`, `host_id`).

## Funciones SQL principales (catálogo)
| Área | Funciones |
|---|---|
| Partida | `ss_create_game`, `ss_update_game`, `ss_game_status` (start/pause/resume/finish), `ss_set_play_mode`, `ss_set_image_mode`, `ss_set_join_policy`, `ss_set_auto_award`, `ss_set_wild`, `ss_delete_game`, `ss_wipe_game`, `ss_expired_games`, `ss_purge_expired_game`, `ss_game_activity` |
| Jugadores/catálogo | `ss_player_op` (add/update/remove/reorder), `ss_adjust_votes`, `ss_item_op`, `ss_release_player` |
| Móviles | `ss_identify_player`, `ss_claim_player`, `ss_join_new_player`, `ss_player_bid`, `ss_gallery_vote` |
| Subasta | `ss_announce` (con evento), `ss_place_bid`/`ss_bid_internal`, `ss_undo_bid`, `ss_auction_state` (close/reopen/cancel/clear), `ss_award` → `ss_award_core` (único), `ss_auto_award`, `ss_undo_award`, `ss_wild_tax` |
| Galería | `ss_gallery_vote`, `ss_gallery_set` (cerrar) |
| Imágenes | `ss_request_image`, `ss_retry_image_job`, `ss_restore_version`, `ss_add_uploaded_version`, `ss_set_initial_all`, `ss_apply_initial_image`, `ss_apply_default_image`, `ss_claim_image_job`, `ss_complete_image_job`, `ss_fail_image_job`, `ss_pending_job_count`, `ss_reserve_image_quota`, `ss_image_usage` |
| Lectura | `ss_get_state` (envoltorio) sobre `ss_get_state_base`, `ss_list_games` |

## Migraciones (orden, en `supabase/migrations/`)
Cada cambio funcional = una migración portable + otra `_security_` (permisos). Las `_security_` solo se aplican en Supabase.
`0000_core` → `0100_security` → `0200/0300` imagen inicial común → `0400/0500` modo móviles → `0600/0700` endurecimiento →
`0800/0900` política de altas y cuota de imágenes → `1000/1100` adjudicación automática → `1200/1300` modo de imágenes →
`1400/1500` borrado de partidas → `1600/1700` imagen inicial para actuales/nuevos → `1800/1900` eventos sorpresa, deshacer
adjudicación y galería (`ss_get_state` pasa a envoltorio sobre `ss_get_state_base`; tabla `gallery_votes`) → `2000/2100` imagen base compartida (job `base`).
PGlite lleva un registro `ss_migrations` y aplica solo las pendientes (`LEGACY_MARKERS` cubre bases locales antiguas).
**Nunca edites una migración ya publicada** (el propietario las aplica con `npx supabase db push`); crea una nueva.
Tras migrar en Supabase: `notify pgrst, 'reload schema';`.

## Tablas
`games`, `players`, `auction_items`, `auctions`, `bids`, `purchases`, `image_versions`, `image_jobs`, `game_events`,
`idempotency_keys`, `image_usage` (cuota diaria/partida), `gallery_votes`, `ss_migrations` (solo PGlite). RLS activada con
política *deny-all* para `anon`/`authenticated`: toda lectura/escritura pasa por el servidor con `service_role`.

## Rutas
Páginas: `/` (lista), `/login`, `/new-game`, `/join`, `/setup`, `/game/[code]/{host,screen,play,results,history}`.
API: `/api/games` (+`[code]`, `/actions`, `/initial-image`, `/jobs`), `/api/play/[code]/{join,bid,vote,leave,me}`,
`/api/public/games/[code]`, `/api/jobs/{process,purge}` (cron, `CRON_SECRET`), `/api/catalog/initial/[id]`, `/api/health`,
`/api/runtime`, `/api/auth/demo`, `/api/dev/seed` (solo demo), `/api/demo-images/*`.

## Cola de imágenes y worker
`image_jobs` (`initial`|`edit`|`item`) con reclamación atómica (`ss_claim_image_job`, lease), reintentos con espera, un trabajo
por compra (índice único). `processImageJobs` (`jobs-service.ts`) elige proveedor por **modo de la partida**. Se dispara con
`after()` (`kick.ts`), con el cron o con `npm run worker`. Ver `IMAGENES-IA.md`.

## Trampas conocidas de la plataforma
- `DomainError instanceof` falla entre bundles de Next → usar `isDomainError` (duck-typing).
- `created_at default now()` es la hora de inicio de transacción: para ordenar pujas se usa `clock_timestamp()` y el importe.
- En Next 16 se usa `proxy.ts` (no `middleware.ts`); lee `node_modules/next/dist/docs/` antes de usar APIs dudosas.
- Borrar una partida exige orden explícito (`ss_wipe_game`) por las FKs.
