#!/usr/bin/env node
/**
 * Quita un fondo de croma (verde por defecto) y deja PNG/WebP con transparencia REAL. Pensado para renders de la mascota hechos
 * con un modelo de imagen sobre fondo verde liso (ver docs/MASCOTA-RENDERS.md): el personaje es azul marino/blanco/dorado,
 * así que el verde se puede separar sin comerse la ropa (a diferencia del fondo oscuro de la lámina original).
 *
 *   npm run mascot:chroma -- ./renders                       # carpeta o archivo → ./renders/transparentes/*.webp
 *   npm run mascot:chroma -- ./renders --key=#00ff00 --tol=70 --size=1024 --out=./salida --format=png
 *
 * Detalle: la clave es el color indicado; se hace transparente lo que se parece a ella (tolerancia `--tol`, distancia RGB) con un
 * borde suave, y se «limpia» el verde que se cuela en los bordes (despill). Se recorta al contenido, se deja un margen del 6 % y
 * se reduce a `--size` como máximo. No modifica los originales.
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export async function chromaKey(input, { key = [0, 255, 0], tol = 70, soft = 40, size = 1024, pad = 0.06 } = {}) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2]);
    if (d <= tol) data[i + 3] = 0;
    else if (d < tol + soft) {
      data[i + 3] = Math.round(((d - tol) / soft) * 255); // borde suave
      // despill: el borde conserva un tinte de la clave; se reduce el canal dominante de la clave
      const dom = key[1] >= key[0] && key[1] >= key[2] ? 1 : key[0] >= key[2] ? 0 : 2;
      const others = [0, 1, 2].filter((c) => c !== dom);
      data[i + dom] = Math.min(data[i + dom], Math.max(data[i + others[0]], data[i + others[1]]));
    }
  }
  let img = sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 });
  const trimmed = await img.png().toBuffer({ resolveWithObject: true });
  const side = Math.max(trimmed.info.width, trimmed.info.height);
  const margin = Math.round(side * pad);
  img = sharp(trimmed.data).extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } }).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
  return img;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
  if (!input) {
    console.error('Uso: npm run mascot:chroma -- <archivo|carpeta> [--key=#00ff00] [--tol=70] [--size=1024] [--format=webp|png] [--out=carpeta]');
    process.exit(1);
  }
  const hex = opt('key', '#00ff00').replace('#', '');
  const key = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const format = opt('format', 'webp');
  const isDir = (await stat(input)).isDirectory();
  const out = path.resolve(opt('out', isDir ? path.join(input, 'transparentes') : path.join(path.dirname(input), 'transparentes')));
  await mkdir(out, { recursive: true });
  const files = isDir ? (await readdir(input)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => path.join(input, f)) : [input];
  let ok = 0;
  for (const f of files) {
    try {
      const img = await chromaKey(f, { key, tol: Number(opt('tol', 70)), size: Number(opt('size', 1024)) });
      const target = path.join(out, `${path.basename(f).replace(/\.[^.]+$/, '')}.${format}`);
      await (format === 'png' ? img.png({ compressionLevel: 9 }) : img.webp({ quality: 90, alphaQuality: 100 })).toFile(target);
      console.log(`✔ ${path.basename(f)} → ${path.relative(process.cwd(), target)}`);
      ok++;
    } catch (e) {
      console.log(`✖ ${path.basename(f)}: ${e.message}`);
    }
  }
  console.log(`\n${ok}/${files.length} con transparencia en ${out}. Revísalos sobre fondo claro Y oscuro antes de usarlos.`);
}
