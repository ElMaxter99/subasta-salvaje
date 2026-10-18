# Entrega: reglas de juego extra (rama feat/rules)

## Viñetas para el README
- Eventos sorpresa nuevos: **⚡ Relámpago** (se adjudica sola 8 s después de la última puja, aunque la adjudicación automática esté apagada) y **✉️ Sobre cerrado** (puja oculta, una sola por jugador; gana la más alta y, en empate, la primera; la adjudica el anfitrión).
- **Presupuesto individual** por jugador en la sala de espera («Editar» en su tarjeta); «Reiniciar partida» lo restaura.
- **Equipos ligeros**: etiqueta opcional por jugador; los resultados finales muestran una tabla de equipos (saldo total, elementos y puntuación según la regla de clasificación). No comparten saldo.

## Texto para DECISIONES
Relámpago usa `auctions.auto_seconds_override` dentro de `ss_auto_award`, que tiene prioridad sobre `games.auto_award_*`. Sobre cerrado reutiliza el mecanismo a ciegas, limita a una puja vigente por jugador y se excluye de la adjudicación automática e instantánea; el cobro sigue siendo `ss_award_core`. El presupuesto individual se guarda en `players.initial_balance_cents` (un disparador lo rellena al crear el jugador); cambiar el presupuesto general pisa los individuales. Los equipos son solo una etiqueta (`players.team`); la tabla se calcula en TS (`computeTeams`, presentación) sin tocar dinero. El sorteo automático de eventos (`wild_chance_pct`) sigue siendo solo entre a ciegas/doble.

## Pendientes
- Eventos «robo» y «subasta inversa» (riesgo con el dinero; no implementados).
- Probar relámpago/sobre cerrado con jugadores reales en móviles (solo hay tests y e2e con API).
- El relámpago depende de que algo dispare `ss_auto_award` (sondeo de la TV/panel o cron), como la adjudicación automática normal.

## Migraciones
`20260101008100_rules_extra.sql` (funcional: ss_announce, ss_bid_internal, ss_auto_award, ss_player_set_budget/team, ss_update_game, ss_reset_game, envoltorio ss_get_state) y `20260101008101_security_rules_extra.sql` (permisos).

## Cómo probarlo
`npm run lint && npm run typecheck && npm test` (tests/rules-extra.test.ts, 22 casos); Postgres real con `PG_TEST_URL=... npx vitest run tests/postgres-real.test.ts`; e2e: `e2e/rules-extra.spec.ts` (presupuesto, equipo y sobre cerrado vía API/TV).
