import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { acceptedLicense, downloadImage, getJson, openverseToken, searchArtic, searchFree, searchMet, searchOpenverse } from '@/lib/library/free-sources';
import { ingestImage } from '@/lib/library/ingest';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const opts = { userAgent: 'Test/1.0 (a@b.c)', sleep: async () => undefined };

describe('Openverse: solo CC0 y Public Domain Mark', () => {
  const results = [
    { title: '<b>Osito</b>', creator: 'Ana', url: 'https://x.org/a.jpg', foreign_landing_url: 'https://flickr.com/a', license: 'cc0', width: 1600, height: 900, filetype: 'jpg' },
    { title: 'Marca pública', creator: null, url: 'https://x.org/b.png', foreign_landing_url: 'https://museo.org/b', license: 'pdm', width: 1000, height: 1000, filetype: 'png' },
    { title: 'Con atribución', creator: 'Luis', url: 'https://x.org/c.jpg', foreign_landing_url: 'https://flickr.com/c', license: 'by', width: 2000, height: 1000, filetype: 'jpg' },
    { title: 'No comercial', url: 'https://x.org/d.jpg', foreign_landing_url: 'https://flickr.com/d', license: 'by-nc', width: 2000, height: 1000, filetype: 'jpg' },
    { title: 'Pequeña', url: 'https://x.org/e.jpg', foreign_landing_url: 'https://flickr.com/e', license: 'cc0', width: 300, height: 300, filetype: 'jpg' },
    { title: 'Adulta', url: 'https://x.org/f.jpg', foreign_landing_url: 'https://flickr.com/f', license: 'cc0', width: 2000, height: 1000, filetype: 'jpg', mature: true },
    { title: 'Es un GIF', url: 'https://x.org/g.gif', foreign_landing_url: 'https://flickr.com/g', license: 'cc0', width: 2000, height: 1000, filetype: 'gif' },
    { title: 'Sin https', url: 'http://x.org/h.jpg', foreign_landing_url: 'https://flickr.com/h', license: 'cc0', width: 2000, height: 1000, filetype: 'jpg' },
  ];

  it('descarta cualquier otra licencia aunque la API la devuelva, y también adultas, pequeñas, no https y GIF', async () => {
    const found = await searchOpenverse('teddy bear', { ...opts, fetchImpl: (async () => json({ results })) as unknown as typeof fetch });
    expect(found.map((c) => c.title)).toEqual(['Osito', 'Marca pública']);
    expect(found[0]).toMatchObject({ source: 'openverse', license: 'CC0 1.0', author: 'Ana', pageUrl: 'https://flickr.com/a' });
    expect(found[1]).toMatchObject({ license: 'Public Domain Mark 1.0', author: 'Autor desconocido' });
  });

  it('pide solo cc0,pdm con User-Agent identificable y manda el token solo si lo hay', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const spy = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return json({ results: [] }); }) as unknown as typeof fetch;
    await searchOpenverse('toy', { ...opts, fetchImpl: spy });
    await searchOpenverse('toy', { ...opts, fetchImpl: spy, token: 'tok' });
    const u = new URL(seen[0]!.url);
    expect(u.origin + u.pathname).toBe('https://api.openverse.org/v1/images/');
    expect(u.searchParams.get('license')).toBe('cc0,pdm');
    expect(u.searchParams.get('mature')).toBe('false');
    expect(seen[0]!.headers['User-Agent']).toBe('Test/1.0 (a@b.c)');
    expect(seen[0]!.headers.Authorization).toBeUndefined();
    expect(seen[1]!.headers.Authorization).toBe('Bearer tok');
  });

  it('pide el token con client_credentials y no lo inventa si falta', async () => {
    let body = '';
    const ok = (async (_u: string, init: RequestInit) => { body = String(init.body); return json({ access_token: 'abc' }); }) as unknown as typeof fetch;
    expect(await openverseToken('id', 'sec', { ...opts, fetchImpl: ok })).toBe('abc');
    expect(body).toContain('grant_type=client_credentials');
    await expect(openverseToken('id', 'sec', { ...opts, fetchImpl: (async () => json({}, 401)) as unknown as typeof fetch })).rejects.toThrow(/401/);
    await expect(openverseToken('id', 'sec', { ...opts, fetchImpl: (async () => json({})) as unknown as typeof fetch })).rejects.toThrow(/access_token/);
  });

  it('acceptedLicense solo reconoce cc0 y pdm', () => {
    expect(acceptedLicense('CC0')).toBe('CC0 1.0');
    expect(acceptedLicense('pdm')).toBe('Public Domain Mark 1.0');
    for (const no of ['by', 'by-sa', 'by-nc', 'cc0-nc', '', undefined, null]) expect(acceptedLicense(no as string)).toBeNull();
  });
});

describe('reintentos y límites de ritmo', () => {
  it('reintenta ante 429 y 5xx esperando (respeta Retry-After) y acaba bien', async () => {
    const waits: number[] = [];
    const seq = [json({}, 429, { 'retry-after': '3' }), json({}, 503), json({ ok: 1 })];
    const f = (async () => seq.shift()!) as unknown as typeof fetch;
    expect(await getJson('https://x.org', { ...opts, fetchImpl: f, sleep: async (ms) => { waits.push(ms); } })).toEqual({ ok: 1 });
    expect(waits).toEqual([3000, 10000]);
  });

  it('si se agotan los reintentos por 429 avisa con rateLimited, y 401/403 y otros errores fallan claro', async () => {
    const always429 = (async () => json({}, 429)) as unknown as typeof fetch;
    await expect(getJson('https://x.org', { ...opts, fetchImpl: always429, retries: 2 })).rejects.toMatchObject({ rateLimited: true });
    await expect(getJson('https://x.org', { ...opts, fetchImpl: (async () => json({}, 403)) as unknown as typeof fetch })).rejects.toThrow(/403/);
    await expect(getJson('https://x.org', { ...opts, fetchImpl: (async () => json({}, 404)) as unknown as typeof fetch })).rejects.toThrow(/404/);
  });
});

