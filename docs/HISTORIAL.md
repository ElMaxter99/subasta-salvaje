# Historial de peticiones del propietario

Cronología resumida (de la más antigua a la más reciente) con lo entregado. Útil para entender el porqué de cada parte.

1. **Proyecto base:** app full-stack de subastas con IA (Next.js + Supabase + TS estricto + Tailwind), TV sincronizada, panel del anfitrión, historial/restauración, resultados, adjudicación atómica e idempotente, cola persistente de imágenes con reintentos, RLS, tests, README en español, orquestación multi-modelo y honestidad sobre IA/despliegue. «Cuando termine, ir directo a verlo y decir cómo montar el `.env`».
2. **Configuración real:** mapeo de las claves de Supabase al `.env`, aviso de rotación; probar el flujo sin IA («no voy a poner OpenAI de momento»); importar en Vercel; diagnóstico de errores (`POST /api/games` 500, `42P07`/policy ya existe, «Invalid API key» con `sb_secret_` ⇒ claves legacy).
3. **Imagen inicial común** subida o de catálogo para todos (ahorra IA).
4. **Modo móviles** (unirse con el código, pujar desde el móvil) elegido al crear la partida; comandos de migración de Supabase.
5. **Cloudflare Workers AI** como primer proveedor real con prioridades explícitas (sin despliegues ni pagos), luego **interruptor de seguridad**: 10 generaciones/partida configurable, límite diario propio, sin cambio automático a pago, indicador visible, conservar la última imagen y continuar.
6. **Primera puja** «+1 €» debe ser 1 €.
7. **Adjudicación automática** (tiempo desde la última puja o instantánea si nadie puede superar).
8. **Modo pegatinas con emojis** vs **modo IA** seleccionable por partida (la IA no funcionaba aún; los emojis gustaron).
9. **Finalizar desde pausa, borrar desde Ajustes, borrado automático a las 12 h.**
10. **Credenciales de Cloudflare** pegadas en el chat (no guardadas; asegurar que no se filtran al desplegar ⇒ `scan:secrets`, `.vercelignore`, `redactSecrets`) y **lista de pendientes** del propietario (`PENDIENTE.md`).
11. **Imagen inicial para jugadores actuales y/o nuevos** (subir/galería/generar) cuando el anfitrión está solo.
12. **Asset pack** a partir de la hoja de referencia y la especificación JSON (vectorial, honesto sobre no ser 3D).
13. **Ver pendientes** (el propietario pospone `supabase db push` hasta juntar más cosas).
14. **IA gratuita que supla la edición** ⇒ edición por composición; luego **edición real con foto** (FLUX.2 klein por defecto) + plan B. Objetivo: el anfitrión sube una foto base y cada jugador la evoluciona (verificado con test).
15. **Ideas extra** y elegidas **5, 1, 2:** deshacer adjudicación, galería final con votación, eventos sorpresa. (Propuestas aún sin hacer: pausa de emergencia/reparto manual de saldo, registro exportable CSV, plantillas de partida, catálogos CSV, tiempo extra, sonido, accesibilidad móvil, efectos y mascota en la TV.)
16. **Documentación para futuras sesiones** (este conjunto: `CLAUDE.md`, `AGENTS.md`, `docs/*`).
17. **Imagen base única:** al generar la imagen inicial con IA debe ser la misma para todos los jugadores, se unan cuando se unan (job `base`, migraciones 2000/2100).
18. **Plan de superadmin** (usuarios, partidas, accesos de IA y peso de Supabase free tier): documentado en `docs/PLAN-SUPERADMIN.md`, pendiente de decisiones y de implementar.

## Estado actual (resumen)
Todo lo anterior está implementado y subido a `claude/eager-cerf-lgnq1z` (sin PR). Migraciones hasta `…2100`. Tests: 124 unitarios + 9 de Postgres real + 5 e2e. Pendiente del propietario: rotar claves,
aplicar migraciones 1000–1900, variables en Vercel, probar IA y Realtime/Storage reales (ver `PENDIENTE.md`).
