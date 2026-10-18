#!/usr/bin/env node
/**
 * Pipeline de assets de «Subasta Salvaje».
 *
 * IMPORTANTE: NO son renders 3D. Es una aproximación VECTORIAL (SVG con degradados, brillos y sombras que imitan el
 * acabado de juguete 3D de la referencia) exportada a PNG con sharp. No hay herramienta de generación de imágenes
 * en este entorno; para un acabado 3D real habría que renderizar en Blender/IA a partir de esta guía y estos
 * encuadres. La hoja de referencia NO se usa como asset final.
 *
 *   npm run assets:build      → regenera subasta-salvaje-assets/ (PNG + SVG + manifest.json + previews)
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DEFS, PALETTE, crown } from './lib.mjs';
import { mascotBust, mascotFull, mascotView } from './mascot.mjs';
import { coin, confetti, hammer, logoIcon, megaphone, sparkle, speechBubble, timer } from './props.mjs';
import { backArrow, countdownBar, goldCrownIcon, primaryButton, progressBar, purpleSpeedLines, secondaryButton, wordmark, yellowHighlightShapes } from './ui.mjs';

const OUT = 'subasta-salvaje-assets';
const PAD = 0.1; // 10 % de margen por lado
const MASCOT_SIZE = 2048;
const OTHER_SIZE = 1024;
const WORLD = '-500 -500 2000 2000'; // vista amplia para medir el contenido sin recortes

const svgDoc = (inner, viewBox, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${DEFS}${inner}</svg>`;

/** Caja del contenido (unidades SVG) medida renderizando con una vista amplia. */
async function measure(inner) {
  const buf = await sharp(Buffer.from(svgDoc(inner, WORLD, 2000))).png().toBuffer();
  const { info } = await sharp(buf).trim({ threshold: 2 }).toBuffer({ resolveWithObject: true });
  const x0 = -info.trimOffsetLeft - 500, y0 = -info.trimOffsetTop - 500;
  return { x0, y0, x1: x0 + info.width, y1: y0 + info.height };
}
const union = (boxes) => ({ x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) });
/** Cuadrado centrado en la caja de modo que el contenido ocupe (1 − 2·PAD) del lado. */
function squareView(b) {
  const side = Math.max(b.x1 - b.x0, b.y1 - b.y0) / (1 - 2 * PAD);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return `${(cx - side / 2).toFixed(2)} ${(cy - side / 2).toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}`;
}

const wrapProp = (inner) => inner; // los props ya están centrados en su origen

