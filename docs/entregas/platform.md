# Entrega «platform» (CI, exportación de partida, accesibilidad)

## Viñetas para el README
- **Integración continua** (`.github/workflows/ci.yml`, ver `docs/CI.md`): lint, tipos, tests, build y `scan:secrets`; trabajo aparte con Postgres 16 real y otro con e2e de Playwright (Chromium). Sin secretos.
- **Exportar partida (ZIP)**: Ajustes del anfitrión → «Exportar partida (ZIP)» (`GET /api/games/[code]/export`). Incluye `partida.json` (ajustes, jugadores con saldo final, catálogo, subastas, pujas, compras en céntimos y Ohros, eventos y resultados), una carpeta por jugador con las imágenes de su historial guardadas en Storage y `LEEME.txt`. Las imágenes https alojadas se listan, no se descargan.
- **Accesibilidad**: enlace «Saltar al contenido» (no en la TV), contrastes de texto corregidos a 4.5:1 (`node scripts/a11y/contrast.mjs`), nombres accesibles, y `e2e/a11y.spec.ts`.

## Texto para DECISIONES
- La exportación reutiliza un escritor ZIP propio y mínimo (`src/lib/domain/zip-write.ts`, sin dependencias nuevas) y emite en streaming. Los datos se reúnen en `ss_export_game` (solo lectura, comprueba propietario y omite `token_hash`, `host_id` y `actor_id`). Límites: 600 imágenes / 40 MB; 5000 eventos; 6 peticiones por 10 min. Es GET de solo lectura, por eso sin `assertSameOrigin`.
- La CI usa el Chromium de Playwright (no `PW_CHROMIUM_PATH`). El texto tenue `text-white/30..45` pasó a `/55` para cumplir 4.5:1 sin cambiar la identidad visual.

## Migraciones
- `20260101008400_export_game.sql` (`ss_export_game`, stable, solo lectura) y `20260101008401_security_export_game.sql`.

## Pendientes
- **No verificado**: el workflow nunca se ha ejecutado en GitHub (ver `docs/CI.md`).
- **Traducción al inglés / i18n: NO hecha.** Propuesta: extraer los textos a diccionarios `es`/`en` por ámbito (landing, anfitrión, jugador, TV, errores de `errors.ts`), segmento de ruta o cookie de idioma con `es` por defecto, `lang` dinámico en `<html>`, formateo con `Intl` (Ohros, fechas) y plantillas de correo por idioma; empezar por landing y móvil del jugador. Requiere decidir librería (o diccionario propio), alcance y revisión humana de las traducciones.
- Auditoría con lector de pantalla real y con axe no realizada (solo comprobaciones automáticas propias y revisión manual).

## Cómo probarlo
`npx vitest run tests/ci-workflow.test.ts tests/export-game.test.ts`; `node scripts/a11y/contrast.mjs`; e2e: `rm -rf .next-e2e .demo-data-e2e; PW_CHROMIUM_PATH=... npx playwright test e2e/a11y.spec.ts`.
