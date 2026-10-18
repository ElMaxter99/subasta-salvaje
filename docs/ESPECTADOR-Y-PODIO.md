# Modo espectador e imagen del podio

Dos mejoras de «compartir la partida»: una URL pública de **solo lectura** para seguir la subasta desde casa, y una **imagen del podio**
descargable con tres formatos y diseño de marca.

## 1. Modo espectador (`/game/[code]/watch`)

### Qué es
Una página pública, pensada para el móvil, que muestra la partida en directo **sin sesión, sin token de jugador y sin ningún control**:
- Subasta en curso: imagen (o emoji) del elemento, puja actual, «va ganando X», últimas pujas (5), reloj de adjudicación automática y reloj de la
  subasta automática (`AutoRunClock`), avisos de evento sorpresa y de quién ha cedido.
- Casas y saldos de todos los jugadores (con elementos conseguidos); el líder de la puja se resalta.
- Sala de espera, pausa y «entre subastas» (último adjudicado + cuenta atrás a la siguiente).
- Partida terminada: reutiliza `FinalResults` (podio/clasificación, estadísticas, premios, antes/después, botón de la imagen del podio).

### Qué datos usa (y cuáles NO)
Solo `GET /api/watch/[code]` (clave en la cabecera `x-spectator-key`) → `getSpectatorState` → `getPublicState` (`view: 'watch'`), a través de `useLiveGame` (Realtime + sondeo). Es **exactamente** la
instantánea que ya usan la TV y los resultados: sin `host_id`, trabajos, versiones, prompts ni eventos (lo comprueba `tests/spectator.test.ts`).
- **Pujas a ciegas / sobre cerrado:** el servidor ya vacía importe, líder y pujas (`auction.hidden`). La vista además NO los pinta ni los calcula
  (`blind ? undefined / []`): muestra «¿¿ ??», cuántas pujas hay y, en sobre cerrado, quién ya ha pujado (sin importes). Al adjudicar se revela como
  en la TV.
- Sin sonido (no usa `useGameAudio`). Sin escritura: ni `POST`, ni botones, ni formularios (un test lee el código fuente y lo impide; el e2e lo
  comprueba en el DOM). En la pantalla final se conserva el deslizador «antes/después» de las casas, que es solo de visualización.

### Accesibilidad y SEO
- Móvil primero (una columna, 2 a partir de 480 px), sin desbordamiento horizontal (e2e a 390 px), texto ≥ 14 px, colores de la paleta ya auditada
  (`docs/ACCESIBILIDAD-MOVIL.md`), objetivos táctiles: no hay controles.
- Regiones vivas con moderación: solo el resumen de la puja (`aria-live="polite"`, `aria-atomic`) y avisos puntuales (sala de espera, «entre
  subastas»). Las cuentas atrás **no** son regiones vivas (cambian cada segundo).
- `robots: noindex, nofollow`, `canonical` y Open Graph propios (título «Sigue en directo «Nombre»», imagen 1200×630 sin código de sala:
  `watch/opengraph-image.tsx`, `kind: 'watch'` en `seo/site.ts` y `seo/og-image.tsx`). Ver `docs/OPEN-GRAPH.md`.
- **Límite de tasa del sondeo:** `GET /api/public/games/[code]` ahora aplica `limit()` (240/min por IP y sala; antes no tenía). Cubre TV, resultados y
  espectadores. En redes compartidas (colegio, bar) muchos espectadores comparten IP: si fuese un problema, subir el tope.

### Compartirlo
- **Panel del anfitrión** (`components/host/spectator-card.tsx`, bajo los controles de sonido): sección plegable «Modo espectador», con QR,
  «Copiar enlace de espectador» y el interruptor «Desactivar/Activar».
- **TV:** ya NO muestra el QR de espectador (desde la migración `…010100`): la TV es pública por código de sala y cualquiera que la abra vería la clave.

### Desactivarlo por partida
- Columna `games.spectator_enabled boolean not null default true` (migración `20260101009800_spectator.sql`; permisos en `…009801_security_spectator.sql`).
- Acción del anfitrión `game.set_spectator { spectator_enabled: boolean }` → `ss_set_spectator` (bloqueo de la partida, comprobación de
  anfitrión `not_host`, valor booleano obligatorio, `ss_touch` para que Realtime avise). La instantánea añade `game.spectator_enabled` mediante el
  patrón envoltorio (`ss_get_state` → `ss_get_state_pre_spectator`).
