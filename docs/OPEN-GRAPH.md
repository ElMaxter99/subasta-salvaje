# Open Graph (miniaturas al compartir enlaces)

## Qué muestra cada enlace
| Enlace | Título | Imagen (1200×630, dinámica) |
|---|---|---|
| Invitar a la partida `/game/CODE/play` | «Te han invitado a «Nombre»» | Logo, mascota, **código de sala en grande** y «Entra desde tu móvil con este código» |
| TV `/game/CODE/screen` | «Pantalla de TV · Nombre» | Logo, mascota y código de sala |
| Resultados `/game/CODE/results` | «Resultados de «Nombre»» (+ «: gana X» si hay clasificación) | Logo, mascota y «Gana X» / «Fin de la subasta» (sin código) |
| Inicio, login y resto | «Subasta Salvaje» | Imagen de marca estática `public/assets/brand/og-image.png` |
| Panel, historial, login, nueva partida, setup, reset | — | `robots: noindex` (no se indexan) |

Decisión del propietario: el enlace de invitación **muestra el código de sala** en la miniatura (quien vea el enlace lo ve).
`/join?code=XXXX` redirige al enlace de invitación, así que hereda su miniatura.

## Implementación
- `src/lib/seo/site.ts`: `siteUrl()` (`NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → localhost) para `metadataBase`, `loadGameCard()` (solo datos PÚBLICOS vía `getPublicState`) y `gameMetadata()`.
- `src/lib/seo/og-image.tsx`: `renderOg()` con `next/og` (satori). Caché CDN 60 s. Partida inexistente o error → tarjeta genérica (200).
- `src/app/game/[code]/{play,screen,results}/opengraph-image.tsx`: la convención de Next añade `og:image` (+ ancho/alto/alt) a cada ruta.
- Tests: `tests/seo.test.ts` (textos y dominio) y `e2e/open-graph.spec.ts` (etiquetas, imagen 200 PNG, noindex).

## Pendiente / límites
- Define **`NEXT_PUBLIC_SITE_URL`** en Vercel (tu dominio) para que las URL de `og:image` sean absolutas y correctas.
- Las imágenes usan Baloo 2 y Nunito en TTF estáticas (`src/assets/fonts/`, ver `docs/FUENTE-PODIO.md`); si no cargan, la fuente por defecto de satori.
- **No verificado con rastreadores reales** (WhatsApp, Telegram, X, Facebook, Discord): necesitan un dominio público y suelen cachear la miniatura; para refrescarla usa sus depuradores (Facebook Sharing Debugger, etc.).
