# Pruebas

| Nivel | Dónde | Qué cubre |
|---|---|---|
| Unitarias/servicios (Vitest + PGlite) | `tests/*.test.ts` | Flujo completo (`game-flow`), cola de imágenes (`image-jobs`), regresiones, dominio (`domain`), móviles (`mobile-play`), Cloudflare/cuotas (`cloudflare-quota`), edición por composición (`compose-edit`), cadena de imágenes desde foto base (`base-photo-evolution`), adjudicación automática (`auto-award`), borrado (`delete-games`), seguridad (`security`), eventos/deshacer/galería (`wild-gallery-undo`) |
| Postgres 16 real | `tests/postgres-real.test.ts` (se omite sin `PG_TEST_URL`) | Aplica todas las migraciones, concurrencia entre conexiones, privilegios/RLS |
| E2E (Playwright, Chromium) | `e2e/*.spec.ts` | `flow` (TV+panel), `mobile` (móviles), `auto-award`, `lifecycle` (finalizar/borrar), `events` (a ciegas, deshacer, impuesto, galería) |

Ejecución y entorno: ver `CLAUDE.md`. Notas:
- `makeCtx()` (`tests/helpers.ts`) crea un PGlite nuevo por archivo de test; los tests de un archivo comparten BD ⇒ **acota por partida/sala** (no cuentes globalmente).
- Los proveedores de IA se simulan con `fetchImpl` inyectado o con un `ImageGenerationProvider` falso; **nunca se llama a APIs reales en tests**.
- Aleatoriedad (`doble o mitad`, probabilidad de eventos): los tests comprueban invariantes (mitad/doble, saldos) o iteran hasta ver ambos resultados.
- E2E: el servidor de desarrollo frío compila lento ⇒ la primera ejecución puede dar `ERR_ABORTED`/timeouts; repite. Usa `PW_CHROMIUM_PATH` (no ejecutes `playwright install`).
- No uses `pkill -f "next dev"` desde el propio shell (mata tu comando).
- Para validar tipo/lint de scripts nuevos: `npm run lint && npm run typecheck` (hay 2 avisos conocidos en `scripts/assets/lib.mjs`).
Antes de cerrar un cambio: lint + typecheck + `npm test` + (si toca BD) Postgres real + (si toca UI) e2e relevante + `npm run build` + `npm run scan:secrets`.

## Modo de desarrollo (solo desarrollo/pruebas; no existe en producción)

Herramienta interna para desarrollar y probar sin Supabase; **no es una función del producto**.
- **Qué es:** el servidor usa PGlite (Postgres WASM, el mismo SQL `ss_*`) con datos y imágenes en disco (`.demo-data`, o el directorio de `DEMO_DATA_DIR`), acceso de anfitrión por botón (`/api/auth/demo`, cookie `ss_demo_host`), partida de ejemplo (`/api/dev/seed`), imágenes locales (`/api/demo-images`) y un banner amarillo «MODO DEMO».
- **Cómo se activa** (`getRuntimeMode` en `src/lib/config/env.ts`): sin variables de Supabase y `NODE_ENV` distinto de `production`; o `ALLOW_DEMO_MODE=true` en un build local de producción; `FORCE_DEMO_MODE=true` lo fuerza aunque Supabase esté configurado. Sin credenciales en producción se muestra `/setup`.
- **Nunca funciona en Vercel:** el código lo bloquea (protección en implementación; nombres exactos de las variables en `src/lib/config/env.ts`).
- **Banner:** se oculta con `DEV_HIDE_BANNER=true`; lo usan las capturas del README (`node scripts/docs/screenshots.mjs`, que se generan con este modo).
- `IMAGE_PROVIDER` sigue siendo la única forma de activar IA real también en este modo; sin él solo hay pegatinas (sin IA).