- **Límite honesto:** es un interruptor de **presentación**. Con él apagado `/watch` solo muestra un aviso y la TV oculta el QR, pero los datos
  públicos siguen siendo los de siempre (la TV y `/results` los muestran igual y cualquiera con el código de sala puede abrirlos). No es un control
  de acceso. Para ocultar de verdad una partida habría que cambiar el modelo de la vista pública (pendiente, si el propietario lo quiere).

### Pruebas
- `tests/spectator.test.ts` (Vitest + PGlite): interruptor (por defecto activo, lo ve la instantánea pública, solo el anfitrión, valor booleano), puja
  a ciegas sin importe/líder/pujas ni datos de anfitrión, vista sin controles ni escrituras, texto del enlace.
- `e2e/spectator.spec.ts` (Playwright, móvil 390 px): abre `/watch` sin sesión, ve subasta/saldos/casas, sin botones ni campos, sin desbordamiento; la
  acción de anfitrión se rechaza sin sesión; subasta a ciegas → «¿¿ ??» y el importe no aparece ni en el DOM ni en la API pública; desactivar muestra
  el aviso; el panel del anfitrión ofrece el enlace; el final muestra estadísticas.
- **No probado:** Postgres 16 real (`tests/postgres-real.test.ts` no se ha tocado; la migración usa el mismo patrón que `sound`/`player_stats`),
  Realtime de Supabase real, lectores de pantalla reales, muchos espectadores simultáneos (carga).

## 2. Imagen del podio

### Formatos
`GET /api/public/games/[code]/podium?format=…&download=1` (solo con la partida terminada; límite 30/min por IP y sala):

| `format` | Tamaño | Uso |
|---|---|---|
| `landscape` (por defecto, sin parámetro) | 1200×630 | tarjeta horizontal (el formato de siempre, rediseñado) |
| `square` | 1080×1080 | feed cuadrado |
| `story` | 1080×1350 | vertical para móvil (el botón principal de descarga) |

`format` se valida con lista cerrada (`parsePodiumFormat`): cualquier otro valor → 400 `invalid_input`. `download=1` añade
`Content-Disposition` (`podio-CODIGO.png`, `podio-CODIGO-square.png`, `podio-CODIGO-story.png`).

### Qué contiene
Logo y mascota de marca (de `public/assets`), título, nombre de la partida, fecha (en español, zona Madrid), **podio con medallas** oro/plata/bronce
(1.º en el centro; los empates comparten escalón y medalla), **miniaturas de la casa final** leídas de Storage (recortadas con `sharp`; si no hay
imagen o está en una URL externa, un marcador con el color del jugador y una casita), resto de jugadores en filas compactas (hasta 10), **premios**
(`computeAwards`, con icono de la mascota por premio y «Mejor casa» si la galería cerró con votos) y **3 estadísticas** (elementos, dinero gastado,
pujas). Con clasificación «ninguna» se muestra una cuadrícula de casas con el saldo final. Con 0 jugadores, un aviso.
Nombres largos y con emojis: se sanean (`plainText`, sin emojis porque satori los pediría a un CDN) y se recortan con puntos suspensivos en
contenedores de ancho fijo. En `landscape` hay sitio para 3 premios; en `square`/`story` para 2–6 según cuántos jugadores haya debajo del podio.

### Implementación
- `src/lib/seo/podium-image.tsx` (`next/og`/satori, sin dependencias nuevas). `renderPodiumImage(snapshot, storage, download, format)` ahora devuelve
  una `Response` PNG (antes `ImageResponse`; los tests existentes siguen valiendo). API: `PODIUM_FORMATS`, `PODIUM_SIZES`, `parsePodiumFormat`,
  `podiumRows`, `plainText`, `podiumDate`.
- **Sin red en ejecución:** logo, mascota e iconos se leen de `public/assets` y se convierten a PNG con `sharp` (cacheados en memoria); las casas, de
  Storage. **Tipografía:** la que trae `next/og` (Geist Regular). No se puede usar Baloo 2 (satori no lee woff2 y no hay `.ttf` en el repo); el
  «negrita» es solo una ilusión de contorno que satori puede no aplicar. Sin descargar nada.
