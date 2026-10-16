# Registro de decisiones

Formato: **decisión** — por qué — alternativas descartadas. Añade aquí cada decisión nueva (con fecha aproximada si procede).

## Arquitectura
1. **Lógica en funciones SQL `ss_*`, no en TypeScript** — una sola fuente de verdad atómica y transaccional, reutilizable en Supabase, PGlite y tests; evita carreras de dinero. — Descartado: lógica en route handlers con varias consultas (carreras, doble cobro).
2. **PGlite para demo y tests** — la app funciona sin credenciales y los tests ejercitan el SQL real; Postgres real se verifica aparte (concurrencia/privilegios). — Descartado: mocks de BD.
3. **Bloqueo por partida (`FOR UPDATE`) + claves de idempotencia** — serializa y hace seguros los reintentos/dobles clics.
4. **RLS deny-all + EXECUTE solo a `service_role`** — el navegador nunca toca la BD; toda operación pasa por el servidor.
5. **Realtime Broadcast + sondeo + `version`** — robusto si el WebSocket falla; las instantáneas atrasadas se descartan.
6. **`ss_award_core` único** para adjudicación manual y automática — garantiza «cobrar una sola vez».
7. **Envoltorio de `ss_get_state`** (`ss_get_state_base`) para añadir `gallery`, `wild_tax` y enmascarar la puja a ciegas — evita copiar una función de 120 líneas otra vez.
8. **Migraciones inmutables + `_security_` aparte** — el propietario las aplica con `supabase db push`; PGlite solo ejecuta las portables y lleva registro (`ss_migrations`).

## Producto
9. **Modos de partida `host`/`mobile`** — sala de TV tradicional o móviles; se elige al crear y se puede cambiar. Identidad por cookie con token hasheado (sin cuentas para jugadores).
10. **Primera puja «+1 €» = 1 €** (no 2 €): la base sin pujas es 0 y la puja mínima actúa de suelo.
11. **Adjudicación automática** configurable (tiempo desde la última puja o instantánea si nadie puede superar) — para que el anfitrión no tenga que pulsar siempre; reutiliza el mismo núcleo de cobro.
12. **Modo de imágenes por partida (`stickers`|`ai`)** — las pegatinas con emojis gustaron y son gratis; la IA es opt-in, con cuotas. Antes, sin IA, el juego quedaba mudo.
13. **Imagen inicial común** (subida/galería/generada) para jugadores actuales y/o nuevos — ahorra IA y deja a todos en la misma casa.
14. **Finalizar desde pausa, borrar desde Ajustes y borrado automático a las 12 h** — limpieza y privacidad sin intervención.
15. **Eventos sorpresa: ciegas / doble o mitad / impuesto** — variedad de juego sin tocar el núcleo (solo `ss_award_core` y el anuncio). El impuesto es redistributivo (suma constante) para no destruir dinero.
16. **Deshacer solo la última adjudicación** — mantiene coherente la cadena de imágenes de cada jugador; la versión generada se conserva en el historial.
17. **Galería con votación solo en modo móvil y recuento oculto hasta cerrar** — suspense; tokens de móvil sobreviven a `finished` para poder votar (alternativa descartada: borrarlos al cerrar, porque el móvil perdía la pantalla de resultados).

## IA
18. **Cloudflare Workers AI primero** (flux-1-schnell para generar; flux-2-klein para editar) por su cuota gratuita; OpenAI queda como alternativa de pago opt-in.
19. **Ninguna credencial activa la IA por sí sola; nunca cambio automático a un proveedor de pago**; cuotas 10/partida y 50/día propias; `IMAGE_AI_DISABLED`; indicador visible; si falla se conserva la última imagen y la subasta continúa.
20. **Edición real con plan B por composición** — el usuario quiere que cada jugador «evolucione» una foto base; si el modelo de edición rechaza la entrada se pega el objeto generado (collage honesto) en vez de fallar.
21. **Mensajes honestos** — lo no probado contra servicios reales se documenta (`PENDIENTE.md`); el proveedor demo se rotula «sin IA».

## Seguridad y proceso
22. **Los secretos pegados en el chat se consideran comprometidos** — no se guardan; se recomienda rotarlos. Escáner de secretos y `.vercelignore`.
23. **No desplegar ni activar pagos sin autorización.** Las migraciones nuevas las lanza el propietario cuando junte varias («lanzarlo todo de golpe»).
24. **Asset pack vectorial** (no 3D) porque no hay generador de imágenes; documentado como limitación.
25. **Documentación en español** y viva: README (usuario), `docs/` (memoria técnica), `CLAUDE.md`/`AGENTS.md` (agentes).
26. **La imagen inicial «generada para todos» es una sola imagen compartida** (job `base`) — el propietario quiere la misma casa base para todos, vengan cuando vengan; además cuesta una sola generación. Generación individual por jugador se mantiene como opción.
27. **Superadmin único por correo (`SUPERADMIN_EMAILS`), sin MFA por ahora** — decisión del propietario: es el único administrador; MFA queda pendiente.
28. **Registro abierto con interruptor + invitaciones por correo** — el cierre se aplica en la app (no se puede cerrar el alta de Supabase Auth desde aquí); quien ya tenía partidas conserva el acceso.
29. **Borrar un usuario borra todo lo relacionado** (cuenta de Auth, partidas, archivos); el historial de uso de IA se conserva sin datos personales para no falsear cuotas.
30. **Dashboard de auditoría, sin alertas** — solo estadísticas de cuota de IA y peso de Supabase.
31. **Borrado automático a los 7 días sin actividad, configurable en `/admin`** (antes 12 h): sustituye la retención por versiones; ajustes en BD con prioridad sobre el entorno.
32. **`image_usage` desvinculada de `games`** — con la FK en cascada, borrar una partida devolvía cuota diaria y borraba el historial.