const mascotAssets = [
  // base — grupo «full» (mismo encuadre para ver el cambio de vista)
  ...['front_neutral', 'full_body', 'back', 'side'].map((v) => ({ id: `mascot_${v}`, name: `Mascota · ${v}`, folder: 'mascot/base', kind: 'mascot', group: v === 'full_body' ? 'base_hero' : 'base_full', svg: () => mascotView(v), usage: v === 'front_neutral' ? 'Mascota base, de frente y en reposo (maestro visual).' : v === 'full_body' ? 'Pose principal de marca: martillo y gesto de señalar.' : v === 'back' ? 'Vista trasera para turnarounds y modelado.' : 'Vista lateral para turnarounds y modelado.' })),
  { id: 'mascot_half_body', name: 'Mascota · medio cuerpo', folder: 'mascot/base', kind: 'mascot', group: 'base_half', svg: () => mascotView('half_body'), usage: 'Avatares, cabeceras y tarjetas de diálogo.' },
  { id: 'mascot_head', name: 'Mascota · cabeza', folder: 'mascot/base', kind: 'mascot', group: 'base_head', svg: () => mascotView('head'), usage: 'Icono/avatar del anfitrión y reacciones pequeñas.' },
  // expresiones (mismo encuadre para las 8)
  ...['happy', 'surprised', 'wink', 'thinking', 'sad', 'angry', 'celebrating', 'hype', 'love', 'cool', 'laughing', 'sleepy', 'confused', 'shy', 'cry'].map((e) => ({ id: `mascot_expression_${e}`, name: `Mascota · expresión ${e}`, folder: 'mascot/expressions', kind: 'mascot', group: 'expressions', svg: () => mascotBust({ expr: e }), usage: { love: 'Cariño: valorar o votar una casa.', cool: 'Presumir: ganar con estilo.', laughing: 'Risa: momentos divertidos.', sleepy: 'Sueño: esperando o sala inactiva.', confused: 'Duda: algo no cuadra.', shy: 'Vergüenza: tímido o cumplido.', cry: 'Llanto: perder la puja o error.' }[e] ?? `Reacción «${e}» del anfitrión en la TV y el móvil.` })),
  // poses (mismo encuadre para todas)
  ...['presenting_item', 'announcing_bid', 'countdown', 'hammer_auction', 'celebration', 'waving', 'thumbs_up', 'pointing_up', 'shrug', 'holding_coin', 'thinking', 'sad_slump'].map((p) => ({ id: `mascot_pose_${p}`, name: `Mascota · pose ${p}`, folder: 'mascot/poses', kind: 'mascot', group: 'poses', svg: () => mascotFull({ pose: p }), usage: { presenting_item: 'Presentar el elemento que sale a subasta.', announcing_bid: 'Anunciar una puja nueva.', countdown: 'Cuenta atrás de adjudicación automática.', hammer_auction: 'Martillazo: adjudicado.', celebration: 'Celebración del ganador.', waving: 'Saludar: bienvenida a la sala o al jugador que entra.', thumbs_up: 'Aprobar o confirmar (puja aceptada, todo listo).', pointing_up: 'Llamar la atención sobre un aviso o una regla.', shrug: 'No lo sé / error suave / estado vacío.', holding_coin: 'Saldo, precios y pujas.', thinking: 'Pensando (cargando, la IA trabaja, decidir una puja).', sad_slump: 'Pérdida, partida terminada sin premio o error.' }[p] })),
];

const single = (id, name, folder, kind, svg, usage, extra = {}) => ({ id, name, folder, kind, group: id, svg, usage, ...extra });
const propAssets = [
  single('crown', 'Corona dorada', 'props', 'prop', () => crown({ s: 2 }), 'Corona suelta para coronar ganadores o decorar la interfaz.'),
  single('auction_hammer', 'Martillo de subasta', 'props', 'prop', () => hammer({ s: 1, rot: 35 }), 'Martillo suelto para animaciones de adjudicación.'),
  single('megaphone', 'Megáfono', 'props', 'prop', () => megaphone({ s: 2.2, rot: -10 }), 'Megáfono suelto para anuncios de puja.'),
  single('timer_0010', 'Temporizador digital 00:10', 'props', 'prop', () => timer({ value: '00:10', s: 1.6 }), 'Temporizador (texto editable: parámetro `value`); cuenta atrás de la subasta.', { editable: 'value (mm:ss) en scripts/assets/props.mjs' }),
  single('speech_bubble_subasta_activa', 'Bocadillo «¡Subasta activa!»', 'props', 'prop', () => speechBubble({ s: 1.5 }), 'Bocadillo del anfitrión cuando hay una subasta en curso. El SVG usa texto (fuente Inter).'),
  single('coin', 'Moneda dorada', 'props', 'prop', () => coin({ s: 1.4 }), 'Moneda de subasta para saldos y precios.'),
];
const vfxAssets = [
  single('sparkle', 'Brillo dorado', 'vfx', 'vfx', () => sparkle({ s: 2.4 }), 'Destello para acentos, adjudicaciones y logros.'),
  single('confetti', 'Confeti de celebración', 'vfx', 'vfx', () => confetti({ spread: 380, count: 54, seed: 9 }), 'Confeti para celebraciones y resultados finales.'),
];
const uiAssets = [
  single('primary_button', 'Botón principal morado', 'ui', 'ui', () => primaryButton(), 'Botón principal sin texto (añade la etiqueta en la interfaz).'),
  single('secondary_button', 'Botón secundario', 'ui', 'ui', () => secondaryButton(), 'Botón secundario sin texto.'),
  single('progress_bar', 'Barra de progreso dorada y blanca', 'ui', 'ui', () => progressBar(0.64), 'Progreso de rondas (64 % de muestra).'),
  single('countdown_bar', 'Barra de cuenta atrás', 'ui', 'ui', () => countdownBar(0.55), 'Cuenta atrás de la adjudicación automática (55 % de muestra).'),
  single('back_arrow', 'Flecha de volver', 'ui', 'ui', () => backArrow(), 'Botón/icono de volver.'),
  single('gold_crown_icon', 'Icono de corona dorada', 'ui', 'ui', () => goldCrownIcon(), 'Icono de corona para líderes y ganadores.'),
  single('purple_speed_lines', 'Líneas de velocidad moradas', 'ui', 'ui', () => purpleSpeedLines(), 'Fondo de energía para anuncios y transiciones.'),
  single('yellow_highlight_shapes', 'Formas de resalte amarillas', 'ui', 'ui', () => yellowHighlightShapes(), 'Trazos amarillos de resalte tras títulos y precios.'),
];
const brandAssets = [
  single('logo_icon', 'Icono de marca (corona)', 'brand', 'brand', () => logoIcon({ s: 1.4 }), 'Icono de la aplicación y favicon fuente.'),
  single('crown_mark_gold', 'Marca de corona dorada', 'brand', 'brand', () => crown({ s: 2.2 }), 'Corona aislada para sellos y marcas de agua.'),
  single('wordmark_subasta_salvaje', 'Logotipo «Subasta Salvaje»', 'brand', 'brand', () => wordmark(), 'Logotipo tipográfico (usa la fuente Inter instalada; no es el logo final del arte de referencia).'),
];

