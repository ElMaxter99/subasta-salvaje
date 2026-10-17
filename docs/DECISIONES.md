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
33. **Mascota: recortes de la lámina con honestidad sobre la transparencia** — la ropa azul marino no se separa del fondo automáticamente; se conserva el fondo con bordes difuminados y un `tile` del mismo color en vez de simular un PNG transparente. Los objetos de colores vivos sí tienen transparencia real. La mascota contextual de la TV va en la cabecera para no tapar información.
34. **La foto del elemento es la referencia de la edición** — para que el objeto comprado se parezca a su ficha del catálogo (conejo rosa con lazo azul), la edición recibe casa + foto del elemento. La foto puede subirla el anfitrión o generarla la IA. Sin foto se mantiene la edición solo con texto. En el plan B por composición se pega la propia foto (recortada o enmarcada).
35. **El avance automático lo mueve quien lee el estado** (TV/móvil/panel), igual que la adjudicación automática: no hay proceso en segundo plano en Vercel/Supabase gratuitos. Coste: necesita una pantalla abierta. Alternativa descartada: cron por minuto (límite del plan Hobby).
36. **Una ronda = una subasta adjudicada**; las canceladas/saltadas no cuentan. Al agotarse el máximo la partida termina tras 8 s (para ver el «¡Adjudicado!»).
37. **Imagen inicial obligatoria** (antes recomendada): sin casa de partida la subasta no tiene sentido visual y la edición por compra falla.
- **Registro cerrado (#38):** el formulario de alta pasa por `POST /api/auth/signup`, que consulta `ss_signup_allowed` (registro abierto o correo invitado) antes de llamar a Supabase Auth; la pantalla de login oculta «Crear cuenta» si está cerrado. Limitación documentada: `signUp` directo contra Supabase con la clave pública sigue posible (sin acceso a la app); se cierra desactivando los registros en Supabase Auth.
- **Identidad de marca (#39):** el propietario descartó sustituir la mascota: se recuperan las expresiones y poses antiguas y la mascota del logo nuevo (un solo dibujo) solo se usa en el inicio y en el Loader. Baloo 2 para títulos/cifras y Nunito para texto, con @font-face propio (ver #42). Ver docs/MARCA.md.
- **loading.tsx raíz descartado (#40):** un `app/loading.tsx` en la raíz envuelve todo en Suspense y hace que `notFound()` y `redirect()` del servidor dejen de dar 404/307 (p. ej. `/admin` para un anónimo devolvía 200 y revelaba el panel). El Loader de marca vive en `app/game/[code]/loading.tsx`; no pongas loading.tsx en rutas que usan notFound/redirect.
- **Sonido (#41):** síntesis Web Audio sin archivos; interruptores de la partida (efectos/música de la TV) en BD para que el anfitrión silencie la TV desde su panel, más preferencias locales por dispositivo. Ver docs/SONIDO.md.
- **Fuentes sin next/font (#42):** con `next/font` (google y local) el servidor de desarrollo entró en un bucle de recargas de página; no se llegó a aislar si la causa era la fuente o una caché `.next-e2e` corrupta (borrarla lo arregló). Por robustez los woff2 viven en `public/assets/fonts` con `@font-face`. **Si la página se recarga sola en dev/e2e, borra `.next-e2e` (o `.next`).**
- **Recuperar contraseña (#43):** rutas /api/auth/forgot, /auth/callback (token_hash/verifyOtp) y /api/auth/reset; plantillas de correo con la marca en supabase/templates (los envía Supabase, no la app). Ver docs/EMAILS-Y-CONTRASENA.md.
- **Open Graph (#44):** imágenes dinámicas por enlace (invitación con el código de sala por decisión del propietario, TV, resultados); rutas privadas con noindex. Ver docs/OPEN-GRAPH.md. Nota: el servidor de desarrollo de este sandbox entra a veces en un bucle de recargas (producción estable); si ocurre, borra .next-e2e.
- **Podio y cierre automático de la votación (#45):** la galería se cierra sola cuando han votado todos los jugadores conectados (mín. 2; migraciones 3200/3300) y la TV/resultados pasan al podio (`podium.tsx`, `computePodium`: empates comparten escalón, 3 escalones). El anfitrión sigue pudiendo cerrarla a mano. La votación de los jugadores NO altera la «clasificación» configurada (saldo/elementos/votos del anfitrión).
- **Mini héroe vectorial (#46):** opción B del estudio de Blobatar (descartado: solo dibuja cuerpo y ojos, no corona ni visor). Dibujo propio de ≈ 0,8 KB con 6 gestos, usado en tamaño `xs` y como favicon. Ver docs/MARCA.md.
- **Asistente de nueva partida en 6 pasos (#47):** «Cómo jugáis» se dividió en «Quién puja» y «Las casas» para que cada pantalla quepa sin scroll (móvil y TV).
- **Plantillas de partida, fase 1 (#48):** JSON `subasta-salvaje/plantilla@1` (claves en español, euros) que rellena el asistente y salta al resumen; exportación desde Ajustes; fotos del catálogo por URL descargadas en servidor con defensas SSRF y sin bloquear la creación. Ver docs/PLANTILLAS.md.
- **Plantillas, fase 3 (#49):** CSV de catálogo y ZIP (plantilla.json + fotos/) leídos en el navegador con lector ZIP propio (DecompressionStream, sin dependencias) y límites contra zip bombs; las fotos incrustadas se suben tras crear la partida. Ver docs/PLANTILLAS.md.
- **Plantillas guardadas (#50):** tabla `host_templates` (máx. 20 por anfitrión, nombre único por anfitrión, RLS cerrada, borrado en cascada desde el superadmin). No se comparten entre anfitriones. Ver docs/PLANTILLAS.md.
- **Editor de catálogo en el asistente (#51):** se edita en el Resumen (no es un paso más, para no alargar el asistente); `catalog-editor.tsx` valida como el servidor.
- **Licencia MIT (#52):** el propietario delegó la elección («todo gratis»). MIT para el código (todas las dependencias son MIT/Apache-2.0/ISC, compatibles); la marca (nombre, logo, mascota) queda fuera y con derechos reservados. Titular del copyright: «ElMaxter99 y colaboradores» (cuenta del repo; sin inventar nombre real). Ver docs/LEGAL.md.
- **Aclaración de licencia (#53):** repo público, sin marca registrada, logo y mascota hechos con IA para la app → no se reserva la marca: todo MIT, copyright «ElMaxter99». Se enlaza siempre el repo de GitHub y el autor; las referencias de terceros están en /creditos (dependencias, fuentes OFL, iconos, proveedores de servicios y Claude Code).
- **IA fase 0 (#54):** `ProviderError.consumed` + `ss_release_image_quota`: los fallos que no gastan cuota del proveedor devuelven la unidad del contador local; por prudencia lo dudoso se cuenta. Script `ai:measure` para medir neuronas reales (lo ejecuta el propietario). Caché de resultados idénticos descartada por ahora (poco ahorro, mucha complejidad).
