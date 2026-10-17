import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import inventory from '../public/assets/mascot-vector/inventory.json';
// @ts-expect-error módulo .mjs sin tipos (script de línea de comandos)
import { chromaKey } from '../scripts/mascot/chroma.mjs';

const DIR = path.join(process.cwd(), 'public/assets/mascot-vector');

describe('mascota vectorial: transparencia REAL', () => {
  it('hay poses y expresiones nuevas además de las originales', () => {
    const ids = inventory.assets.map((a) => a.id);
    for (const id of ['pose-waving', 'pose-thumbs-up', 'pose-pointing-up', 'pose-shrug', 'pose-holding-coin', 'pose-thinking', 'pose-sad-slump', 'expression-love', 'expression-cool', 'expression-laughing', 'expression-sleepy', 'expression-confused', 'expression-shy', 'expression-cry', 'pose-celebration', 'expression-happy']) expect(ids, id).toContain(id);
    expect(inventory.assets.length).toBeGreaterThanOrEqual(27);
  });

  it('cada WebP tiene canal alfa, esquinas transparentes, mucho fondo transparente y pesa poco', async () => {
    for (const a of inventory.assets) {
      const { data, info } = await sharp(path.join(DIR, a.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
      const corners = [alpha(0, 0), alpha(info.width - 1, 0), alpha(0, info.height - 1), alpha(info.width - 1, info.height - 1)];
      expect(corners, a.id).toEqual([0, 0, 0, 0]);
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
      expect(transparent / (info.width * info.height), a.id).toBeGreaterThan(0.4);
      expect(a.bytes, a.id).toBeLessThan(70_000);
      expect(a.transparency).toBe('real');
    }
  });
});

describe('quitar fondo de croma (scripts/mascot/chroma.mjs)', () => {
  it('deja el personaje y vuelve transparente el verde, recorta y mantiene el azul marino de la ropa', async () => {
    // personaje de prueba: círculo azul marino (como la sudadera) con un borde blanco, sobre verde liso
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#00ff00"/><circle cx="200" cy="150" r="90" fill="#0f1242" stroke="#ffffff" stroke-width="8"/><circle cx="170" cy="120" r="14" fill="#ffd83d"/></svg>`;
    const out = await chromaKey(Buffer.from(svg), { size: 256 });
    const { data, info } = await out.png().toBuffer({ resolveWithObject: true });
    const raw = await sharp(data).ensureAlpha().raw().toBuffer();
    const px = (x: number, y: number) => Array.from(raw.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    expect(px(0, 0)[3]).toBe(0); // esquina transparente
    const c = px(Math.floor(info.width / 2), Math.floor(info.height / 2));
    expect(c[3]).toBe(255); // el centro (ropa) sigue opaco
    expect(c[2]!).toBeGreaterThan(c[1]!); // y azulado, no verde
    expect(info.width).toBeLessThanOrEqual(256);
    expect(info.width).toBeLessThan(400); // recortado al contenido
    // ningún píxel opaco conserva el verde de la clave
    let greenish = 0;
    for (let i = 0; i < raw.length; i += 4) if (raw[i + 3]! > 200 && raw[i + 1]! > 200 && raw[i]! < 60 && raw[i + 2]! < 60) greenish++;
    expect(greenish).toBe(0);
  });
});
void readFileSync;
