# Fase 1 de pulido del juego (modo móviles, TV, resultados)

Seis mejoras pequeñas sobre el juego en directo. Migraciones: `20260101009500_unyield_bid.sql`, `…9502_auction_grace.sql`, `…9504_player_stats_awards.sql` y `…9505_security_game_phase1.sql` (permisos; no corre en PGlite). Todas las reglas están en SQL `ss_*`; ninguna toca saldos.

## 1. Volver a pujar (retractarse de ceder)
`ss_unyield_bid` · ruta `POST /api/play/[code]/unyield` (mismo patrón que `yield`: `assertSameOrigin`, `roomKey`, límites por IP/sala/jugador, identidad solo por cookie, cuerpo Zod `{ auction_id }` leído con `readJson`) · botón «Volver a pujar» en la nota de cedido del móvil (`yield-button.tsx`).

Regla (la más simple y segura):
- **Solo con la subasta abierta.** Si ceder provocó la adjudicación inmediata o dio el elemento por perdido, la subasta ya está adjudicada/cancelada y retractarse es imposible (`unyield_closed`): nunca se «deshace» un cobro ni un elemento perdido.
- Si **otro jugador cedió después** que tú, solo puedes retractarte en los **primeros 8 s** (`unyield_too_late` pasado ese tiempo): los demás han decidido contando con tu cesión. Si nadie cedió después, puedes en cualquier momento mientras siga abierta.
- Idempotente (si no habías cedido, `ok` con `replay`). Registra `bid_unyielded`. Quien se retracta vuelve a poder pujar (`ss_player_bid` solo bloquea mientras exista la fila de `auction_yields`) y TV/panel dejan de mostrarlo como cedido (la lista `yielded` sale de esa tabla).

## 2. Pad de pujas del móvil
`play/bid-pad.tsx`: fila destacada con **«Igualar +1»** (mínimo siguiente: puja actual + 1 Ohro; sin pujas, la mínima de la partida) y **«Subir al máximo»** (todo el saldo; en Ohros enteros se redondea hacia abajo; solo habilitado si es > puja actual y ≥ mínimo). El máximo siempre pasa por el `ConfirmDialog` de «mitad o más de tu saldo». Botones `min-h-14` (≥ 44 px), con `aria-label` completo; la rejilla auto-fit de `+1/+2/+5/+10` no cambia.

## 3. Pausa de gracia por jugador
Acción de anfitrión `auction.grace` (`schemas.ts` → `toRpc` → `ss_auction_grace`): `{ auction_id, seconds (1..30, 10 por defecto), player_id? }`. Aplaza la adjudicación por tiempo moviendo `timer_reset_at` de modo que el nuevo vencimiento sea `max(vencimiento actual, ahora) + N s`. Vale para la **adjudicación automática y el relámpago**; error `grace_not_applicable` si no hay cuenta atrás (sin líder, sin automática, sobre cerrado), `grace_limit` pasados **3 usos por subasta**. Registra `auction_grace` en el log de eventos. Nunca toca saldos ni pujas. La instantánea añade `auction.grace = { uses, max, player_id, until }`.
- Panel (`host/auction-panel.tsx`, `GraceControl`): selector «Esperar a» + botón «⏳ +10 s de gracia» con los usos que quedan.
- TV (`auction-stage.tsx`): «⏳ Unos segundos más para X» mientras dura (`tv-grace`).
- Limitación conocida: si entra una puja nueva antes de que termine la gracia, la cuenta atrás se calcula con `max(última puja, timer_reset_at) + segundos`, así que puede conservar parte de la gracia sobrante (como mucho N − segundos de la automática).

## 4. TV: barra de controles en la pantalla final
Antes se superponía al título y a los premios. Ahora, con la partida terminada, la barra (Pantalla activa/Sonido/Música/Pantalla completa) va **abajo y centrada**, y `FinalResults` (variante TV, con y sin podio) reserva una franja inferior de 3,6 rem. Se comprobó con captura a 1920×1080 (sin solapamientos con título, premios ni tarjetas; el indicador de conexión sigue abajo a la derecha). La barra sigue ocultándose sola cuando no hace falta.

## 5. Sonidos y animación
Todo sintetizado en `src/lib/audio/engine.ts` (nada de ficheros ni dependencias): nuevos `yield` (dos notas suaves descendentes) y `grace` (dos «ping»). Suenan en TV y panel al aparecer una cesión/gracia nueva (comparando instantáneas; nada en el primer render) y en el móvil como confirmación al ceder uno mismo. «Te han superado» ya tenía su sonido (`outbid`, ya en `usePlayerSounds` junto a `OutbidAlert`); se mantiene. Los sonidos respetan el silencio del anfitrión (`game.sound_enabled`) y el interruptor personal del móvil (por defecto en silencio). Aviso breve «X ha cedido» (`screen/yield-notice.tsx`, TV y móvil, 4 s, solo cesiones nuevas de la misma subasta): su entrada usa `.ss-bid-in`, que se desactiva con `prefers-reduced-motion`. No se ha podido escuchar el resultado (sin salida de audio en el contenedor).

## 6. Más premios finales
`computeAwards` suma 4 premios (mínimos sensatos y empates compartidos):
| Premio | Mide | Mínimo |
|---|---|---|
| ⚖️ El remate más ajustado | menor diferencia entre su puja ganadora y la mejor puja rival en una subasta que ganó | ≤ 3 Ohros |
| ⚡ El rápido | subastas adjudicadas donde hizo la primera puja | 2 |
| 🔄 El remontador | subastas ganadas tras haber sido superado antes | 1 |
| 🥊 El peleón | máximo de pujas suyas en una sola subasta | 4 |

`ss_player_stats` se amplía por envoltorio (`ss_player_stats_pre_awards`) con `min_win_gap_cents`, `first_bids`, `comebacks` y `max_bids_one_auction` (tipo `PlayerStat`, campos opcionales para compatibilidad con datos antiguos). Las pujas anuladas (`voided_at`) no cuentan.

## Pruebas
- Vitest: `tests/yield-bid.test.ts` (retractarse: ok/idempotente, nunca tras adjudicar o perder, regla de 8 s, errores), `tests/auction-grace.test.ts` (aplaza, relámpago, límites, log, saldos intactos, cobro único posterior), `tests/player-stats.test.ts` (datos SQL y premios nuevos).
- Playwright: `e2e/yield.spec.ts` (retractarse, «Igualar +1», «Subir al máximo» con confirmación, gracia desde el panel y aviso en la TV).
- No verificado: sonido real, Postgres 16 real de las migraciones nuevas, comportamiento en producción (Supabase) y teléfonos físicos.
