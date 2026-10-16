# Reglas de juego (negocio)

## Partida
Estados: `lobby` → `active` ⇄ `paused` → `finished`. Código de sala de 6 caracteres (sin 0/O/1/I). Hasta **12 jugadores**; mínimo 2 y
1 elemento para empezar. Presupuesto inicial y puja mínima configurables (céntimos). Regla de clasificación opcional: `none`, `balance`
(más dinero), `items` (más elementos), `votes` (votos del público apuntados a mano por el anfitrión con `votes.adjust`).
Temáticas con catálogo de elementos de ejemplo (`domain/themes.ts`). **Borrado automático** a las `GAME_TTL_HOURS` (12) sin actividad
(`/api/jobs/purge`); el anfitrión también puede borrarla desde Ajustes (irreversible). Se puede **finalizar desde pausa**.

## Modos de juego (`play_mode`)
- `host`: los jugadores pujan en voz alta y el anfitrión registra la puja. Sin móviles.
- `mobile`: los jugadores se unen con código/QR (`/join`), eligen su casilla o escriben un nombre, y pujan desde el móvil.
  Identidad = cookie `ss_p_<SALA>` con token aleatorio (en BD solo `sha256`). `join_policy`: `open` | `slots` (solo casillas creadas) | `closed`.
  Un móvil = un jugador; un jugador = un móvil (409 si está ocupado). Nombres normalizados (NFKC, sin caracteres de control).

## Subasta
1. El anfitrión **anuncia** un elemento (`auction.announce`, opcional `wild_event`). Solo una subasta viva (`open`/`closed`) por partida.
2. **Pujas**: deben superar la actual y la mínima de la partida, y caber en el saldo. La primera puja con el botón «+1 €» es de **1 €** (no 2 €).
   Un jugador no puja contra sí mismo desde el móvil (`already_leading`). Se pueden deshacer pujas (`ss_undo_bid`), cerrar/reabrir, cancelar (sin cobrar) o despejar.
3. **Adjudicar** (`ss_award` manual / `ss_auto_award` automático) → siempre por `ss_award_core`: cobra **una vez**, crea la `purchase`, marca el
   elemento `sold` y encola **un** trabajo de edición de imagen. El manual exige `expected_winner_id` y `expected_price_cents` (si la puja cambió → `stale_state`)
   y es idempotente (misma clave o reintento con mismos datos ⇒ no vuelve a cobrar).
4. **Adjudicación automática** (`auto_award_enabled`, `auto_award_seconds` 3–300): por tiempo desde la última puja (cada puja/deshacer/reabrir reinicia
   la cuenta atrás) o **al instante** si nadie más puede superar la puja por saldo. No actúa con la puja cerrada ni en pausa. La TV/lecturas la disparan
   cuando vence (`autoAwardTick`).

## Eventos sorpresa (migración 1800)
- Por subasta (`auctions.wild_event`): `blind` o `double`; elegido por el anfitrión o sorteado según `games.wild_chance_pct` si no indica nada (`none` = normal).
- **Blind:** las vistas `public` ocultan importe, líder, pujas y `auto_award_at` mientras está `open`/`closed` (muestran `bids_count`); el anfitrión ve todo.
  Las reglas de puja no cambian (una puja baja se rechaza ⇒ da pista). Se revela al adjudicar.
- **Double («doble o mitad»):** en `ss_award_core` `random()<0.5` ⇒ cobra `bid/2` o `min(2·bid, saldo)`. `purchases.price_cents` = lo cobrado;
  `auctions.final_price_cents` = la puja; `auctions.wild_note` = `{outcome,bid_cents,charged_cents}`.
- **Impuesto (`ss_wild_tax`):** los de mayor saldo pagan el 20 % (a la baja); el total se reparte a partes iguales entre los demás; el resto de céntimos
  se queda con el primer pagador (suma de saldos constante). Solo `active`, sin subasta viva, con clave de idempotencia. Se registra `wild_tax` y la TV lo anuncia.

## Deshacer adjudicación (migración 1800)
`ss_undo_award`: solo la **última** compra de la partida (`not_last_purchase`), estados `active`/`paused`. Devuelve `price_cents`, elemento → `available`,
subasta → `cancelled`, `current_auction_id` → null, borra la compra y su job; si el job está `running` ⇒ `image_job_running`; si ya generó, el jugador vuelve
al `parent_version_id` (si esa versión era la actual); las versiones se conservan sin vínculo a la compra. Idempotente por clave; evento `award_undone`.

## Galería final y votación (migración 1800)
Solo `play_mode = mobile`. Al `finished`, `gallery.open`: cada jugador identificado vota una casa (no la suya; se puede cambiar) con `ss_gallery_vote`;
el recuento (`gallery.results`) solo lo ve el anfitrión hasta `gallery.close` (`ss_gallery_set`), que fija `gallery_closed_at` y lo publica. Los tokens
de móvil **se conservan** tras finalizar (solo sirven para votar/ver); en partidas `host` se borran al finalizar. Independiente de `ranking_rule = votes`.

## Imágenes por partida
`image_mode`: `stickers` (por defecto, local, sin IA) | `ai` (proveedor real, con cuotas). Imagen inicial: subida, galería (`catalog`), generada, o ninguna. **La generada es UNA sola imagen base compartida** (job `base`, `ss_complete_image_job` asigna el mismo archivo a todos los jugadores del lobby y a los nuevos vía `new_player_image`); la generación por jugador (`image.request_initial`) es opcional y da casas distintas;
aplicable a jugadores **actuales y/o nuevos** (`scope_current`, `scope_new`; `games.new_player_image`) y solo en `lobby`. Cada compra encadena una versión
nueva (`image_versions.parent_version_id`); el anfitrión puede restaurar versiones (sin tocar saldos). Detalle en `IMAGENES-IA.md`.
