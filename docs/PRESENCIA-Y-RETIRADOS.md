# Presencia («Desconectado» en la TV) y jugadores retirados

Petición del propietario: si el móvil de un jugador se desconecta, la TV lo muestra **en su foto** (para saber quién se fue y quién no) y el anfitrión puede **sacarlo de la TV**. Migraciones: `20260101010500_presence.sql` (+ `20260101010501_security_presence.sql`). Tests: `tests/presence.test.ts`, `tests/presence-route.test.ts`, `e2e/presence.spec.ts`.

> Nada de esto toca dinero, pujas ni adjudicaciones: la partida **no se bloquea ni cambia de reglas** por desconexiones. Solo existe en modo móviles (`play_mode = 'mobile'`).

## 1. Latido y presencia

| Pieza | Qué hace |
|---|---|
| `players.last_seen_at` | Marca de tiempo (reloj de la BD, `clock_timestamp()`) del último latido. **Es lo único que se guarda** (ver privacidad). |
| `players.presence_online` | Último estado *registrado* en `game_events`; sirve para registrar solo los cambios. |
| `ss_player_ping(p)` | Identidad por token (como `ss_send_reaction`). Camino rápido (ya conectado): un `UPDATE` de SU fila, sin bloqueo de la partida y **sin `ss_touch`**. Solo si el estado cambia (vuelve tras estar desconectado, o `bye`) toma el bloqueo, registra el evento y hace `ss_touch`. |
| `ss_presence_sweep(p)` | Marca como desconectados (y registra `player_disconnected`, una sola vez) a quienes pasan de 40 s sin latir. Lo ejecuta `autoAwardTick`, es decir, cualquier lectura de la partida (la TV sondea cada 8 s con Supabase, 1,5 s en local). Comprobación sin bloqueo; solo bloquea si hay algo que cambiar. |
| `/api/play/[code]/ping` | `POST`, mismo endurecimiento que `bid/yield/react`: `assertSameOrigin`, `roomKey`, `readJson` (2 KB), límites por IP+sala (300/min), por sala (1 500/min) y por jugador (30/min), identidad **solo por cookie** (sin cookie ni se consulta la BD). Responde `{ ok, retired }` (sin instantánea). |
| `usePresencePing` (`src/lib/client/use-presence-ping.ts`) | El móvil late cada 15 s **mientras la pestaña esté visible**, y de inmediato al volver a primer plano, recuperar la red (`online`) o restaurarse de la caché (`pageshow`). Al cerrar (`pagehide`, no persistido) manda `{ bye: true }` con `navigator.sendBeacon` (mismo origen, identidad por cookie). |

**Regla:** CONECTADO si `last_seen_at` es de hace < **40 s** (`ss_presence_window()`); si no, DESCONECTADO. Quien nunca latió tras reclamar la casilla cuenta como recién conectado: un disparador (`players_presence_claim`) fija `last_seen_at = ahora` al reclamar/entrar, y un `last_seen_at` nulo (reclamos anteriores a la migración) también cuenta como conectado.

Consecuencia deliberada: un móvil en segundo plano o con la pantalla bloqueada **no late** y, tras ~40 s, se ve «Desconectado» en la TV. Es lo que se pidió (saber quién está mirando la partida), pero conviene explicárselo a los jugadores.

**Instantánea** (envoltorio `ss_get_state_pre_presence`): por jugador `retired` (siempre) y, en modo móviles, `online` (calculado por tiempo: **la vista pública no lleva marcas de tiempo**). Solo la vista del anfitrión añade `last_seen_ago_seconds`. Un jugador sin móvil (casilla libre) tiene `online = false` y la TV ya no lo dibuja (solo muestra casillas reclamadas), así que «Desconectado» significa «el móvil sigue asignado pero dejó de dar señales»; si el anfitrión libera la casilla, el jugador desaparece de la TV como antes.

**Eventos** (`game_events`, visibles en la exportación de la partida): `player_disconnected` (`reason`: `timeout` o `bye`) y `player_reconnected`, **solo cuando cambia el estado** y con la partida en curso o en pausa (en la sala de espera y al terminar no se registra nada). Los latidos normales no cambian la versión de la partida ni publican en Realtime.

## 2. Qué se ve

- **TV** (`player-card.tsx`): con la partida en curso y `online === false`, la foto se apaga (escala de grises + opacidad) y encima aparece la insignia «📵 Desconectado» (icono + texto, con `role="status"` y texto para lectores de pantalla; nunca solo color). Nombre y saldo no se tapan. Al reconectar, un «Reconectado» durante 4 s. Las transiciones se desactivan con `prefers-reduced-motion`.
- **Espectador** (`/watch`): foto apagada y etiqueta «📵 Desconectado».
- **Móvil del propio jugador:** sin cambios; si pierde la red, ya existe `ConnectionBadge`.
- **Anfitrión** (panel Jugadores): «📱 Conectado» / «📵 Desconectado hace 2 min», «🚫 Fuera de la TV» y los botones de abajo.

## 3. «Sacar de la TV» (retirado) frente a «Liberar móvil»

