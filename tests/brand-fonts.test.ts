import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderOg } from '@/lib/seo/og-image';
import { BRAND_FONT_FILES, FONT_DIR, loadBrandFonts } from '@/lib/seo/fonts';

describe('tipografías de la marca para satori (podio y OG)', () => {
  it('están empaquetadas como TTF/OTF válidas (no woff2) y pesan poco', () => {
    let total = 0;
    for (const f of BRAND_FONT_FILES) {
      const p = path.join(FONT_DIR, f.file);
      const head = readFileSync(p).subarray(0, 4);
      expect([0x00010000, 0x4f54544f]).toContain(head.readUInt32BE(0)); // sfnt TrueType u 'OTTO'
      total += statSync(p).size;
    }
    expect(total).toBeLessThan(300 * 1024);
  });

  it('llevan junto la licencia OFL', () => {
    for (const n of ['OFL-Baloo2.txt', 'OFL-Nunito.txt']) expect(readFileSync(path.join(FONT_DIR, n), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('loadBrandFonts devuelve las cuatro cargas (400/700 Nunito, 700/800 Baloo 2) y las cachea', async () => {
    const a = await loadBrandFonts();
    expect(a?.map((f) => `${f.name}:${f.weight}`)).toEqual(['Baloo 2:700', 'Baloo 2:800', 'Nunito:400', 'Nunito:700']);
    expect(await loadBrandFonts()).toBe(a);
  });

  it('la imagen Open Graph se renderiza con las fuentes de la marca (PNG válido)', async () => {
    const res = await renderOg('generic', null);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get('content-type')).toContain('image/png');
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });
});
