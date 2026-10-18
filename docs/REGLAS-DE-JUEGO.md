# Reglas de juego (negocio)

## Partida
Estados: `lobby` → `active` ⇄ `paused` → `finished`. Código de sala de 6 caracteres (sin 0/O/1/I). Hasta **10 jugadores** (el máximo de la aplicación; el anfitrión puede fijar uno menor al crear la partida o en Ajustes, y SQL lo hace cumplir también a quien se una con el código); mínimo 2 y
1 elemento para empezar. Presupuesto inicial y puja mínima configurables (céntimos). Regla de clasificación opcional: `none`, `balance`
(más dinero), `items` (más elementos), `votes` (votos del público apuntados a mano por el anfitrión con `votes.adjust`).
Temáticas con catálogo de elementos de ejemplo (`domain/themes.ts`). **Borrado automático** a los 7 días (168 h, ajuste `game_ttl_hours` del superadmin; respaldo `GAME_TTL_HOURS`) sin actividad
(`/api/jobs/purge`); el anfitrión también puede borrarla desde Ajustes (irreversible). Se puede **finalizar desde pausa**.

## Modos de juego (`play_mode`)
- `host`: los jugadores pujan en voz alta y el anfitrión registra la puja. Sin móviles.
- `mobile`: los jugadores se unen con código/QR (`/join`), eligen su casilla o escriben un nombre, y pujan desde el móvil.
  Identidad = cookie `ss_p_<SALA>` con token aleatorio (en BD solo `sha256`). `join_policy`: `open` | `slots` (solo casillas creadas) | `closed`.
  Un móvil = un jugador; un jugador = un móvil (409 si está ocupado). Nombres normalizados (NFKC, sin caracteres de control).

## Subasta
1. El anfitrión **anuncia** un elemento (`auction.announce`, opcional `wild_event`). Solo una subasta viva (`open`/`closed`) por partida.
2. **Pujas**: deben superar la actual y la mínima de la partida, y caber en el saldo. La primera puja con el botón «+1 Ohro» es de **1 Ohro** (no 2 €).
   Un jugador no puja contra sí mismo desde el móvil (`already_leading`). Se pueden deshacer pujas (`ss_undo_bid`), cerrar/reabrir, cancelar (sin cobrar) o despejar.
3. **Adjudicar** (`ss_award` manual / `ss_auto_award` automático) → siempre por `ss_award_core`: cobra **una vez**, crea la `purchase`, marca el
   elemento `sold` y encola **un** trabajo de edición de imagen. El manual exige `expected_winner_id` y `expected_price_cents` (si la puja cambió → `stale_state`)
   y es idempotente (misma clave o reintento con mismos datos ⇒ no vuelve a cobrar).
4. **Adjudicación automática** (`auto_award_enabled`, `auto_award_seconds` 3–300): por tiempo desde la última puja (cada puja/deshacer/reabrir reinicia
   la cuenta atrás) o **al instante** si nadie más puede superar la puja por saldo. No actúa con la puja cerrada ni en pausa. La TV/lecturas la disparan
   cuando vence (`autoAwardTick`).

