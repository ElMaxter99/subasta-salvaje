// Genera las variantes de marca a partir de public/assets/brand/original/logo-original.webp (RGBA con transparencia real).
// No se redibuja nada: son recortes y máscaras del original. Uso: npm run brand:build
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const SRC = 'public/assets/brand/original/logo-original.webp';
const OUT = 'public/assets/brand';
await mkdir(OUT, { recursive: true });

const base = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = base.info;

/** Copia del original con el alfa multiplicado por keep(x, y) ∈ [0,1]. */
function masked(keep) {
  const d = Buffer.from(base.data);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4 + 3;
    d[i] = Math.round(d[i] * keep(x, y));
  }
  return sharp(d, { raw: { width: W, height: H, channels: 4 } });
}
const save = async (img, name, opts = {}) => {
  let p = img.trim({ threshold: 1 });
  if (opts.crop) p = sharp(await img.png().toBuffer()).extract(opts.crop).trim({ threshold: 1 });
  if (opts.width) p = p.resize({ width: opts.width, withoutEnlargement: true });
  const pad = opts.pad ?? 0;
  if (pad) p = p.extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const buf = await p.png({ compressionLevel: 9 }).toBuffer();
  await writeFile(`${OUT}/${name}.png`, buf);
  const webp = await sharp(buf).webp({ quality: 90, alphaQuality: 95 }).toBuffer();
  await writeFile(`${OUT}/${name}.webp`, webp);
  const m = await sharp(buf).metadata();
  console.log(name, `${m.width}x${m.height}`, `${Math.round(webp.length / 1024)} KB webp`);
  return { name, width: m.width, height: m.height };
};

// 1) Logo completo: el original recortado a su contenido.
const full = await save(masked(() => 1), 'logo-full', { pad: 8, width: 1100 });

// 2) Mascota: busto (la parte inferior queda detrás de las letras en el original, así que se difumina hacia abajo).
const FADE0 = 405, FADE1 = 452;
const mascot = await save(
  masked((x, y) => (x < 395 || x > 1085 || y > FADE1 || (x < 640 && y > 428) ? 0 : y < FADE0 ? 1 : 1 - (y - FADE0) / (FADE1 - FADE0))),
  'mascot', { pad: 6, width: 900 },
);

// 3) Compacto: solo el rótulo con su corona (sin la mascota). Corte a mano por encima de las letras.
const compact = await save(
  masked((x, y) => (x < 640 ? (y >= (x > 598 ? 462 : 428) ? 1 : 0) : y >= 494 ? 1 : y >= 482 ? (y - 482) / 12 : 0)),
  'logo-compact', { pad: 6, width: 700 },
);

const inventoryExtra = {};

// 4) Iconos de aplicación: la cabeza coronada del original sobre azul marino (recorte, no redibujada).
const head = await sharp(await masked((x, y) => (x < 633 || x > 936 || y < 40 || y > 396 || (x > 920 && y > 318) ? 0 : y > 376 ? 1 - (y - 376) / 20 : 1)).png().toBuffer())
  .extract({ left: 633, top: 40, width: 312, height: 356 }).png().toBuffer();
const headWebp = await sharp(head).webp({ quality: 90, alphaQuality: 95 }).toBuffer();
await writeFile(`${OUT}/head.webp`, headWebp);
const headMeta = await sharp(head).metadata();
console.log('head', `${headMeta.width}x${headMeta.height}`, `${Math.round(headWebp.length / 1024)} KB webp`);
inventoryExtra.head = { name: 'head', width: headMeta.width, height: headMeta.height };
async function icon(size, name, { radius = 0.22, inset = 0.08 } = {}) {
  const inner = Math.round(size * (1 - inset * 2));
  const art = await sharp(head).resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#2a3a6e"/><stop offset="1" stop-color="#0a1022"/></radialGradient></defs><rect width="${size}" height="${size}" rx="${Math.round(size * radius)}" fill="url(#g)"/></svg>`);
  await writeFile(`${OUT}/${name}`, await sharp(bg).composite([{ input: art, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer());
  console.log(name, size);
}
await icon(512, 'icon-512.png');
await icon(192, 'icon-192.png');
await icon(512, 'icon-maskable-512.png', { radius: 0, inset: 0.2 }); // zona segura para iconos «maskable»
await icon(180, 'apple-touch-icon.png', { radius: 0, inset: 0.1 });
await icon(64, 'favicon-64.png', { radius: 0.2, inset: 0.04 });

await writeFile(`${OUT}/inventory.json`, JSON.stringify({ source: 'original/logo-original.webp', assets: { full, mascot, compact, ...inventoryExtra } }, null, 2) + '\n');

// 5) Imagen para compartir enlaces (Open Graph 1200×630): logo completo sobre azul marino.
{
  const W2 = 1200, H2 = 630;
  const logo = await sharp(`${OUT}/logo-full.png`).resize({ height: 560, fit: 'inside' }).toBuffer();
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}"><defs><radialGradient id="g" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#2a3a6e"/><stop offset="1" stop-color="#050816"/></radialGradient></defs><rect width="${W2}" height="${H2}" fill="url(#g)"/></svg>`);
  await writeFile(`${OUT}/og-image.png`, await sharp(bg).composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer());
  console.log('og-image.png 1200x630');
}

// 6) Imágenes ligeras para correos (PNG: WebP no se ve en todos los clientes de correo).
{
  const logo = await sharp(`${OUT}/logo-compact.png`).resize({ width: 320 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  await writeFile(`${OUT}/email-logo.png`, logo);
  const headPng = await sharp(head).resize({ width: 160 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  await writeFile(`${OUT}/email-head.png`, headPng);
  console.log('email-logo.png', Math.round(logo.length / 1024), 'KB · email-head.png', Math.round(headPng.length / 1024), 'KB');
}
