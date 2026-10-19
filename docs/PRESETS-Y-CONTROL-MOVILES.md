# Presets de partida, rondas y control de móviles en partida

Tres mejoras que comparten migración (`20260101010400_presets_access.sql` + `20260101010401_security_presets_access.sql`).

## 1. Presets de partida
Un preset es **solo un conjunto de valores** para campos que la base de datos ya valida; no contiene reglas. Vive en un único módulo de dominio, `src/lib/domain/presets.ts` (`PRESETS`, `planPreset`, `presetContextFromSnapshot`), que usan el asistente, el panel y el servidor.

| Preset | Rondas | Ohros/ronda → presupuesto | Adjudicación automática | Subasta automática (pausa / sin pujas) | Sorpresas | Extra |
|---|---|---|---|---|---|---|
| ⚡ Rápida | 8 | 2 → 16 | 15 s | 6 s / 40 s | 10 % | |
| 🎯 Normal | 10 | 2,5 → 25 | 20 s | 10 s / 60 s | 10 % | |
| 🏁 Larga | 20 | 2 → 40 | 25 s | 12 s / 60 s | 15 % | |
| 👫 Pocos (2–3) | 8 | 1,75 → 14 | 15 s | 8 s / 45 s | 15 % | máx. 3 jugadores |
| 🎉 Muchos (7–10) | 12 | 2,5 → 30 | 20 s | 8 s / 45 s | 10 % | máx. 10 jugadores; entrada abierta (solo móviles y antes de empezar) |

Todos: puja mínima 1 Ohro y pujas en Ohros enteros. Los importes salen de las variantes de `docs/PLANTILLAS-SISTEMA-CATALOGO.md` (1,5–3,5 Ohros por ronda). **Un preset nunca enciende ni apaga la subasta automática**: solo ajusta sus tiempos.

### Ajuste al catálogo y al estado (`planPreset`)
- Rondas = `min(preset, elementos del catálogo)`, nunca por debajo de las jugadas; el presupuesto se recalcula con las rondas efectivas (Ohros enteros).
- Máximo de jugadores nunca por debajo de los que ya hay.
- Con la partida empezada se **omite el presupuesto** (SQL: `game_already_started`); con una subasta abierta se omite la **puja mínima** (`auction_in_progress`). Se listan como «no se pueden cambiar ahora».
- Devuelve `changes` (solo lo que difiere del estado actual: «de → a»), `skipped` y `notes` para mostrarlo antes de confirmar.

### Aplicación atómica en SQL
`ss_apply_settings(p jsonb)` (nueva) llama a las funciones que ya existen (`ss_update_game`, `ss_set_game_rules`, `ss_set_auto_award`, `ss_set_auto_run`, `ss_set_wild`, `ss_set_join_policy`, `ss_set_play_mode`) en **una transacción**: si cualquiera rechaza un valor, falla con su error en español y no se aplica nada. No añade reglas. Registra `settings_applied` (con el `preset_id`).
- Acción `game.apply_preset { preset_id }`: el servidor calcula el plan con la instantánea real (`applyPreset` en `game-service.ts`) y lo envía; la respuesta lleva `result.changes/skipped/notes`.
- Acción `game.set_access { play_mode?, join_policy? }` (ver §3) usa la misma función.
- Al crear: `createGameSchema.extras` (`auto_award`, `auto_run`, `wild_chance_pct`, `join_policy`, `preset_id`) se aplica justo después de crear con `ss_apply_settings`.

### UI
- **Asistente, paso «Reglas»**: selector «Preset (opcional)» con descripción corta; al elegir uno rellena presupuesto, puja mínima, rondas, pujas enteras, máx. de jugadores y «Ritmo y sorpresas», y muestra la lista de cambios y los recortes por catálogo. Todo sigue editable; si editas a mano pasa a «personalizado». El resumen final muestra los valores resultantes (rondas, ritmo, máx. de jugadores). Los ajustes de ritmo solo se envían si se tocó un preset o el bloque «Ritmo y sorpresas».
- **Panel → Ajustes → «Preset de partida»**: botones por preset y diálogo de confirmación con la lista de cambios; utilizable en curso.

