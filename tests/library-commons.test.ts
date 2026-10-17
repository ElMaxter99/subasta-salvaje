import { describe, expect, it } from 'vitest';
import { creditOf, licenseAllowed, manifestToCsv, parseManifestCsv, parsePack, searchCommons } from '@/lib/library/commons';

const page = (index: number, title: string, license: string, extra: Record<string, unknown> = {}, mime = 'image/jpeg', width = 1280) => ({
  title: `File:${title}.jpg`, index,
  imageinfo: [{ thumburl: `https://upload.wikimedia.org/${index}.jpg`, thumbwidth: width, thumbheight: 800, mime, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`,
    extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Ana &amp; Co</a>' }, ...extra } }],
});
const fakeFetch = (pages: unknown[], status = 200) => (async () => new Response(JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i), p])) } }), { status })) as unknown as typeof fetch;

describe('Wikimedia Commons: búsqueda de imágenes libres', () => {
  it('solo deja CC0 / dominio público (y CC BY solo si se pide), en formato y tamaño válidos, sin restricciones de marca', async () => {
    const pages = [
      page(3, 'Calabaza buena', 'CC0'),
      page(1, 'Dominio público', 'Public domain'),
      page(2, 'Con atribución', 'CC BY-SA 4.0'),
      page(4, 'Pequeña', 'CC0', {}, 'image/jpeg', 300),
      page(5, 'Es un SVG', 'CC0', {}, 'image/svg+xml'),
      page(6, 'Con marca', 'CC0', { Restrictions: { value: 'trademarked' } }),
    ];
    const strict = await searchCommons('pumpkin', { fetchImpl: fakeFetch(pages), userAgent: 'test' });
    expect(strict.map((c) => c.title)).toEqual(['Dominio público', 'Calabaza buena']); // por relevancia (index)
    expect(strict[0]).toMatchObject({ license: 'Public domain', author: 'Ana & Co', pageUrl: 'https://commons.wikimedia.org/wiki/File:Dominio público.jpg' });
    const loose = await searchCommons('pumpkin', { fetchImpl: fakeFetch(pages), userAgent: 'test', allowBy: true });
    expect(loose.map((c) => c.title)).toContain('Con atribución');
  });

  it('pide a la API lo necesario con un User-Agent identificable y avisa del límite de ritmo', async () => {
    let seen: { url: string; ua: string } | null = null;
    const spy = (async (url: string, init: RequestInit) => { seen = { url, ua: String((init.headers as Record<string, string>)['User-Agent']) }; return new Response('{}'); }) as unknown as typeof fetch;
    await searchCommons('black cat', { fetchImpl: spy, userAgent: 'Mi-App/1.0 (a@b.c)' });
    expect(seen!.ua).toBe('Mi-App/1.0 (a@b.c)');
    const u = new URL(seen!.url);
    expect(u.searchParams.get('gsrsearch')).toBe('black cat filetype:bitmap');
    expect(u.searchParams.get('gsrnamespace')).toBe('6');
    await expect(searchCommons('x', { fetchImpl: fakeFetch([], 429), userAgent: 't' })).rejects.toMatchObject({ rateLimited: true });
  });

  it('licenseAllowed reconoce las variantes habituales', () => {
    for (const ok of ['CC0', 'CC0 1.0', 'Public domain', 'PD-old-100', 'PDM']) expect(licenseAllowed(ok, false)).toBe(true);
    expect(licenseAllowed('CC BY 4.0', false)).toBe(false);
    expect(licenseAllowed('CC BY 4.0', true)).toBe(true);
    expect(licenseAllowed('All rights reserved', true)).toBe(false);
  });
});

describe('packs de productos y manifiesto', () => {
  it('lee colección, tipo y productos (con búsqueda en inglés opcional)', () => {
    const p = parsePack('# Colección: Halloween\n# Tipo: escena\n# comentario\nCalabaza; Naranja; 🎃; pumpkin\nFantasma\n;sin nombre\n', 'x');
    expect(p).toMatchObject({ collection: 'Halloween', kind: 'scene' });
    expect(p.products).toEqual([
      { name: 'Calabaza', description: 'Naranja', emoji: '🎃', query: 'pumpkin' },
      { name: 'Fantasma', description: '', emoji: '', query: 'Fantasma' },
    ]);
  });

  it('el CSV del manifiesto va y vuelve con comas, comillas y saltos de línea', () => {
    const rows = [{ coleccion: 'Dulces, y más', archivo: 'Tarta "especial".jpg', titulo: 'Tarta "especial"', autor: 'Ana, B.', licencia: 'CC0', fuente: 'https://commons.wikimedia.org/wiki/File:X.jpg', tipo: 'item' as const }];
    expect(parseManifestCsv(manifestToCsv(rows))).toEqual(rows);
    expect(parseManifestCsv('otra,cosa\n1,2')).toEqual([]);
    expect(creditOf(rows[0]!)).toBe('Ana, B. · CC0 · https://commons.wikimedia.org/wiki/File:X.jpg');
  });
});
