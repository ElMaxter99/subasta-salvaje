# Documentación del proyecto

Índice para personas y para futuras sesiones de Claude. Empieza por `../CLAUDE.md` y `../AGENTS.md`.

| Documento | Para qué sirve |
|---|---|
| [ARQUITECTURA.md](ARQUITECTURA.md) | Capas, flujo de una petición, catálogo de funciones SQL `ss_*`, migraciones en orden, tiempo real, modos demo/Supabase |
| [REGLAS-DE-JUEGO.md](REGLAS-DE-JUEGO.md) | Reglas de negocio: subasta, pujas, adjudicación (manual/automática), eventos sorpresa, deshacer, galería, modos de juego |
| [IMAGENES-IA.md](IMAGENES-IA.md) | Proveedores, modos pegatinas/IA, cola de trabajos, cuotas, edición real y por composición, prompts |
| [SEGURIDAD.md](SEGURIDAD.md) | Modelo de amenazas, RLS/permisos, identidad de jugadores, secretos, límites de tasa |
| [PRUEBAS.md](PRUEBAS.md) | Estrategia de tests (Vitest/PGlite/Postgres real/Playwright), cómo ejecutarlos y trampas conocidas |
| [OPERACIONES.md](OPERACIONES.md) | Variables de entorno, despliegue en Vercel, migraciones en Supabase, cron, diagnóstico |
| [MASCOTA.md](MASCOTA.md) | Recortes de la mascota de la lámina de referencia, componentes `Mascot`/`EmptyState`, dónde aparece y qué falta |
| [ASSETS.md](ASSETS.md) | Asset pack (mascota, props, UI, VFX, marca): pipeline, formato y limitaciones |
| [DECISIONES.md](DECISIONES.md) | Registro de decisiones (qué, por qué, alternativas) |
| [HISTORIAL.md](HISTORIAL.md) | Cronología de las peticiones del propietario y lo entregado |
| [PLAN-SUPERADMIN.md](PLAN-SUPERADMIN.md) | Plan (sin implementar) del panel de superadmin: usuarios, partidas, IA/cuotas y peso de Supabase |
| [PENDIENTE.md](PENDIENTE.md) | Tareas manuales del propietario y lo no verificado |

El `README.md` de la raíz es la guía de usuario/despliegue (muy completa). Estos documentos son la memoria técnica: **si cambias
una regla, una migración o una decisión, actualiza el documento correspondiente en el mismo cambio.**

- [`MARCA.md`](MARCA.md): identidad visual (logo, mascota oficial, tipografía, tokens, componentes y limitaciones).