## 2. Configurar rondas
- `RoundsField` (`src/components/ui/rounds-field.tsx`), común a asistente y Ajustes: indicador **«X de N productos»**, atajos **Todas / Mitad / 8** (acotados a `[jugadas, N]`) y texto «Se jugarán X y Y quedarán sin subastar». En Ajustes el mínimo son las rondas ya jugadas.
- **Hueco corregido en SQL**: `ss_set_game_rules` ya impedía rondas > catálogo, pero **quitar elementos** (`item.remove`) dejaba `max_rounds` por encima del catálogo. `ss_item_op` se envuelve (`ss_item_op_pre_presets`): tras quitar, si `max_rounds > elementos` se recorta a `max(elementos, jugadas)` y la respuesta trae `rounds_adjusted` (el panel muestra un aviso). **Al añadir elementos el máximo no sube solo** (es una decisión del anfitrión); la pestaña Catálogo indica «N productos · se juegan X rondas (Y no saldrán)».
- Los campos de Ajustes (rondas, máx. jugadores) se resincronizan cuando cambian desde fuera (preset, catálogo).

## 3. Quién puja y entrada por móvil, de un toque
Tarjeta **«¿Quién puja?»** (`access-card.tsx`) en la pestaña **Resumen**, visible también con la partida en curso (en curso el panel abre en «Subasta»; la tarjeta está en «Resumen»), más `JoinCard` (código, QR, enlace, conectados):
- Modo anfitrión → **«Abrir para móviles»**: `game.set_access { play_mode: 'mobile', join_policy: 'open' }` (atómico, un solo cambio de versión).
- Modo móviles → **«Las pujas las registro yo»** (con confirmación si hay móviles conectados) y **«Cerrar la entrada» / «Abrir la entrada»**. Los ya conectados siguen jugando al cerrar.
- Aviso cuando la adjudicación automática está activa y hay jugadores sin móvil (ver limitación).
- **Pad del móvil** (`player-screen.tsx`): con `play_mode = host` y el móvil ya identificado se muestra un aviso claro («Ahora el anfitrión registra las pujas…»), se oculta el pad de puja, «ceder» y las reacciones; la casilla y el saldo se conservan y al volver a móviles el mismo token vuelve a valer.

### Comportamiento SQL verificado (`tests/play-mode-switch.test.ts`)
- `ss_claim_player`: exige `play_mode = mobile`, partida no terminada, `join_policy <> closed`; **vale en curso** (casilla libre). `ss_join_new_player`: además `join_policy = open`, solo en **sala de espera** (`game_already_started`), `max_players` (`too_many_players`) y nombre único.
- `ss_player_bid`, `ss_yield_bid/unyield`, reacciones y voto de galería: `mobile_disabled` en modo anfitrión. El anfitrión puede registrar pujas en ambos modos. La subasta abierta no se toca al cambiar de modo.
- Cambiar modo/entrada: solo el anfitrión (`not_host`), no en partida terminada (`game_finished`), valores inválidos → `invalid_input` sin aplicar nada.

### Limitación conocida (no se ha cambiado)
En modo móviles, la adjudicación automática **instantánea** («nadie puede superar la puja») solo cuenta como posibles pujadores a los jugadores con móvil identificado (`ss_bid_internal`, `token_hash is not null`). Si el anfitrión pasa a móviles a mitad de partida con la adjudicación automática y puja por voz por quien aún no se ha conectado, la subasta puede adjudicarse al instante. Está cubierto por un test que lo documenta y la tarjeta lo avisa. Arreglarlo exigiría distinguir «aún no se ha conectado» de «no vendrá», algo que el modelo actual no guarda.

## Pruebas
- Vitest/PGlite: `tests/presets.test.ts` (plan puro, aplicación, atomicidad, rondas ≥ jugadas, extras al crear, recorte al quitar elementos) y `tests/play-mode-switch.test.ts` (anfitrión↔móviles con subasta abierta, políticas de entrada, máximo de jugadores, atomicidad).
- Playwright: `e2e/presets.spec.ts` (asistente: presets, recorte a 12, personalizado, resumen, creación; Ajustes: aplicar con confirmación, en curso) y `e2e/play-mode-switch.spec.ts` (tarjeta de un toque, móvil reclama y puja, vuelta a anfitrión con aviso en el pad, cerrar entrada).
- **No probado**: contra un Postgres/Supabase real (solo PGlite; `postgres-real.test.ts` no se ha ampliado); dispositivos móviles reales; capturas del README (no regeneradas).
