/**
 * Descarga a una carpeta LOCAL fotos libres (CC0 / dominio público por defecto) de Wikimedia Commons para rellenar la biblioteca.
 * Nada se sube a la app desde aquí: primero se revisan los archivos en tu ordenador y luego se suben con «Elegir una carpeta» en
 * Superadmin → Biblioteca → Imágenes (lee el manifest.csv: colección, título, tipo y crédito de cada foto, todo en un commit).
 *
 *   npm run library:fetch -- --pack docs/catalogo-semilla/halloween.txt            # un pack
 *   npm run library:fetch -- --all                                                 # todos los packs de docs/catalogo-semilla
 *   npm run library:fetch -- --all --out mi-carpeta --allow-by --min-width 1000
 *   npm run library:fetch -- --index-only      # tras borrar a mano las fotos malas: regenera manifest.csv, index.html y FUENTES.md
 *
 * Opciones: --out (por defecto biblioteca-pendiente) · --per-product 1 · --allow-by (acepta también CC BY / CC BY-SA, con atribución)
 *           · --min-width 800 · --delay 1500 (ms entre peticiones; sé amable con Wikimedia) · --contact "tu@correo" (va en el User-Agent).
 * Cada pack (docs/catalogo-semilla/*.txt) lista los productos con su búsqueda en inglés. Se puede repetir: salta lo ya descargado.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { manifestToCsv, parsePack, searchCommons, type ManifestRow } from '../../src/lib/library/commons';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const out = resolve(opt('out') ?? 'biblioteca-pendiente');
const perProduct = Math.max(1, Number(opt('per-product') ?? 1));
const delay = Number(opt('delay') ?? 1500);
const minWidth = Number(opt('min-width') ?? 800);
const allowBy = flag('allow-by');
const contact = opt('contact') ?? 'contacto-no-indicado';
const userAgent = `SubastaSalvajeLibrary/1.0 (${contact}; relleno manual de una biblioteca de fotos) node`;
const STATE = join(out, 'fuentes.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const ext = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');
const loadState = (): ManifestRow[] => (existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as ManifestRow[]) : []);

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

/** Reescribe manifest.csv, FUENTES.md, index.html y productos.txt a partir de lo que SIGUE existiendo en disco. */
function writeIndexes(): void {
  const rows = loadState().filter((r) => existsSync(join(out, r.coleccion, r.archivo)));
  writeFileSync(STATE, JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'manifest.csv'), manifestToCsv(rows));
  writeFileSync(join(out, 'FUENTES.md'), `# Fuentes de las imágenes\n\n${rows.map((r) => `- **${r.coleccion}/${r.archivo}**: ${r.autor} · ${r.licencia} · ${r.fuente}`).join('\n')}\n`);
  const cols = [...new Set(rows.map((r) => r.coleccion))];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const body = cols.map((c) => `<h2>${esc(c)} <small>(${rows.filter((r) => r.coleccion === c).length})</small></h2><div class="g">${rows.filter((r) => r.coleccion === c).map((r) => `<figure><img loading="lazy" src="${encodeURI(`${r.coleccion}/${r.archivo}`)}"><figcaption><b>${esc(r.titulo)}</b><br>${esc(r.autor)} · ${esc(r.licencia)}<br><a href="${esc(r.fuente)}" target="_blank" rel="noreferrer">origen</a><br><small>${esc(r.archivo)}</small></figcaption></figure>`).join('')}</div>`).join('');
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Biblioteca pendiente</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}figure{margin:0;background:#1d1d2a;border-radius:10px;overflow:hidden}img{width:100%;aspect-ratio:1;object-fit:cover;display:block}figcaption{padding:6px;font-size:12px}a{color:#fbbf24}</style><h1>Biblioteca pendiente (${rows.length} imágenes)</h1><p>Borra de las carpetas lo que no sirva y ejecuta <code>npm run library:fetch -- --index-only</code>. Luego sube la carpeta entera en Superadmin → Biblioteca → «Elegir una carpeta».</p>${body}`);
  console.log(`\n✔ ${rows.length} imágenes en ${cols.length} colecciones.\n  Revisa: ${join(out, 'index.html')}\n  Luego sube la carpeta «${out}» en Superadmin → Biblioteca → Imágenes → «Elegir una carpeta».`);
}

async function runPack(file: string): Promise<void> {
  const pack = parsePack(readFileSync(file, 'utf8'), (file.split(/[\\/]/).pop() ?? 'Coleccion').replace(/\.txt$/, ''));
  const dir = join(out, safeName(pack.collection));
  mkdirSync(dir, { recursive: true });
  const rows = loadState();
  const used = new Set(rows.map((r) => r.fuente));
  writeFileSync(join(dir, 'productos.txt'), pack.products.map((p) => [p.name, p.description, p.emoji].join('; ')).join('\n') + '\n');
  console.log(`\n== ${pack.collection} (${pack.products.length} productos)`);
  for (const p of pack.products) {
    const have = rows.filter((r) => r.coleccion === safeName(pack.collection) && r.titulo === p.name).length;
    if (have >= perProduct) { console.log(`  · ${p.name}: ya descargado`); continue; }
    try {
      const found = (await search(p.query)).filter((c) => !used.has(c.pageUrl)).slice(0, perProduct - have);
      await sleep(delay);
      if (found.length === 0) { console.log(`  ✖ ${p.name}: sin resultados libres para «${p.query}» (prueba otra búsqueda en el pack)`); continue; }
      for (const [i, c] of found.entries()) {
        const archivo = `${safeName(p.name)}${perProduct > 1 || have + i > 0 ? ` ${have + i + 1}` : ''}.${ext(c.mime)}`;
        writeFileSync(join(dir, archivo), await download(c.url));
        used.add(c.pageUrl);
        rows.push({ coleccion: safeName(pack.collection), archivo, titulo: p.name, autor: c.author, licencia: c.license, fuente: c.pageUrl, tipo: pack.kind });
        writeFileSync(STATE, JSON.stringify(rows, null, 2));
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
  writeIndexes();
}

main().catch((e) => { console.error(e); process.exit(1); });
