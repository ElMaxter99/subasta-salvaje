# Entrega «social» (reacciones, compartir resultado, repetición)

## Viñetas para el README
- **Reacciones del móvil a la TV:** en modo móviles, el jugador identificado envía emojis (👏😱😂🔥😭🤑🎉🤯) durante la partida activa y flotan por la TV (con `prefers-reduced-motion` no se mueven; «pop» suave solo en la TV). Límite en SQL: 1 cada 1,5 s por jugador y 50/min por partida; se conservan las últimas 50.
- **Compartir el resultado:** botón «Descargar imagen del podio» en resultados, en la vista final y en el móvil; PNG público `GET /api/public/games/[code]/podium` (solo partida terminada; nombres, puntos en Ohros y casas finales; quien nunca entró no sale).
- **Repetición (anfitrión):** `/game/[code]/replay`, línea de tiempo de rondas (elemento, ganador, precio, pujas, perdidos/cancelados) y reproducción paso a paso de cómo evoluciona cada casa. Solo lectura.

## Texto para DECISIONES
- Reacciones: tabla `game_reactions` (RLS deny-all) y `ss_send_reaction` con identidad por token de jugador; los límites viven en SQL. La instantánea las expone 10 s (`reactions`) y la TV anima solo las nuevas vistas en directo (como el aviso de «sin vender»). Lista cerrada de 8 emojis duplicada en `REACTION_EMOJIS` (Zod) y en la función SQL.
- Imagen del podio con `next/og` (sin dependencias nuevas), solo con datos públicos de la instantánea.
- Repetición: `ss_get_replay` (solo anfitrión) aporta las rondas; las versiones de imagen salen del snapshot del anfitrión (`versions`, `source_purchase_id`).

## Migraciones
- `20260101008000_reactions.sql` + `20260101008001_security_reactions.sql`
- `20260101008010_replay.sql` + `20260101008011_security_replay.sql`

## Pendientes / no probado
- Las migraciones `_security_` no se ejecutan en PGlite: no probadas contra Supabase real. El sonido de reacción y las animaciones no se han oído/visto en un dispositivo real.
- La imagen del podio con casas depende de que el almacenamiento sirva las imágenes; si falla, se genera sin casas.

## Cómo probarlo
`npm test` (tests/social.test.ts) y `rm -rf .next-e2e .demo-data-e2e; flock /tmp/ss-e2e.lock env PW_CHROMIUM_PATH=... npx playwright test e2e/social.spec.ts`.
