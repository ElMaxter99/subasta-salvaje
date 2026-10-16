# Identidad de marca (logo, mascota, tipografía y tokens)

Referencia oficial: el logo de **Subasta Salvaje** (personaje 3D con corona y martillo + rótulo). **La mascota nueva sustituye a la anterior** y es el único personaje de la app.

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
- **No existe el cuerpo completo** de la mascota (queda tapado por las letras) ni otras poses: solo hay **un dibujo**. Los gestos (`expr-triste`, `pose-adjudica`…) se expresan con movimiento y color en CSS (`.ss-mood-*`), no con imágenes distintas. Para poses reales harían falta renders nuevos del mismo personaje (mismo casco, corona, visor y estilo 3D); no se han inventado.
- El recorte de la mascota conserva un halo suave semitransparente del original: está pensado para fondos oscuros; sobre blanco se ve grisáceo. El recorte `logo-compact` deja un borde superior recto (corte) que en fondo oscuro no se nota.
- Los objetos `item-*` (corona, martillo, megáfono, moneda, temporizador, brillo) siguen siendo los recortes de la lámina antigua (`public/assets/mascot/`, ≈100 px); su estilo no es idéntico al del logo nuevo. Pendiente: reemplazarlos por recortes del mismo estilo.

## Tipografía
- Títulos y cifras destacadas (precios, saldos): **Baloo 2** (700/800, OFL) con `next/font/google` (se sirve desde nuestro dominio, `display: swap`). Token `font-display`.
- Texto funcional (formularios, listas, instrucciones): **Nunito** (variable, OFL). Token `font-sans`.
- El logotipo es **imagen** (`Logo`); los títulos funcionales son texto accesible.

## Tokens (`src/app/globals.css`, `@theme`)
`night-950…600` (azul marino, fondo), `violet`/`violet-soft`, `electric` (azul eléctrico), `gold`/`gold-soft` (pujas, premios, acciones clave), blanco para texto, y semánticos `success` (teal), `warning` (dorado), `danger` (rosa). Foco: contorno dorado de 3 px.

## Componentes
- `ui/logo.tsx` → `<Logo size="sm|md|lg|xl" variant="compact|full" href />`.
- `mascot/mascot.tsx` → `<Mascot variant size motion />` (cabeza en `xs`/`sm`, busto en el resto; `ss-bust-fade`). Los ids antiguos se conservan.
- `ui/loader.tsx` → `<Loader label detail failed onRetry />`: mascota flotando + texto de lo que ocurre; con `failed` se detiene y muestra el motivo y «Reintentar». Respeta `prefers-reduced-motion`.
- `app/loading.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/manifest.ts` y metadatos (favicon, Open Graph, Twitter) en `app/layout.tsx`.

## Dónde se aplica
Inicio (logo + hero con la mascota), login/unirse/setup (logo), nueva partida (logo), TV (logo en la cabecera + cabeza que reacciona), panel del anfitrión (logo en ≥ md + cabeza), móvil de jugador (logo), historial (Loader), errores y 404.
