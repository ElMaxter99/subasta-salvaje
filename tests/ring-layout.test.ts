import { describe, expect, it } from 'vitest';
import { ringSplit, spotlightGrid } from '@/components/screen/ring-layout';

describe('TV: jugadores alrededor de la subasta', () => {
  it('reparte de 1 a 10 jugadores sin perder a nadie y con los lados equilibrados', () => {
    for (let n = 0; n <= 12; n++) {
      const r = ringSplit(n);
      expect(r.left + r.right + r.bottom).toBe(n);
      if (n >= 2) expect(r.left).toBe(r.right);
      expect(r.left).toBeLessThanOrEqual(3);
    }
    expect(ringSplit(2)).toMatchObject({ left: 1, right: 1, bottom: 0 });
    expect(ringSplit(4)).toMatchObject({ left: 2, right: 2, bottom: 0 });
    expect(ringSplit(8)).toMatchObject({ left: 3, right: 3, bottom: 2 });
    expect(ringSplit(10)).toMatchObject({ left: 3, right: 3, bottom: 4 });
  });

  it('entre subastas elige columnas que dan tarjetas grandes (una fila hasta 4, dos filas con más)', () => {
    expect(spotlightGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(spotlightGrid(4)).toEqual({ cols: 4, rows: 1 });
    expect(spotlightGrid(10)).toEqual({ cols: 5, rows: 2 });
    for (let n = 1; n <= 12; n++) {
      const { cols, rows } = spotlightGrid(n);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
    }
  });
});
