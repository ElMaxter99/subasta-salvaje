#!/usr/bin/env node
/**
 * Exporta la colección VECTORIAL de la mascota (subasta-salvaje-assets/mascot/{expressions,poses}, PNG de 2048 px con
 * transparencia real) a WebP ligeros de 512 px en public/assets/mascot-vector/, con su inventario.
 *
 *   npm run assets:build && npm run mascot:vector
 *
 * Son dibujos vectoriales (SVG → PNG), NO renders 3D: ver docs/MASCOTA.md. Mismo personaje y paleta, fondo transparente
 * de verdad (sirven sobre cualquier color, sin `tile`).
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'subasta-salvaje-assets/mascot';
const OUT = 'public/assets/mascot-vector';
const SIZE = 512;
const GROUPS = [
  { dir: 'expressions', prefix: 'expression', group: 'expression' },
  { dir: 'poses', prefix: 'pose', group: 'pose' },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const assets = [];
for (const g of GROUPS) {
  for (const f of readdirSync(path.join(SRC, g.dir)).filter((n) => n.endsWith('.png')).sort()) {
    const name = f.replace(/^mascot_(expression|pose)_/, '').replace(/\.png$/, '');
    const id = `${g.prefix}-${name.replace(/_/g, '-')}`;
    const file = `${id}.webp`;
    await sharp(path.join(SRC, g.dir, f)).resize(SIZE, SIZE, { fit: 'inside' }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(path.join(OUT, file));
    const meta = await sharp(path.join(OUT, file)).metadata();
    assets.push({ id, group: g.group, name, file, width: meta.width, height: meta.height, bytes: statSync(path.join(OUT, file)).size, transparency: 'real' });
  }
}
writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify({ source: 'subasta-salvaje-assets/mascot (scripts/assets/build-assets.mjs)', note: 'Colección vectorial (no 3D) con transparencia real, 512 px.', assets }, null, 2) + '\n');
console.log(`✔ ${assets.length} WebP en ${OUT}/ (${Math.round(assets.reduce((n, a) => n + a.bytes, 0) / 1024)} KB en total)`);
