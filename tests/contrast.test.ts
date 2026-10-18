import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contraste WCAG 2.x de los colores reales de `globals.css` (tokens `--color-*`) en las combinaciones que usa la vista del jugador.
 * Texto normal ≥ 4.5:1, texto grande (≥ 24 px, o ≥ 18,66 px en negrita) e iconos/bordes de UI ≥ 3:1. Ver docs/ACCESIBILIDAD-MOVIL.md.
 */
const css = readFileSync('src/app/globals.css', 'utf8');
const token = (name: string): [number, number, number] => {
  const m = new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, 'i').exec(css);
  if (!m) throw new Error(`token ${name} no encontrado`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const WHITE: [number, number, number] = [255, 255, 255];
type RGB = [number, number, number];
/** Mezcla `fg` con opacidad `a` sobre `bg`. */
const over = (fg: RGB, a: number, bg: RGB): RGB => [0, 1, 2].map((i) => Math.round(fg[i]! * a + bg[i]! * (1 - a))) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

const night = ['950', '900', '800', '700'].map((n) => [n, token(`night-${n}`)] as const);

describe('contraste de los tokens (vista del jugador)', () => {
  it('texto blanco translúcido sobre night-*: /60 y /70 ≥ 4.5 en 950–800; /55 solo placeholders sobre 950', () => {
    for (const [n, bg] of night.slice(0, 3)) {
      for (const a of [0.6, 0.7, 0.8]) expect(ratio(over(WHITE, a, bg), bg), `white/${a * 100} sobre night-${n}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(over(WHITE, 0.55, token('night-950')), token('night-950'))).toBeGreaterThanOrEqual(4.5);
    // night-700 (botones, avisos): /80 sí, /60 no → por eso el texto secundario sobre 700 usa /80 o más
    expect(ratio(over(WHITE, 0.8, token('night-700')), token('night-700'))).toBeGreaterThanOrEqual(4.5);
  });
  it('texto de acento sobre night-*', () => {
    for (const [n, bg] of night) for (const c of ['gold', 'gold-soft', 'teal', 'rose', 'violet-soft']) {
      expect(ratio(token(c), bg), `${c} sobre night-${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('night-950 sobre fondos de acento (botones y avisos)', () => {
    for (const c of ['gold', 'gold-soft', 'teal', 'rose']) expect(ratio(token('night-950'), token(c)), `night-950 sobre ${c}`).toBeGreaterThanOrEqual(4.5);
  });
  it('violet-soft sobre los avisos violet/25 y violet/20 encima de night-900/800', () => {
    for (const [, bg] of night.slice(1, 3)) for (const a of [0.2, 0.25]) {
      const b = over(token('violet'), a, bg);
      expect(ratio(token('violet-soft'), b)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('borde de los campos de texto (white/45 sobre night-950) y foco dorado: UI ≥ 3:1 con el fondo (WCAG 1.4.11)', () => {
    expect(ratio(over(WHITE, 0.45, token('night-950')), token('night-950'))).toBeGreaterThanOrEqual(3);
    // el borde anterior (white/20) daba solo 1,75:1
    expect(ratio(over(WHITE, 0.2, token('night-950')), token('night-950'))).toBeLessThan(3);
    expect(ratio(token('gold'), token('night-950'))).toBeGreaterThanOrEqual(3);
    expect(ratio(token('gold'), token('night-700'))).toBeGreaterThanOrEqual(3);
  });
});
