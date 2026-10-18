# Seguridad de las rutas de jugador (`/api/play/[code]/*`)

Revisión de `bid`, `join`, `leave`, `me`, `react`, `vote` y `yield`. Migración: `20260101009200_play_hardening.sql` (+ `_security_`). Tests: `tests/play-security.test.ts`.

## Arreglado
- **Límites por sala saltables:** la clave usaba `code.toUpperCase()` sin `trim()`, pero la sala se valida con `trim()`: `ABCD`, `abcd` y `ABCD%20` eran la misma sala con cubos distintos. Ahora `roomKey()` (`src/lib/api.ts`) normaliza límites y nombre de cookie.
- **Límite sin depender de la IP:** `X-Forwarded-For` solo es fiable en Vercel. `bid/react/vote/yield` añaden un tope por sala (600/min) y `me` tiene límite (antes ninguno).
- **Bloqueo anónimo de la partida:** las acciones tomaban `FOR UPDATE` de la partida antes de comprobar el token. Ahora, sin identidad válida, la ruta corta con `not_player` tras una lectura sin bloqueo; además ya no distingue «sala inexistente» de «token inválido».
- **Tamaño de cuerpo:** `readJson()` limita a 2 KB (413) en lugar de `req.json()` sin tope.
- **Ceder la puja en una subasta a ciegas** revelaba al líder oculto (`yield_leader` solo le salía a él) y `all_yielded` público dependía del importe oculto. Ahora, a ciegas, la cesión del líder se registra como la de cualquiera y la vista pública no expone `all_yielded`.

## Revisado y correcto
- Cookie `ss_p_<SALA>` (una por sala): `HttpOnly`, `SameSite=Lax`, `Secure` en producción, `path=/`, 3 días. Token de 32 bytes aleatorios; en BD solo su SHA-256. La identidad nunca sale del cuerpo (los esquemas Zod no la admiten).
- Errores: `handle()` solo devuelve `{code, message}` de `ERROR_MESSAGES`; los errores no de dominio se registran redactados y salen como `internal`. Códigos como `player_taken`/`duplicate_name` son necesarios para la UX de unirse.
- Idempotencia: `bid` por `idempotency_key`; `yield` y `leave` son idempotentes por naturaleza; `react` limitado en SQL (1,5 s por jugador, 50/min por sala); `vote` es un upsert.
- Estados: `bid`/`yield` rechazan pausa y subasta cerrada; `react` solo en `active`; `vote` solo con la partida terminada; sobre cerrado no admite ceder.

## No arreglado (decisión de producto)
- **A ciegas, `bid_too_low` y `already_leading` permiten sondear el importe y el líder ocultos** (una puja baja se rechaza sin coste). Cerrarlo exige aceptar pujas no ganadoras en silencio, lo que cambia `bids_count`, el reloj de adjudicación (se calcula con la última puja) y el feedback de la UI. Mitigación actual: límite de frecuencia por jugador (60/min). Si se quiere cerrar, hará falta registrar esas pujas como no líderes y excluirlas del reloj.
- **IP en `X-Forwarded-For`** fuera de Vercel sigue siendo falsificable; por eso se añadieron los topes por sala y por jugador. Los contadores son en memoria por instancia (limitación conocida de serverless).
