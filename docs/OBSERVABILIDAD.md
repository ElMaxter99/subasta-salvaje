# Observabilidad: errores y métricas de uso

Para saber si la app falla y cómo se usa **sin servicios externos**: todo se guarda en la propia base de datos (Supabase/PGlite) y se lee en
`/admin/observabilidad` (solo superadmin). La lógica de agregación está en SQL (`ss_obs_*`, migración `20260101009900_observability.sql` + permisos
`…009901_security_observability.sql`); TypeScript solo prepara, sanea y presenta.

> Regla de oro: **la observabilidad nunca rompe ni ralentiza el juego.** Todo va en `try/catch`, fuera de la petición (`after()` de Next o llamada suelta)
> y, si falla, se ignora. Los contadores se acumulan en memoria y se vuelcan por lotes.

## Qué se captura

| Qué | Dónde se captura | Tabla |
|---|---|---|
| Errores `internal`/5xx de rutas API | `handle()` (`src/lib/api.ts`) | `app_errors` |
| Errores de renderizado de servidor y rutas sin `handle()` | `src/instrumentation.ts` (`onRequestError`) | `app_errors` |
| Errores del navegador (`window.onerror`, promesas rechazadas, `error.tsx`, `global-error.tsx`) | `ErrorReporter` + `POST /api/telemetry/error` | `app_errors` (origen `client`) |
| Fallos de los endpoints de cron (`/api/jobs/*`) | `handle()` (origen `cron`) | `app_errors` |
| Peticiones API por familia de rutas × clase de estado (2xx/3xx/4xx/429/5xx) y latencia por cubos | `handle()` → acumulador en memoria → `ss_obs_incr` | `usage_metrics` (`req.*`, `lat.*`) |
| Errores de dominio esperados (400/409/429…) | solo recuento (`derr.<código>`), no entran en `app_errors` | `usage_metrics` |
| Partidas creadas/empezadas/terminadas, jugadores unidos por móvil, subastas anunciadas/adjudicadas/canceladas/perdidas, pujas, cesiones, reacciones | `ss_obs_rollup` lee `game_events`, `games` y `game_reactions` (idempotente, nunca baja un valor) | `usage_metrics` |
| Imágenes por proveedor y fallos de IA | **no se duplica**: el panel reutiliza `ss_admin_stats_ai` (auditoría de IA existente) | — |

El rollup de juego se ejecuta al abrir el panel y en el cron diario (`/api/jobs/purge`, 04:30 UTC), antes de que la purga de partidas caducadas borre sus eventos.

### Agrupación por huella
`fingerprint = md5(origen | ruta normalizada | código | mensaje sin números, UUID ni hexadecimales)`. Una fila por huella con total de repeticiones, primera/última vez,
estado (`new` → `seen` → `resolved`) y gravedad (`high`: servidor/cron/job o `error.tsx`; `low`: errores sueltos del navegador). Las repeticiones por ventana salen de
`app_error_hourly` (recuento por hora → «24 h» y «7 d»). Un grupo **resuelto que vuelve a ocurrir se reabre solo** (`reopened_at`).

## Qué NO se guarda (privacidad)
- **Nada de** tokens, cookies, cabeceras, cuerpos de petición, contraseñas, claves, correos, nombres de jugadores.
- **Ninguna IP, ni en claro ni en hash.** El endpoint del navegador usa la IP solo como clave **en memoria** del limitador de tasa (hasheada con SHA-256 y sin persistir).
- El texto pasa por `sanitizeText` (TS: `redactSecrets` + correos, IPv4, `cookie/token=valor`, consultas `?…` de URL) y por una segunda barrera en SQL (`ss_obs_clean`), y se trunca (mensaje 400 car., pila 1500).
- La ruta se normaliza (`/api/play/:id/bid`, sin consulta). Solo se guarda aparte el **código de sala** (público para quien está en la partida) para localizar el fallo; el reporter del navegador lo sustituye por `:code`.
- Se guarda versión (`VERCEL_GIT_COMMIT_SHA`/`APP_RELEASE`, 12 car.) y entorno (`VERCEL_ENV`/`NODE_ENV`).
- **Sin cookies ni `localStorage`/`sessionStorage` nuevos**: el reporter deduplica en memoria de la pestaña (máx. 5 envíos por carga). `STORAGE_INVENTORY` no cambia. Ver `LEGAL.md` y `/privacidad`.
- Aun así un mensaje de error de una librería podría contener texto libre inesperado: por eso las tablas están en RLS deny-all, solo las lee el superadmin y se purgan a los 30 días.

