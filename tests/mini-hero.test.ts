import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINI_MOODS, miniHeroSvg } from '@/lib/brand/mini-hero';
import { MASCOT_IDS } from '@/components/mascot/assets';
import { moodFor } from '@/components/mascot/mini-hero';

const BRAND = path.join(process.cwd(), 'public', 'assets', 'brand');

describe('mini héroe vectorial', () => {
  it('cada gesto es un SVG mínimo, sin scripts, ids ni degradados, con viewBox 64 y corona dorada', () => {
    for (const mood of MINI_MOODS) {
      for (const body of [false, true]) {
        const s = miniHeroSvg(mood, { body });
        expect(s.startsWith('<svg'), mood).toBe(true);
        expect(s, mood).toContain('viewBox="0 0 64 64"');
        expect(s, mood).toContain('#fbbf24');
        expect(s, mood).not.toMatch(/<script|<image|<foreignObject|id="|<linearGradient|<radialGradient|<filter/);
        expect(s.length, `${mood} ${body}`).toBeLessThan(1600);
      }
    }
    expect(new Set(MINI_MOODS.map((m) => miniHeroSvg(m))).size).toBe(MINI_MOODS.length); // los gestos se distinguen
  });

  it('todos los ids heredados de la mascota tienen un gesto', () => {
    for (const id of MASCOT_IDS.filter((i) => !i.startsWith('item-'))) expect(MINI_MOODS, id).toContain(moodFor(id));
    expect(moodFor('expr-triste')).toBe('sad');
    expect(moodFor('expr-celebrando')).toBe('cheer');
  });

  it('los archivos de public/assets/brand coinciden con el generador (ejecuta `npm run brand:mini` si falla)', () => {
    expect(readFileSync(path.join(BRAND, 'favicon.svg'), 'utf8')).toBe(miniHeroSvg('happy', { tile: true }) + '\n');
    for (const mood of MINI_MOODS) {
      for (const [suffix, body] of [['', false], ['-body', true]] as const) {
        const f = path.join(BRAND, 'mini-hero', `${mood}${suffix}.svg`);
        expect(existsSync(f), f).toBe(true);
        expect(readFileSync(f, 'utf8')).toBe(miniHeroSvg(mood, { body }) + '\n');
      }
    }
  });
});
