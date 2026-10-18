# Integración continua (GitHub Actions)

Workflow: `.github/workflows/ci.yml`. Se ejecuta en cada `push` y `pull_request`. Node 20, caché de npm, sin secretos (la app arranca en modo demo).

| Trabajo | Qué hace |
|---|---|
| `checks` | `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` → `npm run scan:secrets` (con historial completo de git) |
| `postgres` | Servicio `postgres:16` y `PG_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres`; ejecuta `tests/postgres-real.test.ts` |
| `e2e` | `npx playwright install --with-deps chromium` y `npx playwright test`; si falla, sube `test-results/` y `playwright-report/` como artefacto (7 días) |

`tests/ci-workflow.test.ts` comprueba que el workflow existe, que cada `npm run <script>` que menciona está en `package.json` y que no hay secretos en él.

## Qué NO está verificado (no corre fuera de GitHub)
Este workflow **no se ha ejecutado nunca**: se escribió y se validó solo como YAML (con `js-yaml`) y con el test anterior. Quedan sin comprobar:
- Que las acciones (`actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`) y el servicio `postgres:16` funcionen tal cual en el runner.
- Que `npm ci` pase en el runner (depende de `package-lock.json` y de que `sharp` descargue su binario).
- Que `npx playwright test` sea estable en frío en el runner: el propio `CLAUDE.md` avisa de que la primera ejecución puede ser inestable. Si hay fallos intermitentes, valorar `retries` en `playwright.config.ts` (no se ha tocado) o ejecutar solo un subconjunto.
- Que `scan:secrets` con `fetch-depth: 0` no dé falsos positivos en el historial.
- Tiempos y límites de minutos del plan gratuito de GitHub.
- No hay `PW_CHROMIUM_PATH` en CI: se usa el Chromium que instala Playwright. En local sigue valiendo la variable (ver `playwright.config.ts`).

Primera comprobación recomendada: abrir un PR de prueba y revisar la pestaña Actions. No se ha activado ninguna protección de rama ni despliegue.
