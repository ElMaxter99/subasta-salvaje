# Asset pack «Subasta Salvaje»

Carpeta `subasta-salvaje-assets/` (38 assets, 51 archivos, `manifest.json`, `previews/contact_sheet_*.png`, README propio). Se regenera con `npm run assets:build`
(`scripts/assets/{lib,props,mascot,ui,build-assets}.mjs`, SVG → PNG con sharp).

- Mascota (PNG transparente 2048²): vistas base (frente, cuerpo entero, espalda, lateral, medio cuerpo, cabeza), 15 expresiones y 12 poses. Props, UI, VFX y marca en PNG 1024²; SVG también para ui/vfx/brand.
- Reglas del encargo: padding 10 %, nombres `snake_case`, sin etiquetas ni marcas de agua, sin cuadrícula de ajedrez; la hoja de referencia **no** se usa como asset final.
- Cada grupo comparte un `viewBox` cuadrado calculado midiendo el bbox real (`measure`/`squareView`); `full_body` tiene su propio grupo para no encoger las demás vistas.
- Controles de calidad automáticos: alfa real, esquinas transparentes, banda de borde del 6 % vacía, tamaño correcto.
- **Limitación honesta:** son ilustraciones **vectoriales aproximadas**, no renders 3D ni imágenes de IA (no había herramienta de generación). Para acabado 3D, sustituir los PNG
  conservando nombres del manifest. El texto de marca depende de la fuente Inter. Confeti y líneas de velocidad quedan finos a tamaño pequeño.
- La mascota que SÍ está integrada en la UI viene de la lámina de referencia (`docs/MASCOTA.md`), no de este paquete vectorial. Los assets de este paquete aún **no están integrados en la UI** (la TV usa emojis/CSS); integrarlos (mascota reaccionando en la TV, confeti VFX) es una mejora propuesta.


Versión web ligera con alfa real (WebP 512 px) de todas las expresiones y poses: `npm run mascot:vector` → `public/assets/mascot-vector/` (ver `docs/MASCOTA.md`).
