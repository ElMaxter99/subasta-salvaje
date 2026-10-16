<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Subasta Salvaje · guía para agentes

Esta sección complementa el bloque de Next.js de arriba (no lo borres: `next dev` lo regenera).

**Lee, por este orden:** `CLAUDE.md` (resumen operativo y reglas) → `docs/README.md` (índice) → el documento concreto de tu tarea.

## Flujo de trabajo esperado
1. Revisa el estado actual (`git status`, `docs/PENDIENTE.md`, `docs/DECISIONES.md`) antes de proponer cambios; no reinicies ni sobrescribas trabajo existente.
2. Si hay varios agentes, reparte **archivos disjuntos** (p. ej. SQL+servicios / UI / tests / docs) y fusiona al final. Arquitectura, seguridad y revisión → modelo más capaz; implementación → equilibrado; tareas simples → rápido.
3. Cambia primero la capa autoritativa (SQL `ss_*`), después Zod/servicios, después UI; añade tests en la misma tarea.
4. Verifica: `npm run lint && npm run typecheck && npm test`, y para cambios de BD también el test de Postgres real; para UI, el e2e correspondiente; antes de cerrar `npm run build && npm run scan:secrets`.
5. Actualiza la documentación afectada (README, `docs/`, `.env.example`) y `docs/PENDIENTE.md` si hay tareas para el propietario. Registra decisiones nuevas en `docs/DECISIONES.md`.
6. Informa con honestidad: qué se verificó, qué no (servicios reales sin probar) y qué queda pendiente.

## Prohibido
Commitear secretos o `node_modules`; simular IA/despliegues; activar planes de pago; duplicar reglas de dinero en TypeScript;
editar migraciones ya aplicadas; saltarse o desactivar tests para «ponerlos en verde».
