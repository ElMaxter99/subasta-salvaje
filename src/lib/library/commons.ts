/**
 * Búsqueda de imágenes libres en Wikimedia Commons (API MediaWiki, sin clave) para rellenar la biblioteca. Solo lógica pura (testable con
 * `fetch` simulado); la descarga a disco está en scripts/library/fetch-commons.ts. Por defecto SOLO acepta CC0 / dominio público.
 * Sin probar contra la API real desde el entorno de desarrollo (sin red): los campos siguen la documentación de MediaWiki.
 */
import { parseRoles, type LibraryRole } from './taxonomy';

export interface CommonsCandidate {
  title: string;
  /** Miniatura grande (ancho pedido) lista para descargar. */
  url: string;
  width: number;
  height: number;
  mime: string;
  author: string;
  license: string;
  pageUrl: string;
}

export interface CommonsOptions {
  fetchImpl?: typeof fetch;
  userAgent: string;
  limit?: number;
  thumbWidth?: number;
  minWidth?: number;
  /** Acepta además CC BY y CC BY-SA (exigen atribución, que se guarda en el crédito). */
  allowBy?: boolean;
}

const API = 'https://commons.wikimedia.org/w/api.php';
const FREE = /^(cc0|cc[- ]zero|public domain|pd[- ]|pdm)/i;
const BY = /^cc by(-sa)?[ -]/i;
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function licenseAllowed(shortName: string, allowBy: boolean): boolean {
  const s = shortName.trim();
  return FREE.test(s) || (allowBy && BY.test(s));
}

interface RawPage {
  title?: string;
  index?: number;
  imageinfo?: {
    thumburl?: string; thumbwidth?: number; thumbheight?: number; url?: string; width?: number; height?: number; mime?: string; descriptionurl?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** Devuelve los candidatos válidos (licencia permitida, formato y tamaño adecuados) en el orden de relevancia de Commons. */
export async function searchCommons(query: string, o: CommonsOptions): Promise<CommonsCandidate[]> {
  const doFetch = o.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: String(o.limit ?? 30),
    gsrsearch: `${query} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(o.thumbWidth ?? 1280),
    iiextmetadatafilter: 'LicenseShortName|Artist|Restrictions',
  });
  const res = await doFetch(`${API}?${params}`, { headers: { 'User-Agent': o.userAgent, Accept: 'application/json' } });
  if (res.status === 429) throw Object.assign(new Error('Commons pide ir más despacio (429)'), { rateLimited: true });
  if (!res.ok) throw new Error(`Commons respondió ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: Record<string, RawPage> } };
  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: CommonsCandidate[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !info.mime || !MIMES.has(info.mime)) continue;
    const meta = info.extmetadata ?? {};
    const license = stripHtml(meta.LicenseShortName?.value ?? '');
    if (!licenseAllowed(license, o.allowBy ?? false)) continue;
    if (/personality|trademark|marca/i.test(stripHtml(meta.Restrictions?.value ?? ''))) continue;
    const width = info.thumbwidth ?? info.width ?? 0;
    if (width < (o.minWidth ?? 800)) continue;
    const url = info.thumburl ?? info.url;
    if (!url || !info.descriptionurl) continue;
    out.push({
      title: (p.title ?? '').replace(/^File:/, '').replace(/\.[^.]+$/, ''),
      url, width, height: info.thumbheight ?? info.height ?? 0, mime: info.mime,
      author: stripHtml(meta.Artist?.value ?? '').slice(0, 80) || 'Autor desconocido',
      license, pageUrl: info.descriptionurl,
    });
  }
  return out;
}

/* ---------- Packs de productos («Nombre; Descripción; Emoji; búsqueda en inglés») ---------- */

export interface PackProduct { name: string; description: string; emoji: string; query: string }
export interface Pack {
  collection: string;
  kind: 'item' | 'scene';
  /** `# Rol: start, product` (opcional; por defecto sale del tipo: escena → start, objeto → product). */
  roles?: LibraryRole[];
  /** `# Categoría: Halloween` (opcional; por defecto, la colección). */
  category?: string;
  products: PackProduct[];
}