## Rondas, pujas enteras, imagen obligatoria y subasta automática (migración 2600)
- **Máximo de rondas** (`games.max_rounds`, por defecto = elementos del catálogo; editable en Ajustes y en el asistente, **nunca menor que las rondas jugadas ni mayor que el número de elementos del catálogo**: `rounds_above_catalog`). Una ronda = una subasta terminada: adjudicada **o cancelada** (por el anfitrión o por falta de pujas en la subasta automática; `auctions.counted`). Las canceladas por «deshacer adjudicación» no cuentan: esa ronda vuelve a jugarse (`ss_rounds_done`, migración 7000). Al agotarse: `ss_announce` termina la partida en vez de anunciar, y `ss_auto_run_tick` (lo dispara cualquier lectura de TV/móvil/panel) la finaliza tras 8 s para ver la última adjudicación, aunque el anfitrión no haga nada. `game.total_rounds` de la instantánea ya incorpora este límite.
- **Pujas solo en Ohros enteros** (`games.integer_bids`, activado por defecto): `bid_not_whole` si no es múltiplo de 1 Ohro; la puja mínima y los botones rápidos se redondean hacia arriba; «doble o mitad» cobra la mitad redondeada a euros. Se puede desactivar en el asistente o en Ajustes (1,50 Ohros…).
- **Imagen inicial obligatoria:** `game.start` falla con `initial_image_required` si algún jugador no tiene imagen actual (subida, de galería o generada). En el panel el botón «Empezar» queda desactivado con la explicación.
- **Subasta automática** (`ss_set_auto_run` + `ss_auto_run_tick`): desde Resumen. Anuncia por orden los elementos disponibles, tras la pausa configurada (`auto_run_gap_seconds`, 3–300, 10 de serie), con el evento sorpresa habitual; al activarla enciende la adjudicación automática con el último tiempo usado (o el indicado; 20 s de serie). Si una subasta abierta no recibe ninguna puja en `auto_run_idle_seconds` (10–600, 60 de serie) se cancela y el elemento se da por **perdido** (ver abajo); cuando no queda ninguno disponible, finaliza la partida. Sin elementos o sin rondas, también finaliza. En pausa no avanza. El servidor la «mueve» cuando alguien lee el estado, así que necesita al menos una pantalla (TV, móvil o panel) abierta.

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
aplicable a jugadores **actuales y/o nuevos** (`scope_current`, `scope_new`; `games.new_player_image`) y solo en `lobby`. Un elemento puede tener su **foto** (subida por el anfitrión o generada con IA): al ganarlo, la edición de la casa del ganador la mezcla con la imagen de su casa (`docs/IMAGENES-IA.md`). Cada compra encadena una versión
nueva (`image_versions.parent_version_id`); el anfitrión puede restaurar versiones (sin tocar saldos). Detalle en `IMAGENES-IA.md`.

## Acceso de anfitriones y superadmin (migración 2200)
- Cada anfitrión tiene un `host_profiles` (se crea en su primer acceso). **Registro abierto** (por defecto): cualquiera con cuenta entra. **Cerrado**: solo con invitación (`host_invites`, por correo) o si ya tenía partidas. **Bloqueado**: no entra ni gestiona nada (sus datos se conservan).
- `SUPERADMIN_EMAILS` (correo confirmado) → `/admin`; nunca queda fuera por bloqueo o registro cerrado. En modo demo el anfitrión local es superadmin.
- IA: debe estar configurada (`IMAGE_PROVIDER`), encendida (`ai_enabled` global) y permitida para ese anfitrión (`host_profiles.ai_enabled`); si no, `ai_not_available` / `ai_disabled_for_user`. Con la IA apagada los trabajos de partidas en modo IA quedan en cola.
- Cuotas efectivas: ajuste del superadmin > variables de entorno > 10 por partida / 50 al día. `image_usage` guarda `host_id` y NO se borra con la partida.

## Fin de partida si todos se quedan sin saldo (migración 7600)
- Si **ningún jugador puede pujar ni la puja mínima** (en modo móviles cuentan los que han entrado alguna vez; tiene que haber al menos uno), la partida termina sola aunque queden rondas: `ss_all_broke`, comprobado por `ss_auto_run_tick` (cuando no hay subasta o la abierta no tiene pujas, tras 8 s para ver la última adjudicación) y por `ss_announce`. Se guarda `games.finish_reason = 'all_broke'` y el evento `game_finish_all_broke`; «Reiniciar partida» lo borra (disparador). La TV avisa «¡Todos os habéis quedado sin saldo! La partida termina» durante la espera y, al acabar, los resultados, el panel y los móviles muestran el motivo.

