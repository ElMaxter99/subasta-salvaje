#!/usr/bin/env node
/**
 * Lleva fotos al FORMATO INTERNO (WebP, tamaño y peso acotados, sin metadatos) para subirlas a tu CDN y usarlas en las
 * plantillas del sistema. Usa el mismo módulo que el servidor (src/lib/images/normalize.ts), así que lo que sale de aquí
 * pasa sin cambios la validación de la aplicación.
 *
 *   npm run assets:normalize -- ./mis-fotos                       # elementos (768 px) -> ./mis-fotos/normalizadas
 *   npm run assets:normalize -- ./mis-fotos --kind=scene          # imágenes base/escenas (1536x1024)
 *   npm run assets:normalize -- ./mis-fotos --kind=cover --out=./salida
 * Entrada: un archivo o una carpeta (recursiva) con PNG/JPG/WebP. No modifica los originales.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_SPECS, normalizeImage } from '../../src/lib/images/normalize.ts';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const kind = opt('kind') ?? 'item';
if (!input || !(kind in IMAGE_SPECS)) {
  console.error('Uso: npm run assets:normalize -- <archivo|carpeta> [--kind=item|scene|cover] [--out=carpeta]');
  process.exit(1);
}
const isDir = (await stat(input)).isDirectory();
const out = path.resolve(opt('out') ?? (isDir ? path.join(input, 'normalizadas') : path.dirname(input)));

async function* walk(p) {
  if ((await stat(p)).isDirectory()) {
    for (const n of await readdir(p)) {
      const full = path.join(p, n);
      if (path.resolve(full) === out) continue; // no reprocesar la salida
      yield* walk(full);
    }
  } else if (/\.(png|jpe?g|webp)$/i.test(p)) yield p;
}

await mkdir(out, { recursive: true });
let ok = 0, fail = 0, before = 0, after = 0;
for await (const file of walk(input)) {
  const bytes = new Uint8Array(await readFile(file));
  const rel = isDir ? path.relative(input, file) : path.basename(file);
  try {
    const n = await normalizeImage(bytes, kind);
    const target = path.join(out, rel.replace(/\.[^.]+$/, '') + '.webp');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, n.bytes);
    ok++; before += bytes.length; after += n.bytes.length;
    console.log(`✔ ${rel}  ${(bytes.length / 1024).toFixed(0)} KB -> ${(n.bytes.length / 1024).toFixed(0)} KB  (${n.width}x${n.height}, calidad ${n.quality})`);
  } catch (e) {
    fail++;
    console.log(`✖ ${rel}: ${e.message}`);
  }
}
console.log(`\n${ok} imagen(es) en ${out}${fail ? `, ${fail} con error` : ''}. Total: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB.`);
process.exit(fail ? 1 : 0);
