# Identidad de marca (logo, mascota, tipografía y tokens)

Referencia oficial: el logo de **Subasta Salvaje** (personaje 3D con corona y martillo + rótulo).

> **Decisión del propietario (posterior):** la mascota nueva del logo (un solo dibujo) NO sustituye a la anterior. Las **expresiones y poses antiguas** (`expr-*`, `pose-*`, `mascot-main`, en `public/assets/mascot/`) vuelven a usarse en toda la app porque dan más personalidad. La mascota nueva solo se usa en el **inicio (hero)** y en el **`Loader`**, mediante `<BrandMascot>`. El logo en imagen, la tipografía, los tokens, los iconos y los metadatos se mantienen.

## Recursos (`public/assets/brand/`) — se generan con `npm run brand:build`
| Archivo | Qué es | Cómo se obtuvo |
|---|---|---|
| `original/logo-original.webp` | El logo tal cual lo entregó el propietario (1536×1024, **RGBA con transparencia real**) | Original conservado, no se toca |
| `logo-full.png/.webp` | Logo completo recortado al contenido (881×913) | Recorte del original |
| `logo-compact.png/.webp` | Solo el **rótulo** con su corona (712×424), sin mascota | Máscara manual sobre el original (corte por encima de las letras) |
| `mascot.png/.webp` | **Busto** de la mascota con martillo (703×432) | Recorte del original; el borde inferior se difumina porque en el original el cuerpo queda **tapado por el rótulo** |
| `head.webp` | Cabeza coronada (312×356) para tamaños pequeños | Recorte del original |
| `icon-192/512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-64.png` | Iconos de aplicación: cabeza sobre azul marino | Composición de `head` (no redibujada) |
| `favicon.svg` | Favicon **vectorial simplificado** (corona + visor con ojos sonrientes) | **Redibujado a mano en SVG**: es una versión estilizada, no un recorte |
| `og-image.png` | Imagen para compartir (1200×630) | Logo completo sobre azul marino |

### Limitaciones (honestas)
- El logo es un **raster**, no un vector: no hay versión vectorial del logo, solo del favicon simplificado.
- **No existe el cuerpo completo** de la mascota nueva (queda tapado por las letras) ni otras poses: solo hay **un dibujo**, y por eso las expresiones siguen siendo las antiguas. Para poses nuevas harían falta renders del mismo personaje (casco, corona, visor y estilo 3D); no se han inventado.
- El recorte de la mascota conserva un halo suave semitransparente del original: está pensado para fondos oscuros; sobre blanco se ve grisáceo. El recorte `logo-compact` deja un borde superior recto (corte) que en fondo oscuro no se nota.
- Los objetos `item-*` (corona, martillo, megáfono, moneda, temporizador, brillo) siguen siendo los recortes de la lámina antigua (`public/assets/mascot/`, ≈100 px); su estilo no es idéntico al del logo nuevo. Pendiente: reemplazarlos por recortes del mismo estilo.

## Tipografía
- Títulos y cifras destacadas (precios, saldos): **Baloo 2** (700/800, OFL) con `@font-face` en `globals.css` (woff2 propios en `public/assets/fonts/`, subconjunto latino, `font-display: swap`, precarga de la de títulos). No se usa `next/font` (ni google ni local): en el servidor de desarrollo coincidió con un bucle de recargas (causa no aislada; ver DECISIONES #42). Token `font-display`.
- Texto funcional (formularios, listas, instrucciones): **Nunito** (variable, OFL). Token `font-sans`.
- El logotipo es **imagen** (`Logo`); los títulos funcionales son texto accesible.

## Tokens (`src/app/globals.css`, `@theme`)
`night-950…600` (azul marino, fondo), `violet`/`violet-soft`, `electric` (azul eléctrico), `gold`/`gold-soft` (pujas, premios, acciones clave), blanco para texto, y semánticos `success` (teal), `warning` (dorado), `danger` (rosa). Foco: contorno dorado de 3 px.

## Componentes
- `ui/logo.tsx` → `<Logo size="sm|md|lg|xl" variant="compact|full" href />`.
- `mascot/mascot.tsx` → `<Mascot variant …>` (expresiones y poses antiguas) y `<BrandMascot part="bust|head">` (mascota nueva: inicio y Loader).
- `ui/loader.tsx` → `<Loader label detail failed onRetry />`: mascota flotando + texto de lo que ocurre; con `failed` se detiene y muestra el motivo y «Reintentar». Respeta `prefers-reduced-motion`.
- `app/game/[code]/loading.tsx` (no en la raíz: ver DECISIONES #40), `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/manifest.ts` y metadatos (favicon, Open Graph, Twitter) en `app/layout.tsx`.

## Dónde se aplica
Inicio (logo + hero con la mascota nueva), login/unirse/setup/nueva partida/móvil (logo), TV y panel del anfitrión (logo en la cabecera; las mascotas son las antiguas), historial y errores (Loader con la cabeza nueva).
