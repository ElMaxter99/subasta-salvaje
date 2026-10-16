/**
 * Cajas de recorte sobre la lámina de referencia (1254×1254) en píxeles: [izquierda, arriba, ancho, alto].
 * Se miden a mano sobre `public/assets/mascot/reference-sheet.webp`; las etiquetas de texto de la lámina (Feliz, Corona…)
 * quedan SIEMPRE fuera de las cajas.
 */
export const SHEET = 'public/assets/mascot/reference-sheet.webp';

// mode 'feather': recorte rectangular con el fondo oscuro de la lámina y bordes difuminados a transparente
// mode 'key':     fondo quitado por relleno desde el borde (solo objetos de colores vivos sobre fondo oscuro)
export const ASSETS = [
  // --- Mascota principal (cuerpo entero) ---
  { id: 'mascot-main', group: 'mascot', box: [20, 40, 555, 665], mode: 'feather', feather: 22, scaleTo: null,
    // zonas a «limpiar» (rótulo del logotipo, lema, marca de agua de corona y bocetos vecinos): se rellenan con el degradado del fondo
    fills: [
      { rect: [20, 40, 252, 66], from: 'top' }, // logotipo (tramo superior, por encima de la corona)
      { rect: [20, 90, 236, 158], from: 'top' }, // logotipo + lema (hasta justo antes de la punta de la corona)
      { rect: [551, 40, 30, 250], from: 'left' }, // «EXPRESIONES» y mano de «Feliz»
      { rect: [549, 555, 30, 150], from: 'left' }, // «POSES PRINCIPALES» y corona de la pose «Presenta»
      { rect: [20, 500, 155, 125], from: 'vertical' }, // marca de agua de corona
    ] },
  // --- Expresiones (busto) ---
  { id: 'expr-feliz', group: 'expression', box: [551, 96, 168, 172], mode: 'feather', feather: 8 },
  { id: 'expr-sorprendido', group: 'expression', box: [732, 100, 164, 168], mode: 'feather', feather: 8 },
  { id: 'expr-guino', group: 'expression', box: [906, 100, 160, 168], mode: 'feather', feather: 8 },
  { id: 'expr-pensativo', group: 'expression', box: [1072, 100, 140, 168], mode: 'feather', feather: 8 },
  { id: 'expr-triste', group: 'expression', box: [572, 328, 132, 182], mode: 'feather', feather: 8 },
  { id: 'expr-enfadado', group: 'expression', box: [740, 328, 136, 182], mode: 'feather', feather: 8 },
  { id: 'expr-celebrando', group: 'expression', box: [892, 322, 172, 188], mode: 'feather', feather: 8 },
  { id: 'expr-hype', group: 'expression', box: [1062, 322, 156, 188], mode: 'feather', feather: 8 },
  // --- Poses (baja resolución en la lámina) ---
  { id: 'pose-presenta', group: 'pose', box: [546, 626, 150, 166], mode: 'feather', feather: 6 },
  { id: 'pose-anuncia', group: 'pose', box: [696, 640, 125, 152], mode: 'feather', feather: 6 },
  { id: 'pose-cuenta-atras', group: 'pose', box: [818, 638, 140, 156], mode: 'feather', feather: 6 },
  { id: 'pose-adjudica', group: 'pose', box: [956, 632, 130, 162], mode: 'feather', feather: 6 },
  { id: 'pose-celebra', group: 'pose', box: [1090, 626, 130, 166], mode: 'feather', feather: 6 },
  // --- Elementos de apoyo (objeto aislado: se intenta transparencia real) ---
  { id: 'item-corona', group: 'item', box: [36, 868, 108, 100], mode: 'key' },
  { id: 'item-martillo', group: 'item', box: [180, 862, 130, 124], mode: 'key' },
  { id: 'item-megafono', group: 'item', box: [322, 868, 108, 108], mode: 'key' },
  { id: 'item-temporizador', group: 'item', box: [462, 884, 132, 90], mode: 'key' },
  { id: 'item-logo', group: 'item', box: [626, 878, 118, 118], mode: 'key' },
  // El interior del bocadillo es casi igual que el fondo: el relleno lo «vaciaría», así que se conserva con su fondo y bordes difuminados.
  { id: 'item-bocadillo', group: 'item', box: [770, 878, 176, 118], mode: 'feather', feather: 6 },
  { id: 'item-moneda', group: 'item', box: [980, 876, 110, 110], mode: 'key' },
  { id: 'item-brillo', group: 'item', box: [1126, 880, 82, 92], mode: 'key' },
];
