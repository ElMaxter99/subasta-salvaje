/**
 * Descarga a una carpeta LOCAL fotos libres (CC0 / dominio público por defecto) de Wikimedia Commons para rellenar la biblioteca.
 * Nada se sube a la app desde aquí: primero se revisan los archivos en tu ordenador y luego se suben con «Elegir una carpeta» en
 * Superadmin → Biblioteca → Imágenes (lee el manifest.csv: colección, título, tipo y crédito de cada foto, todo en un commit).
 *
 *   npm run library -- --contact tu@correo                                           # TODO en uno: descarga todos los packs y abre la galería
 *   npm run library:fetch -- --pack docs/catalogo-semilla/halloween.txt            # un solo pack
 *   npm run library:fetch -- --all                                                 # todos los packs, sin abrir la galería
 *   npm run library:fetch -- --all --out mi-carpeta --allow-by --min-width 1000
 *   npm run library:fetch -- --index-only      # tras borrar a mano las fotos malas: regenera manifest.csv, index.html y FUENTES.md
 *
 * Etiquetado: --roles start,product · --category "Halloween" · --tags terror,otoño (también se leen `# Rol:` y `# Categoría:` del pack).
 * Opciones: --open (abre index.html al terminar; `npm run library` ya lo hace) · --out (por defecto biblioteca-pendiente) · --per-product 1 · --allow-by (acepta también CC BY / CC BY-SA, con atribución)
 *           · --min-width 800 · --delay 1500 (ms entre peticiones; sé amable con Wikimedia) · --contact "tu@correo" (va en el User-Agent).
 * Cada pack (docs/catalogo-semilla/*.txt) lista los productos con su búsqueda en inglés. Se puede repetir: salta lo ya descargado.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePack, searchCommons, splitQueries } from '../../src/lib/library/commons';
import { loadState, saveState, writeIndexes } from './shared';
import { defaultRolesForKind, parseRoles } from '../../src/lib/library/taxonomy';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const out = resolve(opt('out') ?? 'biblioteca-pendiente');
const perProduct = Math.max(1, Number(opt('per-product') ?? 1));
const delay = Number(opt('delay') ?? 1500);
const minWidth = Number(opt('min-width') ?? 800);
const allowBy = flag('allow-by');
const contact = opt('contact') ?? process.env.LIBRARY_CONTACT ?? 'contacto-no-indicado';
const userAgent = `SubastaSalvajeLibrary/1.0 (${contact}; relleno manual de una biblioteca de fotos) node`;
// Etiquetado (opcional; si no se indica, rol según el tipo del pack y categoría = colección): --roles start,product · --category "Halloween" · --tags terror,otoño
const forcedRoles = opt('roles') ? parseRoles(opt('roles')) : undefined;
const forcedCategory = opt('category');
const extraTags = (opt('tags') ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const ext = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (res.status === 429 && attempt < 4) { await sleep(10_000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`descarga ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

async function search(query: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await searchCommons(query, { userAgent, minWidth, allowBy, limit: 30 }); } catch (e) {
      if ((e as { rateLimited?: boolean }).rateLimited && attempt < 4) { await sleep(10_000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

async function runPack(file: string): Promise<void> {
  const pack = parsePack(readFileSync(file, 'utf8'), (file.split(/[\\/]/).pop() ?? 'Coleccion').replace(/\.txt$/, ''));
  const dir = join(out, safeName(pack.collection));
  mkdirSync(dir, { recursive: true });
  const rows = loadState(out);
  const used = new Set(rows.map((r) => r.fuente));
  writeFileSync(join(dir, 'productos.txt'), pack.products.map((p) => [p.name, p.description, p.emoji].join('; ')).join('\n') + '\n');
  console.log(`\n== ${pack.collection} (${pack.products.length} productos)`);
  for (const p of pack.products) {
    const have = rows.filter((r) => r.coleccion === safeName(pack.collection) && r.titulo === p.name).length;
    if (have >= perProduct) { console.log(`  · ${p.name}: ya descargado`); continue; }
    try {
      let found: Awaited<ReturnType<typeof search>> = [];
      for (const q of splitQueries(p.query)) { // alternativas «inglés || español»: se usa la primera que dé resultados libres
        found = (await search(q)).filter((c) => !used.has(c.pageUrl)).slice(0, perProduct - have);
        await sleep(delay);
        if (found.length) break;
      }
      if (found.length === 0) { console.log(`  ✖ ${p.name}: sin resultados libres para «${p.query}» (prueba otra búsqueda en el pack)`); continue; }
      for (const [i, c] of found.entries()) {
        const archivo = `${safeName(p.name)}${perProduct > 1 || have + i > 0 ? ` ${have + i + 1}` : ''}.${ext(c.mime)}`;
        writeFileSync(join(dir, archivo), await download(c.url));
        used.add(c.pageUrl);
        rows.push({ coleccion: safeName(pack.collection), archivo, titulo: p.name, autor: c.author, licencia: c.license, fuente: c.pageUrl, tipo: pack.kind, roles: forcedRoles ?? pack.roles ?? defaultRolesForKind(pack.kind), categoria: forcedCategory ?? pack.category ?? safeName(pack.collection), etiquetas: extraTags });
        saveState(out, rows);
        console.log(`  ✔ ${p.name} ← ${c.title} (${c.license}, ${c.author})`);
        await sleep(delay);
      }
    } catch (e) {
      console.log(`  ✖ ${p.name}: ${(e as Error).message}`);
    }
  }
}

async function main() {
  mkdirSync(out, { recursive: true });
  if (!flag('index-only')) {
    const packs = flag('all')
      ? readdirSync('docs/catalogo-semilla').filter((f) => f.endsWith('.txt')).map((f) => join('docs/catalogo-semilla', f))
      : opt('pack') ? [opt('pack')!] : [];
    if (packs.length === 0) { console.error('Uso: npm run library:fetch -- --pack docs/catalogo-semilla/halloween.txt   (o --all, o --index-only)'); process.exit(1); }
    if (contact === 'contacto-no-indicado') console.warn('Consejo: añade --contact "tu@correo" (Wikimedia pide identificar al cliente en el User-Agent).');
    for (const f of packs) await runPack(f);
  }
  writeIndexes(out, flag('open'));
}

main().catch((e) => { console.error(e); process.exit(1); });