- **Caché:** en proceso (hasta 24 PNG, clave = id de partida + formato + `version` de la instantánea, así que una imagen nueva invalida sola) y HTTP
  `max-age=30, s-maxage=120, stale-while-revalidate=300`; si alguna casa aún se está generando (`generating`), no se cachea en proceso y el CDN solo
  10 s.
- Botón de descarga (`screen/podium-download.tsx`, resultados web y móvil): principal vertical + enlaces «Cuadrada» y «Horizontal».

### Pruebas y revisión visual
- `tests/podium-image.test.ts`: validación de `format`, fecha, y para 2/5/10 jugadores, nombres largos (y con emoji), empates, sin clasificación, sin
  premios, con galería, sin casas, 1 y 0 jugadores en los 3 formatos, comprobando el **tamaño exacto del PNG**; cabeceras y caché.
  `PODIUM_DUMP=/ruta npx vitest run tests/podium-image.test.ts` guarda los PNG para revisarlos a ojo (se revisaron todos los casos).
- `e2e/podium-image.spec.ts`: los tres tamaños, 400 en formatos inválidos, 409/no disponible antes de terminar y enlaces de descarga.
- **No probado:** miniaturas con imágenes reales de IA en Supabase Storage (solo imágenes sintéticas); miniaturas de casas en URL externa (se
  omiten a propósito); cómo las muestran WhatsApp/Instagram.

### Dependencia con `computeAwards` (rama `feat/game`)
La imagen usa `computeAwards(players, player_stats)` y los campos `id`, `title`, `detail`, `players`. Los premios nuevos que añada esa rama salen solos
(con el icono de reserva «brillo»); para darles un icono propio, añadir su `id` a `AWARD_ICON` en `podium-image.tsx`. El `emoji` del premio NO se
dibuja (satori descargaría el emoji de la red).

### Control de acceso por clave (migración `20260101010100_spectator_access.sql`)
- **Qué hace:** `/game/<código>/watch?k=<clave>` exige una clave secreta por partida (`games.spectator_token`, 64 hex = dos UUID v4 sin guiones; distinta en
  cada partida, también en las ya existentes). Sin clave, con clave falsa, con el modo desactivado, tras regenerarla o con una sala inexistente la página
  muestra «Este enlace de espectador no está disponible» (misma respuesta en todos los casos, no distingue si la sala existe) y `GET /api/watch/<código>`
  responde 403 `spectator_denied`. La clave viaja en la cabecera `x-spectator-key` (no en la URL de la API); el HTML lleva `noindex` y `referrer: no-referrer`
  y el título de la página es genérico (la vista previa del enlace no filtra el nombre de la partida).
- **Dónde se ve la clave:** solo en el panel del anfitrión (`ss_spectator_token`, exige ser el anfitrión; entra en `HostSnapshot.spectator_token`) y nunca en la
  instantánea pública (lo comprueba `tests/spectator.test.ts`). «Cambiar enlace» (`game.regenerate_spectator` → `ss_spectator_regenerate`) la regenera: el enlace
  anterior deja de valer al instante, también para espectadores ya conectados (su siguiente sondeo recibe 403).
- **Validación:** `ss_spectator_check` compara SHA-256 de ambas claves y exige `spectator_enabled`; el formato (`^[a-f0-9]{64}$`) se valida en TypeScript antes de
  tocar la BD. Los intentos fallidos tienen un límite aparte (20/min por IP) además del de lectura (240/min por IP y sala).
- **Límites honestos:** la clave es una *capacidad*: quien tenga el enlace puede verlo y reenviarlo (regenerarlo es el remedio). Se guarda en claro en `games`
  (para poder mostrarla de nuevo al anfitrión) con RLS deny-all y solo se expone al anfitrión. **La TV (`/game/<código>/screen`), los resultados y
  `GET /api/public/games/<código>` siguen siendo públicos por código de sala** (la TV no puede llevar clave); este control gobierna el enlace de espectador, no la
  privacidad global de la partida. Los códigos de sala (6 caracteres) no son secretos fuertes: ver `docs/SEGURIDAD.md`.
