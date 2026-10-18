/**
 * Fuentes abiertas ADICIONALES a Wikimedia Commons para rellenar la biblioteca: Openverse (agregador, API pública) y dos museos con API
 * abierta y sin clave: Metropolitan Museum of Art (Open Access, CC0) y Art Institute of Chicago (dominio público, CC0).
 * Solo lógica pura (testable con `fetch` simulado); la descarga a disco está en scripts/library/fetch-openverse.ts.
 *
 * Licencias aceptadas: SOLO CC0 y Public Domain Mark (`cc0`, `pdm`). Nada con atribución obligatoria (CC BY…) ni «no comercial».
 * HONESTIDAD: escrito según la documentación pública de cada API y probado únicamente con respuestas simuladas; NO se ha probado contra los
 * servicios reales desde el entorno de desarrollo (sin red). Condiciones y campos pueden cambiar: ver docs/FUENTES-OPENVERSE-MUSEOS.md.
 */

export type FreeSource = 'openverse' | 'met' | 'artic';
export const FREE_SOURCES: readonly FreeSource[] = ['openverse', 'met', 'artic'];

export interface FreeCandidate {
  source: FreeSource;
  title: string;
  /** Imagen lista para descargar (https). */
  url: string;
  width: number;
  height: number;
  author: string;
  /** Texto de licencia para el crédito: «CC0 1.0» o «Public Domain Mark 1.0». */
  license: string;
  /** Página de origen (la que se enlaza en el crédito). */
  pageUrl: string;
}

export interface FreeSearchOptions {
  fetchImpl?: typeof fetch;
  /** User-Agent identificable con contacto (obligatorio en la práctica: Openverse y los museos lo piden). */
  userAgent: string;
  /** Máximo de candidatos que se devuelven. */
  limit?: number;
  minWidth?: number;
  /** Solo Openverse: token OAuth2 (clave gratuita). Sin él se usa el acceso anónimo, con un límite diario muy bajo. */
  token?: string;
  /** Pausa entre reintentos y entre peticiones internas (inyectable para los tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Reintentos ante 429/5xx (por defecto 4). */
  retries?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Licencias aceptadas, normalizadas. Devuelve `null` si no es CC0 / dominio público. */
export function acceptedLicense(raw: string | undefined | null): 'CC0 1.0' | 'Public Domain Mark 1.0' | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'cc0') return 'CC0 1.0';
  if (s === 'pdm') return 'Public Domain Mark 1.0';
  return null;
}

/** GET con reintentos y espera creciente (respeta `Retry-After`) ante 429 y 5xx. Lanza con `rateLimited` si se agotan por 429. */
export async function getJson<T>(url: string, o: FreeSearchOptions, headers: Record<string, string> = {}): Promise<T> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? realSleep;
  const retries = o.retries ?? 4;
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url, { headers: { 'User-Agent': o.userAgent, Accept: 'application/json', ...headers } });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) * 1000 : 5000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429) throw Object.assign(new Error('el servicio pide ir más despacio (429) y se agotaron los reintentos'), { rateLimited: true });
    if (res.status === 401 || res.status === 403) throw new Error(`el servicio rechazó la petición (${res.status}): revisa el token o el User-Agent`);
    if (!res.ok) throw new Error(`el servicio respondió ${res.status}`);
    return (await res.json()) as T;
  }
}

const clean = (s: unknown, max: number): string => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//i.test(u);

/* ---------- Openverse ---------- */

const OPENVERSE = 'https://api.openverse.org/v1';

interface OpenverseResult {
  title?: string; creator?: string; url?: string; foreign_landing_url?: string; license?: string; width?: number; height?: number;
  filetype?: string; mature?: boolean; source?: string;
}

