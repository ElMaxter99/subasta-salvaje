import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MASCOT_ASSETS, MASCOT_IDS } from '@/components/mascot/assets';

const DIR = path.join(process.cwd(), 'public', 'assets', 'mascot');

describe('recursos de la mascota', () => {
  it('cada recurso declarado existe, con las dimensiones del inventario y con canal alfa', async () => {
    for (const id of MASCOT_IDS) {
      const a = MASCOT_ASSETS[id];
      expect(a, id).toBeDefined();
      const file = path.join(DIR, path.basename(a.src));
      expect(existsSync(file), file).toBe(true);
      const meta = await sharp(file).metadata();
      expect([meta.width, meta.height], id).toEqual([a.width, a.height]);
      expect(meta.hasAlpha, id).toBe(true);
    }
  });

  it('no hay archivos sin inventariar y se conserva la lámina original', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.webp') && f !== 'reference-sheet.webp');
    expect(files.sort()).toEqual(MASCOT_IDS.map((id) => `${id}.webp`).sort());
    expect(existsSync(path.join(DIR, 'reference-sheet.webp'))).toBe(true);
  });

  it('transparencia honesta: «real» tiene esquinas transparentes; «difuminado» tiene los bordes transparentes pero fondo opaco dentro', async () => {
    for (const id of MASCOT_IDS) {
      const a = MASCOT_ASSETS[id];
      const { data, info } = await sharp(path.join(DIR, path.basename(a.src))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
      const corners = [alpha(0, 0), alpha(info.width - 1, 0), alpha(0, info.height - 1), alpha(info.width - 1, info.height - 1)];
      expect(Math.max(...corners), `${id} esquinas`).toBeLessThan(40);
      if (a.transparency === 'difuminado') expect(alpha(Math.floor(info.width / 2), Math.floor(info.height / 2)), `${id} centro opaco`).toBe(255);
    }
  });

  it('presupuesto de peso: todo el conjunto cabe en 400 KB (WebP optimizado)', () => {
    const total = readdirSync(DIR)
      .filter((f) => f.endsWith('.webp') && f !== 'reference-sheet.webp')
      .reduce((n, f) => n + statSync(path.join(DIR, f)).size, 0);
    expect(total).toBeLessThan(400 * 1024);
  });

  it('marca: se conserva el original y existen logo, mascota nueva e iconos', () => {
    const brand = path.join(process.cwd(), 'public', 'assets', 'brand');
    for (const f of ['original/logo-original.webp', 'logo-full.webp', 'logo-compact.webp', 'mascot.webp', 'head.webp', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-64.png', 'og-image.png']) {
      expect(existsSync(path.join(brand, f)), f).toBe(true);
    }
  });
});