| | **Sacar de la TV** (`player.retire` / `player.unretire`) | **Liberar móvil** (`player.release`, ya existía) |
|---|---|---|
| Qué es | Marca `players.retired_at`. La casilla **sigue ocupada** por ese móvil. | Pone `token_hash = null`: el móvil pierde la identidad y la casilla queda libre para otro. |
| TV y espectador | No aparece **mientras dura la partida**; en la pantalla final y los resultados **sí** (con compras y saldo: la historia del dinero no se borra). | Desaparece de la TV (la TV solo dibuja casillas reclamadas) hasta que alguien la reclame. |
| Móvil | Sigue dentro, ve la subasta, pero **no puede pujar, ceder, retractarse ni reaccionar** (`player_retired`) y muestra «El anfitrión te ha sacado de la partida». Sigue latiendo. | Su móvil vuelve al selector de jugador. |
| Deshacer | «Volver a mostrar» (`player.unretire`), inmediato. | Otro móvil (o el mismo) reclama la casilla. |
| Saldo / compras | Intactos. | Intactos. |

Reglas del retirado (todo en SQL; `ss_*` con `ss_lock_game`, comprobación de anfitrión, idempotentes y con evento `player_retired`/`player_unretired`):
- **No es contendiente:** `ss_yield_pending`, `ss_all_broke` y el «nadie puede superar la puja» de `ss_bid_internal` ignoran a los retirados (copias de las últimas versiones —`9100`, `7600`, `8100`— con la única diferencia `retired_at is null`). Si todos los que quedan ceden, se adjudica sin esperarle; si solo quedan retirados con saldo, cuenta como «todos sin saldo».
- **Si va ganando una subasta abierta, el sistema no cambia nada:** la subasta sigue abierta con él como líder, el panel del anfitrión lo avisa y el anfitrión decide (cancelar o adjudicar; el cobro sigue únicamente por `ss_award_core`).
- **Bloqueo en el servidor:** `ss_assert_not_retired` envuelve `ss_player_bid`, `ss_yield_bid`, `ss_unyield_bid` y `ss_send_reaction` (patrón `…_pre_retire`); con identidad válida toma el bloqueo de la partida antes de mirar, así que una retirada concurrente no se cuela. La puja manual del anfitrión (`auction.bid`) sigue permitida.
- **Puede volver y reclamar de nuevo:** si el retirado libera su casilla y la reclama otra vez, **sigue retirado** hasta «Volver a mostrar» (evita saltarse la decisión del anfitrión saliendo y entrando).
- **«Reiniciar partida»** (vuelta a la sala de espera) devuelve a todos los retirados (disparador `games_unretire_on_reset`).
- Puede votar en la galería final (no se bloquea): la historia del jugador no se borra.

## 4. Privacidad

Se guarda **solo una marca de tiempo por jugador** (`last_seen_at`) y el último estado de conexión (booleano); sin IP, sin agente de usuario, sin ubicación. La vista pública solo recibe `online: boolean`; los segundos desde el último latido solo salen al anfitrión autenticado. Los eventos de conexión guardan el id del jugador y el motivo. Todo se borra con la partida (cascada) y por la caducidad normal de partidas. No se añade cookie ni almacenamiento local ni proveedor externo (se reutiliza la cookie técnica `ss_p_<SALA>`), por lo que **`docs/LEGAL.md` no cambia**.

## 5. Carga extra (medida y estimada)

- **Peticiones:** ≈ 1 cada 15 s por móvil con la pestaña visible = 4/min por móvil (8 móviles ≈ 32/min; 10, el máximo del producto, ≈ 40/min). Con Supabase cada latido es **una** RPC (`ss_player_ping`) sin bloqueo de la partida.
- **Contra el límite de tasa:** por jugador 30/min (7× el uso normal, deja margen a latidos extra por cambios de visibilidad); por IP+sala 300/min (10 móviles en la misma wifi usan ≈ 40); por sala 1 500/min. Los contadores son en memoria por instancia (misma limitación conocida que el resto, ver `SEGURIDAD-PLAY.md`).
- **Realtime:** los latidos normales **no** publican nada. Solo hay un aviso por cada cambio de estado (desconexión detectada o reconexión).
- **Base de datos (PGlite, un solo proceso, ruido de otras pruebas en paralelo: orden de magnitud):** `ss_player_ping` p50 ≈ 1,1 ms; `ss_presence_sweep` p50 ≈ 0,4 ms; `ss_get_state` con 10 jugadores pasa de p50 ≈ 3,3 ms a ≈ 3,9 ms por el envoltorio (un `left join` por jugador). **No medido contra Supabase real ni con Postgres 16 real** (ver `docs/RENDIMIENTO.md` para la metodología; no se ha añadido un caso al script `loadtest`).
- El barrido añade una consulta de solo lectura por cada lectura de estado (`autoAwardTick`), sin bloqueo salvo que haya una desconexión que registrar.

## 6. Limitaciones conocidas

- Recargar la página del móvil emite un `bye` (pagehide) y luego un latido: genera un par `player_disconnected`/`player_reconnected` en el registro.
- `sendBeacon` es de mejor esfuerzo: si no llega, la desconexión se detecta igualmente a los ~40 s (más hasta ~8 s de sondeo de la TV).
- Los eventos de conexión no se pintan en una vista de «Repetición» (la repetición se reconstruye de pujas y compras): solo están en la exportación de la partida (`game_events`).
- No probado contra Supabase real (RPC con `service_role`, Realtime) ni en dispositivos físicos; sí con PGlite (Vitest) y Chromium (Playwright).
