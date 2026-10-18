/**
 * Descarga a una carpeta LOCAL fotos libres (SOLO CC0 y Public Domain Mark) de Openverse y de museos con API abierta sin clave
 * (Metropolitan Museum of Art y Art Institute of Chicago, ambos CC0) para rellenar la biblioteca. Mismo flujo y misma carpeta que
 * `npm run library` (Commons): cada imagen se normaliza (WebP interno), se descartan las casi duplicadas por huella perceptual y se
 * escribe manifest.csv (roles, categoría, etiquetas, autor, licencia, fuente), FUENTES.md e index.html. Nada se sube a la app desde aquí.
 *
 *   npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --contact tu@correo
 *   npm run library:openverse -- --all --source openverse --contact tu@correo
 *   npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --source met      # museo (también: artic, o «all» = los tres)
 *   npm run library:openverse -- --pack docs/catalogo-semilla/plantas-y-flores.txt --dry-run # solo busca y lista candidatos, no descarga
 *   npm run library:openverse -- --index-only                                                # regenera manifest.csv/FUENTES.md/index.html
 *
 * Opciones: --source openverse|met|artic|all (por defecto openverse) · --out (biblioteca-pendiente) · --per-product 1 · --min-width 800
 *           · --delay 2000 (ms entre peticiones) · --max-bytes (por imagen, 25 MB) · --roles · --category · --tags (como en library:fetch)
 *           · --dedupe-distance 6 (bits de la huella perceptual; 0 = solo idénticas) · --open · --contact "tu@correo" (va en el User-Agent).
 * Clave OPCIONAL y GRATUITA de Openverse (sin ella el acceso anónimo tiene un tope diario muy bajo): variables de entorno
 * OPENVERSE_CLIENT_ID y OPENVERSE_CLIENT_SECRET (nunca se imprimen ni se guardan). Detalle: docs/FUENTES-OPENVERSE-MUSEOS.md.
 * NO probado contra los servicios reales desde el entorno de desarrollo (sin red): solo con respuestas simuladas.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePack, splitQueries, type ManifestRow } from '../../src/lib/library/commons';
import { downloadImage, FREE_SOURCES, openverseToken, searchFree, type FreeSource } from '../../src/lib/library/free-sources';
import { ingestImage } from '../../src/lib/library/ingest';
import { defaultRolesForKind, NEAR_DUPLICATE_DISTANCE, parseRoles } from '../../src/lib/library/taxonomy';
import { loadState, saveState, writeIndexes } from './shared';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const out = resolve(opt('out') ?? 'biblioteca-pendiente');
const perProduct = Math.max(1, Number(opt('per-product') ?? 1));
const delay = Number(opt('delay') ?? 2000);
const minWidth = Number(opt('min-width') ?? 800);
const maxBytes = Number(opt('max-bytes') ?? 25 * 1024 * 1024);
const dedupe = Number(opt('dedupe-distance') ?? NEAR_DUPLICATE_DISTANCE);
const dryRun = flag('dry-run');
const contact = opt('contact') ?? process.env.LIBRARY_CONTACT ?? 'contacto-no-indicado';
const userAgent = `SubastaSalvajeLibrary/1.0 (${contact}; relleno manual de una biblioteca de fotos CC0) node`;
const sourceArg = opt('source') ?? 'openverse';
const sources: FreeSource[] = sourceArg === 'all' ? [...FREE_SOURCES] : FREE_SOURCES.filter((s) => s === sourceArg);
const forcedRoles = opt('roles') ? parseRoles(opt('roles')) : undefined;
const forcedCategory = opt('category');
const extraTags = (opt('tags') ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
const HASHES = join(out, 'huellas.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const loadHashes = (): Record<string, string> => (existsSync(HASHES) ? (JSON.parse(readFileSync(HASHES, 'utf8')) as Record<string, string>) : {});

let token: string | undefined;

async function runPack(file: string): Promise<void> {
  const pack = parsePack(readFileSync(file, 'utf8'), (file.split(/[\\/]/).pop() ?? 'Coleccion').replace(/\.txt$/, ''));
  const colName = safeName(pack.collection);
  const dir = join(out, colName);
  mkdirSync(dir, { recursive: true });
  const rows = loadState(out);
  const hashes = loadHashes();
  const used = new Set(rows.map((r) => r.fuente));
  writeFileSync(join(dir, 'productos.txt'), pack.products.map((p) => [p.name, p.description, p.emoji].join('; ')).join('\n') + '\n');
  console.log(`\n== ${pack.collection} (${pack.products.length} productos) · fuentes: ${sources.join(', ')}${dryRun ? ' · ENSAYO (no descarga)' : ''}`);
  for (const p of pack.products) {
    const have = rows.filter((r) => r.coleccion === colName && r.titulo === p.name).length;
    if (have >= perProduct) { console.log(`  · ${p.name}: ya descargado`); continue; }
    let saved = have;
    try {
      search: for (const source of sources) {
        for (const q of splitQueries(p.query)) {
          const found = (await searchFree(source, q, { userAgent, minWidth, token, limit: 15 })).filter((c) => !used.has(c.pageUrl));
          await sleep(delay);
          for (const c of found) {
            if (saved >= perProduct) break search;
            if (dryRun) { console.log(`  ? ${p.name} ← [${source}] ${c.title} (${c.license}, ${c.author}) ${c.pageUrl}`); saved++; continue; }
            let bytes: Uint8Array;
            try { bytes = await downloadImage(c.url, { userAgent, maxBytes }); } catch (e) { console.log(`    · descartada (${(e as Error).message}): ${c.pageUrl}`); await sleep(delay); continue; }
            await sleep(delay);
            const r = await ingestImage(bytes, pack.kind, hashes, { minWidth, maxDistance: dedupe });
            if (!r.ok) { console.log(`    · descartada (${r.reason}: ${r.detail}): ${c.pageUrl}`); used.add(c.pageUrl); continue; }
            const archivo = `${safeName(p.name)}${perProduct > 1 || saved > 0 ? ` ${saved + 1}` : ''}.webp`;
            writeFileSync(join(dir, archivo), r.bytes);
            hashes[`${colName}/${archivo}`] = r.hash;
            writeFileSync(HASHES, JSON.stringify(hashes, null, 2));
            used.add(c.pageUrl);
            const row: ManifestRow = { coleccion: colName, archivo, titulo: p.name, autor: c.author, licencia: c.license, fuente: c.pageUrl, tipo: pack.kind, roles: forcedRoles ?? pack.roles ?? defaultRolesForKind(pack.kind), categoria: forcedCategory ?? pack.category ?? colName, etiquetas: [...new Set([...extraTags, ...(source === 'openverse' ? [] : ['museo'])])] };
            rows.push(row);
            saveState(out, rows);
            saved++;
            console.log(`  ✔ ${p.name} ← [${source}] ${c.title} (${c.license}, ${c.author})`);
          }
        }
      }
      if (saved === have) console.log(`  ✖ ${p.name}: sin resultados libres/nuevos para «${p.query}» (prueba otra búsqueda en el pack o otra fuente)`);
    } catch (e) {
      console.log(`  ✖ ${p.name}: ${(e as Error).message}`);
      if ((e as { rateLimited?: boolean }).rateLimited) { console.log('Parada: el servicio pide más calma. Vuelve a ejecutar más tarde (salta lo ya descargado).'); return; }
    }
  }
}

async function main() {
  mkdirSync(out, { recursive: true });
  if (!flag('index-only')) {
    if (sources.length === 0) { console.error(`--source debe ser ${FREE_SOURCES.join(', ')} o all`); process.exit(1); }
    const packs = flag('all')
      ? readdirSync('docs/catalogo-semilla').filter((f) => f.endsWith('.txt')).map((f) => join('docs/catalogo-semilla', f))
      : opt('pack') ? [opt('pack')!] : [];
    if (packs.length === 0) { console.error('Uso: npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --contact tu@correo   (o --all, o --index-only)'); process.exit(1); }
    if (contact === 'contacto-no-indicado') console.warn('Consejo: añade --contact "tu@correo" (Openverse y los museos piden identificar al cliente en el User-Agent).');
    const id = process.env.OPENVERSE_CLIENT_ID;
    const secret = process.env.OPENVERSE_CLIENT_SECRET;
    if (sources.includes('openverse')) {
      if (id && secret) { token = await openverseToken(id, secret, { userAgent }); console.log('Openverse: acceso autenticado con tu clave gratuita.'); }
      else console.warn('Openverse: acceso anónimo (tope diario bajo). Registra una clave GRATUITA y exporta OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET para más cupo.');
    }
    for (const f of packs) await runPack(f);
  }
  if (!dryRun) writeIndexes(out, flag('open'));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
