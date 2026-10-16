# Seguridad

## Modelo
- **Base de datos:** RLS activada con política *deny-all* para `anon` y `authenticated` en todas las tablas; `EXECUTE` de todas las funciones revocado a
  `public/anon/authenticated` y concedido solo a `service_role` (cada migración `_security_` lo repite). Solo el servidor (clave `service_role`) habla con la BD.
- **Anfitrión:** autenticado con Supabase Auth (cookies SSR). `ALLOWED_HOST_EMAILS` restringe quién puede crear/gestionar partidas (recomendado: el registro es abierto
  y cada anfitrión puede gastar cuota de IA). Cada función `ss_*` de anfitrión comprueba `host_id` (`not_host`).
- **Jugadores (móvil):** sin cuenta. Token aleatorio de 32 bytes en cookie `ss_p_<SALA>`; en BD solo su `sha256`. La identidad nunca viaja en el cuerpo. Un token por casilla.
  Límites de tasa por IP/sala y por jugador (`lib/auth/rate-limit.ts`, `limit()` en las rutas) **antes** de consultar la BD; `assertSameOrigin` contra CSRF.
- **Entradas:** Zod en el borde y comprobaciones en SQL; subida de imágenes validada por bytes y tamaño; SVG solo de proveedores/galería propios.
- **Cron:** `/api/jobs/process` y `/api/jobs/purge` exigen `Authorization: Bearer $CRON_SECRET`.
- **Contenido:** el panel solo es del anfitrión; las vistas públicas no incluyen `host_id`, trabajos ni prompts.

## Secretos
- Solo en variables de entorno (`.env*` ignorados; `.vercelignore` impide subirlos con la CLI). Nada con `NEXT_PUBLIC_` salvo URL y anon key de Supabase.
- `redactSecrets` (`security/redact.ts`) limpia mensajes de error antes de guardarlos/mostrarlos. `npm run scan:secrets` revisa archivos versionados, historial y el bundle del navegador.
- Un test (`tests/security.test.ts`) impide importar módulos de servidor (`service_role`, `getContext`) desde componentes cliente.
- **Si el usuario pega una clave en el chat:** no la copies a ningún archivo ni la repitas; recomienda rotarla (`PENDIENTE.md` §1). Ya ocurrió con la clave de Cloudflare y la `sb_secret_` de Supabase.
- No subir `*.jar`/cookies, `.demo-data`, `test-results` (en `.gitignore`).

## Integridad del dinero
Cobro una vez (idempotencia + `ss_award_core` único), saldos nunca negativos (CHECK), bloqueo por partida, `clock_timestamp()` para el orden de pujas, restauración/reintento de imágenes
sin tocar saldos. Probado con concurrencia real en `tests/postgres-real.test.ts` (doble adjudicación simultánea, workers en paralelo sin deadlocks).

## Límites y riesgos conocidos
- Puja a ciegas: el rechazo de pujas bajas filtra una cota inferior (documentado).
- Los tokens de móvil de partidas `mobile` sobreviven a `finished` (solo permiten votar la galería); caducan con el borrado a las 12 h.
- Realtime/Storage reales de Supabase no verificados en este entorno (`PENDIENTE.md` §7).