const ALL = [...mascotAssets, ...propAssets, ...vfxAssets, ...uiAssets, ...brandAssets];

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  for (const f of ['mascot/base', 'mascot/expressions', 'mascot/poses', 'props', 'ui', 'vfx', 'brand', 'previews']) mkdirSync(path.join(OUT, f), { recursive: true });

  // 1) medir y unificar encuadres por grupo (mismo tamaño de cabeza en expresiones y poses)
  const boxes = new Map();
  for (const a of ALL) boxes.set(a.id, await measure(a.svg()));
  const groups = new Map();
  for (const a of ALL) groups.set(a.group, [...(groups.get(a.group) ?? []), boxes.get(a.id)]);
  const views = new Map([...groups].map(([g, b]) => [g, squareView(union(b))]));

  // 2) renderizar
  const manifest = [];
  for (const a of ALL) {
    const size = a.kind === 'mascot' ? MASCOT_SIZE : OTHER_SIZE;
    const vb = views.get(a.group);
    const doc = svgDoc(a.svg(), vb, size);
    const png = path.join(OUT, a.folder, `${a.id}.png`);
    await sharp(Buffer.from(doc)).png({ compressionLevel: 9 }).toFile(png);
    const files = [{ file: `${a.folder}/${a.id}.png`, format: 'PNG' }];
    if (a.kind !== 'mascot' && a.kind !== 'prop') {
      writeFileSync(path.join(OUT, a.folder, `${a.id}.svg`), doc);
      files.push({ file: `${a.folder}/${a.id}.svg`, format: 'SVG' });
    }
    manifest.push({ id: a.id, name: a.name, category: a.kind, folder: a.folder, usage: a.usage, size, files, editable: a.editable });
  }

  // 3) control de calidad: PNG con alfa, esquinas transparentes y margen exterior vacío (sin recortes)
  const report = [];
  for (const m of manifest) {
    const pngFile = path.join(OUT, m.files[0].file);
    const { data, info } = await sharp(pngFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, band = Math.floor(w * 0.06);
    const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
    let edgeMax = 0, opaque = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = alphaAt(x, y);
      if (a > 8) opaque++;
      if ((x < band || x >= w - band || y < band || y >= h - band) && a > edgeMax) edgeMax = a;
    }
    const corners = [alphaAt(0, 0), alphaAt(w - 1, 0), alphaAt(0, h - 1), alphaAt(w - 1, h - 1)];
    const meta = await sharp(pngFile).metadata();
    m.width = w; m.height = h;
    m.transparent = meta.hasAlpha === true && corners.every((c) => c === 0) && opaque < w * h * 0.95;
    m.padding_ok = edgeMax <= 8;
    m.color_space = 'sRGB';
    if (!m.transparent || !m.padding_ok || w !== m.size) report.push(`${m.id}: transparent=${m.transparent} padding_ok=${m.padding_ok} size=${w}`);
  }

  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    project: 'Subasta Salvaje',
    generated_by: 'scripts/assets/build-assets.mjs',
    generator_note: 'Assets vectoriales (SVG → PNG con sharp) que aproximan el estilo 3D de la referencia. NO son renders 3D reales y la hoja de referencia no se usa como asset.',
    palette: PALETTE,
    padding: '10 % por lado (contenido ≤ 80 % del lienzo); mismo encuadre dentro de cada grupo (expresiones, poses, vistas base)',
    export: { mascot_resolution: `${MASCOT_SIZE}x${MASCOT_SIZE}`, other_resolution: `${OTHER_SIZE}x${OTHER_SIZE}`, color_profile: 'sRGB', transparent_background: true },
    quality_checks: { failed: report },
    assets: manifest.map((entry) => ({ ...Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'size')), dimensions: `${entry.width}x${entry.height}` })),
  }, null, 2));

  // 4) hojas de contacto (SOLO para revisión visual; no son assets finales)
  const sheet = async (ids, file, cols, cell = 300) => {
    const rows = Math.ceil(ids.length / cols);
    const W = cols * cell, H = rows * (cell + 34) + 20;
    const layers = [];
    for (const [i, id] of ids.entries()) {
      const m = manifest.find((x) => x.id === id);
      const thumb = await sharp(path.join(OUT, m.files[0].file)).resize(cell - 20, cell - 20, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const x = (i % cols) * cell + 10, y = Math.floor(i / cols) * (cell + 34) + 10;
      layers.push({ input: thumb, left: x, top: y });
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="30"><text x="${cell / 2}" y="21" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-size="17" fill="#C9C3F0">${id.replace(/^mascot_/, '')}</text></svg>`), left: (i % cols) * cell, top: y + cell - 14 });
    }
    await sharp({ create: { width: W, height: H, channels: 4, background: '#080B2B' } }).composite(layers).png().toFile(path.join(OUT, 'previews', file));
  };
  const idsOf = (arr) => arr.map((a) => a.id);
  await sheet(idsOf(mascotAssets.filter((a) => a.folder === 'mascot/base')), 'contact_sheet_mascot_base.png', 3);
  await sheet(idsOf(mascotAssets.filter((a) => a.folder === 'mascot/expressions')), 'contact_sheet_expressions.png', 5);
  await sheet(idsOf(mascotAssets.filter((a) => a.folder === 'mascot/poses')), 'contact_sheet_poses.png', 6);
  await sheet(idsOf([...propAssets, ...vfxAssets, ...uiAssets, ...brandAssets]), 'contact_sheet_props_ui_vfx_brand.png', 6, 240);

  console.log(`✔ ${manifest.length} assets en ${OUT}/ (${manifest.reduce((n, m) => n + m.files.length, 0)} archivos)`);
  if (report.length) {
    console.error('✖ Controles de calidad fallidos:\n' + report.join('\n'));
    process.exitCode = 1;
  } else console.log('✔ Controles de calidad: PNG con alfa, esquinas transparentes, márgenes sin recorte y tamaños correctos.');
}
void readFileSync;
void wrapProp;
main();