export function parsePack(text: string, fallbackCollection: string): Pack {
  let collection = fallbackCollection;
  let kind: 'item' | 'scene' = 'item';
  let roles: LibraryRole[] | undefined;
  let category: string | undefined;
  const products: PackProduct[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^#\s*(colecci[oó]n|tipo|rol(?:es)?|categor[ií]a)\s*:\s*(.+)$/i.exec(line);
    if (head) {
      if (/^colecci/i.test(head[1]!)) collection = head[2]!.trim();
      else if (/^rol/i.test(head[1]!)) roles = parseRoles(head[2]!.replace(/inicio/gi, 'start').replace(/producto/gi, 'product'));
      else if (/^categor/i.test(head[1]!)) category = head[2]!.trim();
      else kind = /escena|scene/i.test(head[2]!) ? 'scene' : 'item';
      continue;
    }
    if (line.startsWith('#')) continue;
    const [name = '', description = '', emoji = '', query = ''] = line.split(';').map((s) => s.trim());
    if (!name || name.length > 80) continue;
    products.push({ name, description, emoji, query: query || name });
  }
  return { collection, kind, ...(roles && roles.length ? { roles } : {}), ...(category ? { category } : {}), products };
}

/** La 4.ª columna de un pack admite alternativas separadas por `||` (p. ej. «dog hat || perro con sombrero»): se prueban en orden hasta que una dé resultados libres. */
export const splitQueries = (query: string): string[] => {
  const list = query.split('||').map((q) => q.trim()).filter(Boolean);
  return list.length ? list : [query.trim()];
};

/* ---------- Manifiesto (CSV) que lee también la pantalla de subida ---------- */

export interface ManifestRow {
  coleccion: string; archivo: string; titulo: string; autor: string; licencia: string; fuente: string; tipo: 'item' | 'scene';
  /** Opcionales (columnas nuevas; un manifiesto antiguo sin ellas sigue valiendo). `roles`: «start|product». `etiquetas`: «a|b|c». */
  roles?: LibraryRole[]; categoria?: string; etiquetas?: string[];
}
export const MANIFEST_HEADER = 'coleccion,archivo,titulo,autor,licencia,fuente,tipo,roles,categoria,etiquetas';

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const splitList = (s: string): string[] => s.split(/[|;]/).map((x) => x.trim()).filter(Boolean);

export function manifestToCsv(rows: ManifestRow[]): string {
  return [MANIFEST_HEADER, ...rows.map((r) => [r.coleccion, r.archivo, r.titulo, r.autor, r.licencia, r.fuente, r.tipo, (r.roles ?? []).join('|'), r.categoria ?? '', (r.etiquetas ?? []).join('|')].map(csvCell).join(','))].join('\n') + '\n';
}

/** Lee un manifest.csv. Las columnas se identifican por el NOMBRE de la cabecera (el orden no importa) y las nuevas son opcionales. */
export function parseManifestCsv(text: string): ManifestRow[] {
  const rows: string[][] = [];
  let cell = '', row: string[] = [], quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x !== '')) rows.push(row); }
  const [head, ...body] = rows;
  if (!head || head[0] !== 'coleccion') return [];
  const col = (name: string) => head.indexOf(name);
  const idx = { coleccion: 0, archivo: col('archivo'), titulo: col('titulo'), autor: col('autor'), licencia: col('licencia'), fuente: col('fuente'), tipo: col('tipo'), roles: col('roles'), categoria: col('categoria'), etiquetas: col('etiquetas') };
  return body.map((r) => {
    const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? '') : '');
    const roles = parseRoles(get('roles'));
    const etiquetas = splitList(get('etiquetas'));
    const categoria = get('categoria').trim();
    return {
      coleccion: get('coleccion'), archivo: get('archivo'), titulo: get('titulo'), autor: get('autor'), licencia: get('licencia'), fuente: get('fuente'),
      tipo: get('tipo') === 'scene' ? 'scene' : 'item',
      ...(roles.length ? { roles } : {}), ...(categoria ? { categoria } : {}), ...(etiquetas.length ? { etiquetas } : {}),
    } satisfies ManifestRow;
  });
}

/** Crédito que se guarda con la imagen en la biblioteca (máx. 200 caracteres). */
export const creditOf = (r: Pick<ManifestRow, 'autor' | 'licencia' | 'fuente'>): string => [r.autor, r.licencia, r.fuente].filter(Boolean).join(' · ').slice(0, 200);