## Retención y límites
- **Retención** de errores: 30 días por defecto, configurable 1–365 en *Observabilidad → Alertas y retención* o en *Ajustes* (`obs_retention_days`, auditado). Purga con el cron diario (`ss_obs_purge`) o a mano («Purgar ahora»).
- **Tope duro:** 500 grupos de error (al superarlo se descartan primero los resueltos y luego los menos recientes) y 20 000 filas horarias. Métricas diarias: 400 días.
- Endpoint del navegador: mismo origen, cuerpo ≤ 4 KB, 6 envíos/min por cliente y 120/min por instancia (en memoria, por instancia serverless).
- Métricas de peticiones **aproximadas**: se vuelcan cada ~10 s o 150 contadores por instancia; lo que quede en una instancia que se apaga antes del volcado se pierde. La latencia es por cubos (≤50, 100, 250, 500 ms, 1, 2,5, 5 s, >5 s) y el p50/p95 es la **cota superior del cubo**.

## Cómo leerlo (`/admin/observabilidad`)
1. **Alertas** (arriba, en rojo y con `role="alert"`): pico de errores graves (≥ 10 en la hora y ≥ 3× la media horaria de las 24 h previas) o error grave nuevo/reabierto en 24 h.
2. **Salud:** errores 24 h / 7 d, grupos abiertos, tasa de 5xx y 429 de 7 días, tabla por familia de rutas (p50/p95) y, plegado, el recuento de errores de dominio esperados.
3. **Errores agrupados:** filtros (estado, origen, gravedad, texto), pila plegable, botones *Visto* / *Resuelto* / *Reabrir* (acción auditada `error_status`) y en bloque; **Exportar CSV** (con defensa contra inyección de fórmulas).
4. **Uso diario:** gráficas SVG propias de 30 días (sin librerías), cada una con su descripción accesible y la tabla equivalente; CSV de uso; imágenes por proveedor desde la auditoría de IA.

## Alertas por correo (opcional)
- Interruptor `obs_alert_email` en *Ajustes* y en la propia página (**desactivado por defecto**).
- Solo se envía si además hay **Resend configurado** (`RESEND_API_KEY` + `MAIL_FROM`) y correos en `SUPERADMIN_EMAILS`, existe una alerta real y no se envió otro correo en las últimas 6 horas (reserva atómica `ss_obs_alert_claim`). Sin Resend **no se envía nada** y el panel lo dice.
- El correo solo lleva recuentos, ruta y código, nunca mensajes de error. Se comprueba al registrar un error grave nuevo y en el cron diario.

## Opciones externas (NO integradas)
Si algún día se quisiera más detalle, Sentry o PostHog tienen plan gratuito, pero implican un proveedor nuevo, cookies/almacenamiento o envío de datos a terceros (y actualizar créditos, privacidad y cookies). Es solo una opción; no hay ningún SDK en el proyecto.

## Qué no se ha probado / limitaciones
- **Contra un Supabase real:** las migraciones y las funciones `ss_*` se probaron en PGlite (Postgres WASM). No se ha ejecutado `…009901_security_observability.sql` ni las funciones contra Supabase/Postgres real (`tests/postgres-real.test.ts` no las cubre). Revisar tras `supabase db push`.
- No se ha probado el envío real de correo con Resend (los tests simulan `fetch`); ni `onRequestError` de Next en un despliegue de Vercel; ni el volcado de contadores en un entorno serverless con muchas instancias.
- Las métricas de peticiones sólo cuentan rutas envueltas en `handle()` (no `/api/health`, `/api/demo-images` ni `/api/catalog/initial`) y no las páginas; el tráfico de la TV por Realtime no pasa por el servidor.
- Sin Realtime/WebSocket: no se mide la caída de conexiones de los móviles.
- Los errores del navegador dependen de que el navegador llegue a ejecutar el reporter; un fallo de carga total del JS no se verá.

## Pruebas
`tests/observability.test.ts` (saneado, agrupación por huella, reapertura, estados auditados, purga y tope, métricas y percentiles, rollup, fallo de BD que no rompe `handle()`, alertas y correo, CSV), `tests/observability-telemetry.test.ts` (endpoint del navegador: origen, tamaño, tasa, sin IP) y `e2e/observability.spec.ts` (superadmin ve la página, error agrupado, 404 para los demás, CSV).
