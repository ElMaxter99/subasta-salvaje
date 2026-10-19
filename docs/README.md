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
| [PLAN-PLANTILLAS-SISTEMA.md](PLAN-PLANTILLAS-SISTEMA.md) | Plan (sin implementar) de las partidas del sistema creadas por el superadmin, la imagen interna única y las fotos en un CDN externo |
| [PENDIENTE.md](PENDIENTE.md) | Tareas manuales del propietario y lo no verificado |

El `README.md` de la raíz es la guía de usuario/despliegue (muy completa). Estos documentos son la memoria técnica: **si cambias
una regla, una migración o una decisión, actualiza el documento correspondiente en el mismo cambio.**

- [`EMAILS-Y-CONTRASENA.md`](EMAILS-Y-CONTRASENA.md): recuperar contraseña y plantillas de correo de Supabase Auth.
- [`SONIDO.md`](SONIDO.md): sonidos y música sintetizados, control del anfitrión y límites.
- [`MARCA.md`](MARCA.md): identidad visual (logo, mascota oficial, tipografía, tokens, componentes y limitaciones).
- [`OPEN-GRAPH.md`](OPEN-GRAPH.md): miniaturas al compartir enlaces (invitación con código, TV, resultados).
- [`BIBLIOTECA.md`](BIBLIOTECA.md): biblioteca de medios del superadmin (subida masiva de imágenes a GitHub y catálogo general de productos reutilizable).
- [`PLAN-RELLENAR-BIBLIOTECA.md`](PLAN-RELLENAR-BIBLIOTECA.md): plan para llenar la biblioteca con cientos de fotos (fuentes CC0/dominio público, licencias, proceso) y productos de catálogo completos.
- [`FASE1-JUEGO.md`](FASE1-JUEGO.md): retractarse de ceder, pad de pujas, pausa de gracia, sonidos y premios nuevos.
- [`ESPECTADOR-Y-PODIO.md`](ESPECTADOR-Y-PODIO.md): modo espectador `/watch` e imagen del podio en tres formatos.
- [`BIBLIOTECA-ETIQUETAS.md`](BIBLIOTECA-ETIQUETAS.md): roles, categorías y etiquetas de la biblioteca, selector en la partida, cobertura y parecidas.
- [`PLANTILLAS-SISTEMA-CATALOGO.md`](PLANTILLAS-SISTEMA-CATALOGO.md): catálogo de 69 partidas del sistema (36 base + 33 variantes), validador e importador.
- [`CASAR-FOTOS-PLANTILLAS.md`](CASAR-FOTOS-PLANTILLAS.md): motor de casamiento foto↔elemento de plantilla, script y botón del admin.
- [`FUENTES-OPENVERSE-MUSEOS.md`](FUENTES-OPENVERSE-MUSEOS.md): descarga de imágenes CC0/PDM de Openverse y museos, licencias y límites.
- [`FUENTE-PODIO.md`](FUENTE-PODIO.md): fuentes TTF (Baloo 2, Nunito) de la imagen del podio y las OG, origen, licencia y regeneración.
- [`PRESETS-Y-CONTROL-MOVILES.md`](PRESETS-Y-CONTROL-MOVILES.md): presets de partida, rondas, tarjeta «¿Quién puja?» y cambios de modo a mitad de partida.
- [`PRESENCIA-Y-RETIRADOS.md`](PRESENCIA-Y-RETIRADOS.md): latido de los móviles, «Desconectado» en la TV y jugadores retirados.
- [`OBSERVABILIDAD.md`](OBSERVABILIDAD.md): errores y métricas propios, panel, alertas, privacidad y límites.
- [`CI.md`](CI.md): integración continua en GitHub Actions (qué ejecuta y qué no se ha podido verificar).
- [`SEGURIDAD-PLAY.md`](SEGURIDAD-PLAY.md): revisión de seguridad de las rutas `/api/play/*` (hallazgos, arreglos y lo no resuelto).
- [`ACCESIBILIDAD-MOVIL.md`](ACCESIBILIDAD-MOVIL.md): auditoría de accesibilidad de la vista del jugador (tamaño táctil, contraste, lector de pantalla, zoom) y lo no verificado.
- [`RENDIMIENTO.md`](RENDIMIENTO.md): prueba de carga con 10–20 móviles (`npm run loadtest`), números por motor y limitaciones.
- [`PROMPTS-IA.md`](PROMPTS-IA.md): cómo se redactan los prompts de mezcla de imágenes con IA (base cualquiera, natural y divertido), la guardia de zona y el laboratorio `npm run ai:lab`.
- [`PLANTILLAS-SISTEMA.md`](PLANTILLAS-SISTEMA.md): partidas del sistema creadas por el superadmin, fotos en un CDN externo y lista blanca de servidores.
- [`IMAGEN-INTERNA.md`](IMAGEN-INTERNA.md): formato y tamaño internos de todas las imágenes, y cómo preparar fotos para un CDN.
- [`PLANTILLAS.md`](PLANTILLAS.md): plantillas de partida (JSON) con catálogo y fotos por URL, formato y seguridad.
