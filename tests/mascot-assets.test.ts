import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MASCOT_ASSETS, MASCOT_FULL, MASCOT_HEAD, MASCOT_IDS } from '@/components/mascot/assets';

const PUBLIC = path.join(process.cwd(), 'public');
const ITEMS = path.join(PUBLIC, 'assets', 'mascot');
const BRAND = path.join(PUBLIC, 'assets', 'brand');
const file = (src: string) => path.join(PUBLIC, src);

describe('recursos de la mascota y la marca', () => {
  it('cada recurso declarado existe, con las dimensiones del inventario y con canal alfa', async () => {
    for (const id of MASCOT_IDS) {
      const a = MASCOT_ASSETS[id];
      expect(existsSync(file(a.src)), a.src).toBe(true);
      const meta = await sharp(file(a.src)).metadata();
      expect([meta.width, meta.height], id).toEqual([a.width, a.height]);
      expect(meta.hasAlpha, id).toBe(true);
    }
    for (const a of [MASCOT_FULL, MASCOT_HEAD]) {
      const meta = await sharp(file(a.src)).metadata();
      expect([meta.width, meta.height], a.src).toEqual([a.width, a.height]);
    }
  });

  it('los objetos no tienen archivos sin inventariar y se conserva su lámina', () => {
    const files = readdirSync(ITEMS).filter((f) => f.endsWith('.webp') && f !== 'reference-sheet.webp');
    expect(files.sort()).toEqual(MASCOT_IDS.filter((id) => id.startsWith('item-')).map((id) => `${id}.webp`).sort());
    expect(existsSync(path.join(ITEMS, 'reference-sheet.webp'))).toBe(true);
  });

  it('transparencia real: las esquinas de todos los recursos son transparentes', async () => {
    const srcs = new Set([...MASCOT_IDS.map((id) => MASCOT_ASSETS[id].src), MASCOT_FULL.src, MASCOT_HEAD.src, '/assets/brand/logo-full.webp', '/assets/brand/logo-compact.webp']);
    for (const src of srcs) {
      const { data, info } = await sharp(file(src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
      const corners = [alpha(0, 0), alpha(info.width - 1, 0), alpha(0, info.height - 1), alpha(info.width - 1, info.height - 1)];
      expect(Math.max(...corners), `${src} esquinas`).toBeLessThan(40);
    }
  });

  it('marca: se conserva el original y existen logo, iconos y favicon', () => {
    for (const f of ['original/logo-original.webp', 'logo-full.png', 'logo-full.webp', 'logo-compact.png', 'logo-compact.webp', 'mascot.png', 'mascot.webp', 'head.webp', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-64.png']) {
      expect(existsSync(path.join(BRAND, f)), f).toBe(true);
    }
  });

  it('presupuesto de peso: los WebP de marca y mascota caben en 600 KB', () => {
    const webp = [...readdirSync(BRAND).filter((f) => f.endsWith('.webp')).map((f) => path.join(BRAND, f)), ...readdirSync(ITEMS).filter((f) => f.endsWith('.webp') && f !== 'reference-sheet.webp').map((f) => path.join(ITEMS, f))];
    expect(webp.reduce((n, f) => n + statSync(f).size, 0)).toBeLessThan(600 * 1024);
  });
});