describe('museos con API abierta y sin clave', () => {
  it('Met: solo objetos marcados como dominio público con imagen; CC0 y crédito del museo', async () => {
    const objects: Record<string, unknown> = {
      1: { objectID: 1, title: 'Tetera', isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/1.jpg', objectURL: 'https://www.metmuseum.org/art/collection/search/1', artistDisplayName: '' , culture: 'China' },
      2: { objectID: 2, title: 'Con derechos', isPublicDomain: false, primaryImage: 'https://images.metmuseum.org/2.jpg', objectURL: 'https://www.metmuseum.org/art/collection/search/2' },
      3: { objectID: 3, title: 'Sin imagen', isPublicDomain: true, primaryImage: '', objectURL: 'https://www.metmuseum.org/art/collection/search/3' },
    };
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes('/search?')) return json({ objectIDs: [1, 2, 3] });
      return json(objects[url.split('/').pop()!]);
    }) as unknown as typeof fetch;
    const found = await searchMet('teapot', { ...opts, fetchImpl: f });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: 'met', title: 'Tetera', license: 'CC0 1.0', author: 'China', url: 'https://images.metmuseum.org/1.jpg' });
    const q = new URL(urls[0]!).searchParams;
    expect(q.get('isPublicDomain')).toBe('true');
    expect(q.get('hasImages')).toBe('true');
  });

  it('Art Institute of Chicago: solo is_public_domain con imagen; URL IIIF a 843 px', async () => {
    const f = (async () => json({
      config: { iiif_url: 'https://www.artic.edu/iiif/2' },
      data: [
        { id: 10, title: 'Sombrero', image_id: 'abc-123', artist_title: 'Anónimo', is_public_domain: true },
        { id: 11, title: 'Protegida', image_id: 'zzz', is_public_domain: false },
        { id: 12, title: 'Sin imagen', image_id: null, is_public_domain: true },
      ],
    })) as unknown as typeof fetch;
    const found = await searchArtic('hat', { ...opts, fetchImpl: f });
    expect(found).toEqual([expect.objectContaining({ source: 'artic', title: 'Sombrero', license: 'CC0 1.0', url: 'https://www.artic.edu/iiif/2/abc-123/full/843,/0/default.jpg', pageUrl: 'https://www.artic.edu/artworks/10' })]);
  });

  it('searchFree elige la fuente', async () => {
    const f = (async () => json({ results: [], data: [], objectIDs: null })) as unknown as typeof fetch;
    for (const s of ['openverse', 'met', 'artic'] as const) expect(await searchFree(s, 'x', { ...opts, fetchImpl: f })).toEqual([]);
  });
});

describe('descarga acotada', () => {
  it('rechaza http, lo que declara pesar demasiado y lo que pesa demasiado', async () => {
    await expect(downloadImage('http://x.org/a.jpg', opts)).rejects.toThrow(/https/);
    const big = (async () => new Response(new Uint8Array(10), { headers: { 'content-length': '999999999' } })) as unknown as typeof fetch;
    await expect(downloadImage('https://x.org/a.jpg', { ...opts, fetchImpl: big })).rejects.toThrow(/demasiado grande/);
    const real = (async () => new Response(new Uint8Array(50))) as unknown as typeof fetch;
    await expect(downloadImage('https://x.org/a.jpg', { ...opts, fetchImpl: real, maxBytes: 10 })).rejects.toThrow(/demasiado grande/);
    expect((await downloadImage('https://x.org/a.jpg', { ...opts, fetchImpl: real })).length).toBe(50);
  });
});

describe('ingesta: normalización y duplicados por huella perceptual', () => {
  const gradient = (w: number, h: number, invert = false) => {
    const data = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.round(((invert ? w - x : x) / w) * 255); const o = (y * w + x) * 3; data[o] = v; data[o + 1] = Math.round((y / h) * 200); data[o + 2] = 255 - v; }
    return sharp(data, { raw: { width: w, height: h, channels: 3 } });
  };

  it('normaliza a WebP del tamaño interno, rechaza la casi idéntica, deja pasar otra distinta y descarta pequeñas o no válidas', async () => {
    const original = await gradient(1600, 1200).jpeg().toBuffer();
    const a = await ingestImage(original, 'item', {}, { minWidth: 800 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(Math.max(a.width, a.height)).toBeLessThanOrEqual(768);
    expect((await sharp(a.bytes).metadata()).format).toBe('webp');

    const resized = await gradient(1000, 750).png().toBuffer(); // misma imagen en otro tamaño y formato
    const dup = await ingestImage(resized, 'item', { 'Juguetes/Osito.webp': a.hash }, { minWidth: 800 });
    expect(dup).toMatchObject({ ok: false, reason: 'duplicate' });

    const different = await gradient(1600, 1200, true).jpeg().toBuffer();
    expect((await ingestImage(different, 'item', { 'Juguetes/Osito.webp': a.hash }, { minWidth: 800 })).ok).toBe(true);

    const small = await gradient(400, 300).jpeg().toBuffer();
    expect(await ingestImage(small, 'item', {}, { minWidth: 800 })).toMatchObject({ ok: false, reason: 'too_small' });
    expect(await ingestImage(new Uint8Array([1, 2, 3]), 'item', {})).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
