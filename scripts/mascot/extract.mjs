/**
 * Recorta los recursos de la lámina de referencia de la mascota (public/assets/mascot/reference-sheet.webp).
 *
 *   node scripts/mascot/extract.mjs
 *
 * HONESTIDAD: la lámina es una imagen plana con fondo oscuro, no una colección de archivos con transparencia.
 *   · modo `key`     (objetos aislados de colores vivos): se quita el fondo por relleno desde el borde → transparencia real.
 *   · modo `feather` (mascota y bustos, cuyo cuerpo es azul marino casi igual que el fondo): NO se puede separar el fondo sin
 *                    comerse la sudadera; se conserva el fondo oscuro de la lámina y los bordes se difuminan a transparente
 *                    para que se fundan con el fondo oscuro de la app. NO son recortes con transparencia real.
 * La resolución es la de la lámina (≈0,5 K para el personaje principal, ≈0,15 K para bustos y poses): sirve para tamaños pequeños/medios.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { ASSETS, SHEET } from './boxes.mjs';

const OUT = 'public/assets/mascot';
mkdirSync(OUT, { recursive: true });

const sheet = await sharp(SHEET).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const SW = sheet.info.width;
const SH = sheet.info.height;
const S = sheet.data;
const at = (x, y) => {
  const cx = Math.min(SW - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(SH - 1, Math.max(0, Math.round(y)));
  const i = (cy * SW + cx) * 3;
  return [S[i], S[i + 1], S[i + 2]];
};
/** Color medio de una ventana 5×5 (reduce el ruido de la compresión). */
const avg = (x, y) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const p = at(x + dx, y + dy);
    r += p[0]; g += p[1]; b += p[2]; n++;
  }
  return [r / n, g / n, b / n];
};
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Pinta un rectángulo de la lámina con una continuación suave del fondo (para borrar rótulos y vecinos). */
function applyFill(buf, f) {
  const [rl, rt, rw, rh] = f.rect;
  for (let y = rt; y < rt + rh; y++) {
    for (let x = rl; x < rl + rw; x++) {
      let c;
      if (f.from === 'top') {
        const t = avg(x, 22);
        const l = avg(12, y);
        const l0 = avg(12, 22);
        c = [t[0] + l[0] - l0[0], t[1] + l[1] - l0[1], t[2] + l[2] - l0[2]];
      } else if (f.from === 'left') {
        c = avg(rl - 3, y);
      } else {
        const t = (y - rt) / (rh - 1);
        const a = avg(x, rt - 3);
        const b = avg(x, rt + rh + 3);
        c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
      // Mezcla suave en el borde del parche para que no se note el rectángulo (4 px).
      const edge = Math.min(x - rl, rl + rw - 1 - x, y - rt, rt + rh - 1 - y);
      const k = smooth(edge / 4);
      const i = (y * SW + x) * 3;
      buf[i] = clamp(buf[i] * (1 - k) + c[0] * k);
      buf[i + 1] = clamp(buf[i + 1] * (1 - k) + c[1] * k);
      buf[i + 2] = clamp(buf[i + 2] * (1 - k) + c[2] * k);
    }
  }
}


async function build(asset) {
  const [l, t, w, h] = asset.box;
  const buf = Buffer.from(S);
  for (const f of asset.fills ?? []) applyFill(buf, f);
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((t + y) * SW + (l + x)) * 3;
    const di = (y * w + x) * 4;
    rgba[di] = buf[si]; rgba[di + 1] = buf[si + 1]; rgba[di + 2] = buf[si + 2]; rgba[di + 3] = 255;
  }

  if (asset.mode === 'feather') {
    const f = asset.feather ?? 8;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      rgba[(y * w + x) * 4 + 3] = Math.round(255 * smooth(d / f));
    }
    return { rgba, w, h, transparency: 'difuminado' };
  }

  // modo key: relleno desde el borde por pasos pequeños entre vecinos (los objetos de colores vivos cortan el relleno)
  const STEP = 9;
  const MAXLUMA = 80;
  const luma = (i) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!bg[i] && luma(i) < MAXLUMA) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (bg[j] || luma(j) >= MAXLUMA) continue;
      const d = Math.max(Math.abs(rgba[i * 4] - rgba[j * 4]), Math.abs(rgba[i * 4 + 1] - rgba[j * 4 + 1]), Math.abs(rgba[i * 4 + 2] - rgba[j * 4 + 2]));
      if (d <= STEP) { bg[j] = 1; stack.push(j); }
    }
  }
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = bg[i] ? 0 : 255;
  const blurred = await sharp(mask, { raw: { width: w, height: h, channels: 1 } }).blur(0.7).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const soft = blurred.data;
  if (blurred.info.channels !== 1) throw new Error(`máscara con ${blurred.info.channels} canales`);
  let minX = w, minY = h, maxX = 0, maxY = 0, kept = 0;
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4 + 3] = soft[i];
    if (soft[i] > 40) {
      kept++;
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { rgba, w, h, transparency: 'real', trim: [minX, minY, maxX - minX + 1, maxY - minY + 1], keptRatio: kept / (w * h) };
}

const inventory = [];
for (const asset of ASSETS) {
  const r = await build(asset);
  let img = sharp(r.rgba, { raw: { width: r.w, height: r.h, channels: 4 } });
  let [w, h] = [r.w, r.h];
  if (r.trim) {
    const pad = 2;
    const [tx, ty, tw, th] = r.trim;
    const left = Math.max(0, tx - pad), top = Math.max(0, ty - pad);
    w = Math.min(r.w - left, tw + pad * 2);
    h = Math.min(r.h - top, th + pad * 2);
    img = img.extract({ left, top, width: w, height: h });
  }
  const file = `${asset.id}.webp`;
  const info = await img.webp({ quality: 90, alphaQuality: 95, effort: 6 }).toFile(`${OUT}/${file}`);
  inventory.push({ id: asset.id, group: asset.group, file, width: w, height: h, bytes: info.size, transparency: r.transparency, sourceBox: asset.box, keptRatio: r.keptRatio ? Number(r.keptRatio.toFixed(2)) : undefined });
}
writeFileSync(`${OUT}/inventory.json`, JSON.stringify({ source: 'reference-sheet.webp', note: 'Recortes de una lámina plana. transparency=real: fondo quitado; difuminado: conserva el fondo oscuro con bordes a transparente.', assets: inventory }, null, 2) + '\n');
console.log(`✔ ${inventory.length} recursos en ${OUT}/ (${inventory.reduce((n, a) => n + a.bytes, 0)} bytes)`);
