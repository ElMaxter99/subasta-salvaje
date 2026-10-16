# Subasta Salvaje · Asset Pack

38 assets (51 archivos) generados por `npm run assets:build` (`scripts/assets/`).

- `mascot/` base (frente, cuerpo entero, espalda, lateral, medio cuerpo, cabeza), `expressions/` (8) y `poses/` (5): PNG transparente 2048×2048.
- `props/`, `ui/`, `vfx/`, `brand/`: PNG 1024×1024; SVG además en ui, vfx y brand.
- Padding 10 %, nombres en snake_case, sin textos de etiqueta, marcas de agua ni cuadrícula de ajedrez.
- `manifest.json` lista cada asset (id, ruta, tamaño, uso). `previews/` contiene hojas de contacto.

## Limitación honesta
Son **ilustraciones vectoriales (SVG → PNG con sharp)** inspiradas en la hoja de referencia, **no renders 3D** ni imágenes generadas por IA. La hoja de referencia no se usa como asset final. Para un acabado 3D definitivo, sustituir los PNG manteniendo los nombres del manifest.
