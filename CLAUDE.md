# Subasta Salvaje · guía para Claude (léela primero)

App full-stack de subastas creativas multijugador. Una **TV** (`/game/[code]/screen`) muestra la subasta en público, el
**anfitrión/gamemaster** la lleva desde un panel privado (`/game/[code]/host`) y los **jugadores** pueden pujar desde su móvil
(`/game/[code]/play`, modo «móviles»). Cada jugador tiene una «casa» (imagen) que **evoluciona** con cada compra: pegatinas
con emojis (sin IA) o edición por IA. Idioma del producto, comentarios y docs: **español**.

> Antes de tocar nada: lee `AGENTS.md` (aviso sobre Next.js 16) y el índice `docs/README.md`.
> Lo que queda por hacer del propietario está en `docs/PENDIENTE.md`. Historial y porqués: `docs/DECISIONES.md`.

## Stack
Next.js 16 App Router (`proxy.ts`, `after()`, route handlers) · TypeScript estricto · Tailwind 4 · Zod 4 · Supabase
(Postgres, Auth, Realtime Broadcast, Storage) · PGlite (Postgres WASM) para demo y tests · sharp · Vitest · Playwright.
Despliegue: Vercel (+ cron). Node ≥ 20. Panel de superadmin en `/admin` (ver `docs/PLAN-SUPERADMIN.md`, `README`).

## Comandos
```bash
npm run dev            # sin credenciales arranca en MODO DEMO (PGlite + disco local en .demo-data)
npm run lint && npm run typecheck && npm test      # comprobación rápida (≈25 s)
npm run build && npm run scan:secrets              # antes de dar nada por terminado
PG_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run tests/postgres-real.test.ts   # Postgres 16 real
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test                       # e2e (la 1.ª ejecución en frío puede ser inestable: repite)
npm run worker         # procesa la cola de imágenes en local   ·   npm run assets:build   # regenera subasta-salvaje-assets/
```
En el contenedor remoto el Postgres de pruebas puede estar parado: `pg_ctlcluster 16 main start` (contraseña de `postgres`: `postgres`).

## Regla de oro de la arquitectura
**Toda la lógica de dinero, adjudicación, imágenes y reglas vive en funciones SQL `ss_*`** (plpgsql, parámetro `p jsonb`,
errores `RAISE 'ERR:codigo'`), con bloqueo `FOR UPDATE` de la fila de la partida e idempotencia por clave. TypeScript solo
valida (Zod), autentica, llama a `ctx.db.rpc('ss_*', …)` y presenta. **No dupliques reglas en TS.** Detalle: `docs/ARQUITECTURA.md`.

## Cómo añadir una función (receta)
1. **Migración portable** `supabase/migrations/2026…_nombre.sql` + **migración de permisos** `…_security_nombre.sql`
   (`revoke execute … from public, anon, authenticated; grant … to service_role`; tablas nuevas: RLS deny-all). Las que
   contienen `_security` no se ejecutan en PGlite. Nunca edites una migración ya aplicada: crea otra.
2. Para cambiar una función grande ya existente (p. ej. `ss_get_state`) usa el patrón de **envoltorio** (`alter function … rename to …_base`) o `create or replace` copiando la última versión.
3. Acción del anfitrión: `schemas.ts` (`actionSchema`) → `toRpc` en `game-service.ts` → función `ss_*`. Errores nuevos: `errors.ts` (mensaje en español + estado HTTP).
4. Tipos en `src/lib/domain/types.ts`; UI en `src/components/{host,screen,play}`; ruta en `src/app/api/…` con `handle()`, `assertSameOrigin`, `limit()`.
5. Tests: SQL/servicios en `tests/*.test.ts` (PGlite con `makeCtx()`), flujo UI en `e2e/*.spec.ts`. Documenta en README/`docs/`.

## Reglas que no se negocian
- **Honestidad:** nunca simules IA ni despliegues. El modo pegatinas se etiqueta como «sin IA»; si algo no se ha probado contra el servicio real, dilo (README y `PENDIENTE.md`).
- **Nada de pago automático:** ningún cambio solo a un proveedor de pago; cuotas por partida/día, interruptor `IMAGE_AI_DISABLED`. No actives servicios de pago ni hagas despliegues sin autorización del propietario.
- **Secretos:** jamás en el repo, logs ni chat (`redactSecrets`, `npm run scan:secrets`, `.vercelignore`). Si el usuario pega una clave, **no la guardes** y recomienda rotarla.
- **Dinero:** céntimos enteros; cobro **una sola vez** (idempotencia + `ss_award_core` único para manual y automático). Los reintentos/restauraciones de imagen nunca tocan saldos.
- **La subasta nunca se bloquea por la IA:** si falla, se conserva la última imagen válida y se sigue.
- **Cliente vs servidor:** nada de `service_role`/`getContext` en componentes cliente (hay un test que lo vigila).
- No hagas commit de `node_modules`, `.env*`, `*.jar`, `.demo-data`, `test-results`. Commits con los trailers de atribución indicados por la sesión; rama de trabajo `claude/eager-cerf-lgnq1z`; **no crees PR si no te lo piden**.
- **README y legal siempre al día:** el `README.md` (con sus capturas de `docs/img/`, regenerables con `node scripts/docs/screenshots.mjs`) forma parte de «terminado»: al cambiar funcionalidades, scripts npm, variables de entorno, migraciones o la interfaz, actualízalo (hay un test que comprueba enlaces e imágenes). Si añades una dependencia, cookie/almacenamiento local o proveedor externo, actualiza también créditos, cookies y privacidad (`docs/LEGAL.md`). Nunca inventes datos del titular ni una licencia.
- Con varios subagentes: reparte solo archivos que no se solapan; modelo fuerte para arquitectura/seguridad/revisión, equilibrado para implementar, rápido para tareas simples.

## Mapa del repositorio
```
supabase/migrations/   SQL autoritativo (ver docs/ARQUITECTURA.md para el orden)
src/lib/domain/        schemas Zod, tipos, errores, dinero, ranking, temáticas
src/lib/services/      game-service, play-service, jobs-service, context (AppContext), seed, kick, page-data
src/lib/db/            pglite.ts (demo/tests, migraciones con seguimiento) · supabase.ts (rpc)
src/lib/ai/            proveedores de imagen (demo/pegatinas, cloudflare, openai), compose (edición gratis), prompts, validación
src/lib/{auth,security,realtime,storage,client,config}/
src/app/               páginas y /api/*      src/components/{host,screen,play,ui,landing,mascot,admin}/
public/assets/brand/   logo, mascota nueva (solo inicio y Loader), iconos (ver docs/MARCA.md; `npm run brand:build`)
public/assets/mascot/  expresiones, poses y objetos de la mascota de uso general (docs/MASCOTA.md; `npm run mascot:extract`)
tests/ e2e/ scripts/   scripts/assets/ = generador del asset pack (vectorial, no 3D)
docs/                  documentación de proyecto (índice en docs/README.md); docs/img/ = capturas del README
src/app/{legal,privacidad,cookies,creditos,licencia}/  páginas legales (footer solo en la vista inicial, nunca en /game/*)
```