/** Cuerpo de la petición de token (OAuth2 client credentials) con la clave GRATUITA del propietario; se lee de variables de entorno, nunca se guarda. */
export async function openverseToken(clientId: string, clientSecret: string, o: FreeSearchOptions): Promise<string> {
  const doFetch = o.fetchImpl ?? fetch;
  const res = await doFetch(`${OPENVERSE}/auth_tokens/token/`, {
    method: 'POST',
    headers: { 'User-Agent': o.userAgent, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Openverse no dio token (${res.status}): revisa OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Openverse respondió sin access_token');
  return json.access_token;
}

export async function searchOpenverse(query: string, o: FreeSearchOptions): Promise<FreeCandidate[]> {
  const params = new URLSearchParams({
    q: query, license: 'cc0,pdm', mature: 'false', extension: 'jpg,jpeg,png,webp', page_size: String(Math.min(o.limit ?? 20, 50)),
  });
  const json = await getJson<{ results?: OpenverseResult[] }>(`${OPENVERSE}/images/?${params}`, o, o.token ? { Authorization: `Bearer ${o.token}` } : {});
  const out: FreeCandidate[] = [];
  for (const r of json.results ?? []) {
    const license = acceptedLicense(r.license); // el filtro de la API no basta: se vuelve a comprobar aquí
    if (!license || r.mature) continue;
    if (!isHttps(r.url) || !isHttps(r.foreign_landing_url)) continue;
    if (!/^(jpe?g|png|webp)$/i.test(r.filetype ?? '') && !/\.(jpe?g|png|webp)(\?|$)/i.test(r.url)) continue;
    if ((r.width ?? 0) < (o.minWidth ?? 800)) continue;
    out.push({
      source: 'openverse', title: clean(r.title, 80) || 'Sin título', url: r.url, width: r.width ?? 0, height: r.height ?? 0,
      author: clean(r.creator, 80) || 'Autor desconocido', license, pageUrl: r.foreign_landing_url,
    });
  }
  return out;
}

/* ---------- Metropolitan Museum of Art (Open Access, sin clave) ---------- */

const MET = 'https://collectionapi.metmuseum.org/public/collection/v1';

interface MetObject {
  objectID?: number; title?: string; isPublicDomain?: boolean; primaryImage?: string; primaryImageSmall?: string;
  artistDisplayName?: string; objectURL?: string; department?: string; culture?: string;
}

export async function searchMet(query: string, o: FreeSearchOptions): Promise<FreeCandidate[]> {
  const params = new URLSearchParams({ q: query, hasImages: 'true', isPublicDomain: 'true' });
  const found = await getJson<{ objectIDs?: number[] | null }>(`${MET}/search?${params}`, o);
  const sleep = o.sleep ?? realSleep;
  const out: FreeCandidate[] = [];
  for (const id of (found.objectIDs ?? []).slice(0, (o.limit ?? 10) * 2)) {
    if (out.length >= (o.limit ?? 10)) break;
    const obj = await getJson<MetObject>(`${MET}/objects/${id}`, o);
    await sleep(100); // ≤ 10 peticiones/s, muy por debajo del tope publicado (80/s)
    if (!obj.isPublicDomain || !isHttps(obj.primaryImage) || !isHttps(obj.objectURL)) continue; // CC0 solo si el museo lo marca como dominio público
    out.push({
      source: 'met', title: clean(obj.title, 80) || 'Sin título', url: obj.primaryImage, width: 0, height: 0, // el museo no da el tamaño: se comprueba al normalizar
      author: clean(obj.artistDisplayName, 80) || clean(obj.culture, 80) || 'The Metropolitan Museum of Art', license: 'CC0 1.0', pageUrl: obj.objectURL,
    });
  }
  return out;
}

/* ---------- Art Institute of Chicago (sin clave) ---------- */

const ARTIC = 'https://api.artic.edu/api/v1';

interface ArticArtwork { id?: number; title?: string; image_id?: string | null; artist_title?: string | null; is_public_domain?: boolean | null; thumbnail?: { width?: number; height?: number } | null }

export async function searchArtic(query: string, o: FreeSearchOptions): Promise<FreeCandidate[]> {
  const params = new URLSearchParams({
    q: query, 'query[term][is_public_domain]': 'true', fields: 'id,title,image_id,artist_title,is_public_domain,thumbnail', limit: String(Math.min(o.limit ?? 10, 50)),
  });
  const json = await getJson<{ data?: ArticArtwork[]; config?: { iiif_url?: string } }>(`${ARTIC}/artworks/search?${params}`, o);
  const iiif = json.config?.iiif_url ?? 'https://www.artic.edu/iiif/2';
  const out: FreeCandidate[] = [];
  for (const a of json.data ?? []) {
    if (a.is_public_domain !== true || !a.image_id || !a.id) continue; // solo lo que el museo marca como dominio público (CC0)
    out.push({
      source: 'artic', title: clean(a.title, 80) || 'Sin título', url: `${iiif}/${encodeURIComponent(a.image_id)}/full/843,/0/default.jpg`, // 843 px: el ancho que el museo recomienda
      width: Math.min(843, a.thumbnail?.width ?? 843), height: 0, author: clean(a.artist_title, 80) || 'Art Institute of Chicago', license: 'CC0 1.0',
      pageUrl: `https://www.artic.edu/artworks/${a.id}`,
    });
  }
  return out;
}

export function searchFree(source: FreeSource, query: string, o: FreeSearchOptions): Promise<FreeCandidate[]> {
  return source === 'openverse' ? searchOpenverse(query, o) : source === 'met' ? searchMet(query, o) : searchArtic(query, o);
}

/** Descarga con tope de tamaño (no se acepta nada de más de `maxBytes`) y solo por https. */
export async function downloadImage(url: string, o: FreeSearchOptions & { maxBytes?: number }): Promise<Uint8Array> {
  if (!isHttps(url)) throw new Error('solo se descargan imágenes por https');
  const max = o.maxBytes ?? 25 * 1024 * 1024;
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url, { headers: { 'User-Agent': o.userAgent } });
    if ((res.status === 429 || res.status >= 500) && attempt < (o.retries ?? 4)) { await sleep(5000 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`descarga ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) throw new Error(`imagen demasiado grande (${Math.round(declared / 1e6)} MB)`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error(`imagen demasiado grande (${Math.round(buf.length / 1e6)} MB)`);
    return buf;
  }
}