## Relojes de la subasta automática en TV y móviles
- Con la subasta automática activa la TV (abajo, centrado) y los móviles (arriba) muestran **«Sin pujas: si nadie puja, se salta en N s»** mientras la subasta abierta no tiene pujas (`opened_at` + `auto_run_idle_seconds`) y **«Siguiente subasta en N s»** durante la pausa entre subastas (`game.auto_run_next_at`), para que se vea que el juego no se ha colgado. Componente `AutoRunClock`.

## Elementos sin pujas = «perdidos» y anuncio al azar (migración 6600)
- Si una subasta termina **sin ninguna puja válida** (el anfitrión pulsa «Cancelar subasta» o la subasta automática agota `auto_run_idle_seconds`), el elemento pasa a `auction_items.status = 'lost'` («Sin pujas · perdido»): **no vuelve a salir** en otra ronda ni se puede anunciar. Cancelar una subasta **con** pujas lo devuelve al catálogo (`available`) sin cobrar nada. Queda el evento `auction_unsold` y la instantánea trae `last_unsold` (elemento, emoji y hora): la **TV muestra durante ~5 s la animación «¡Nadie lo quiere!»** una sola vez por evento (lo ya existente al abrir la pantalla no se anima). «Reiniciar partida» vuelve a dejarlos disponibles.
- **Anunciar uno al azar** (`auction.announce_random` → `ss_announce_random`): el anfitrión elige al azar entre los elementos `available` (el sorteo lo hace el servidor) y lo anuncia con el evento sorpresa elegido; sin elementos disponibles: `no_items_left`.
- **Orden aleatorio en la subasta automática** (migración 6800, `games.auto_run_random`, parámetro `random` de `game.set_auto_run`): casilla «🎲 Elementos al azar» en la tarjeta de la subasta automática. Con ella, `ss_auto_run_tick` anuncia un elemento disponible elegido al azar por el servidor en vez del siguiente por orden de catálogo; sin marcarla sigue el orden. Detener la subasta no cambia la preferencia. Las subastas sorteadas (botón «Anunciar uno al azar» o subasta automática aleatoria) se marcan (`auctions.picked_random`, migración 7400, `auction.random` en la instantánea): la TV muestra «🎲 Elegido al azar» y suena el sorteo (dado) en la TV y en el panel.

## Reglas extra: relámpago, sobre cerrado, presupuesto individual y equipos (migración 8100)
- **Subasta relámpago (`wild_event = 'flash'`):** `ss_auto_award` la adjudica a los `auctions.auto_seconds_override` (8) s de la última puja (o del anuncio si aún no hay) **aunque la adjudicación automática esté apagada o tenga otro tiempo**; cada puja reinicia los 8 s. Sin pujas no se adjudica: el anfitrión la cancela y el elemento queda «perdido». Cobra siempre con `ss_award_core` (una sola vez).
- **Sobre cerrado (`'sealed'`):** puja oculta como «a ciegas» (nadie ve importes ni líder; la TV y el móvil muestran quién ya pujó, sin importes) y **una sola puja vigente por jugador** (`sealed_already_bid`; si el anfitrión anula la puja, puede repetir). Gana la más alta, a igualdad la primera. Nunca se adjudica sola: la cierra y adjudica el anfitrión con `ss_award_core`.
- **Presupuesto individual:** `player.set_budget` (`ss_player_set_budget`, solo en sala de espera, céntimos enteros 0–100.000.000) fija el saldo de un jugador y su `players.initial_balance_cents`. «Reiniciar partida» restaura ese valor. **Cambiar el presupuesto general pisa los individuales.** Quien se une después nace con el general.
- **Equipos ligeros:** `player.set_team` (`players.team`, ≤ 20 caracteres, vacío = sin equipo; solo en sala de espera). No comparten saldo. Si hay algún equipo, los resultados muestran una tabla por equipo (suma de saldos, elementos y puntuación según la regla de clasificación activa); sin etiquetas, nada cambia. Reiniciar conserva los equipos.
- **Pendiente (no implementado por riesgo con el dinero):** evento «robo» y «subasta inversa».
