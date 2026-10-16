// Genera las variantes SVG del mini héroe en public/assets/brand/mini-hero/ y el favicon.svg (misma fuente: src/lib/brand/mini-hero.ts).
// Uso: npm run brand:mini  (Node ≥ 22.18 ejecuta TypeScript simple sin dependencias)
import { mkdirSync, writeFileSync } from 'node:fs';
import { MINI_MOODS, miniHeroSvg } from '../../src/lib/brand/mini-hero.ts';

const OUT = 'public/assets/brand/mini-hero';
mkdirSync(OUT, { recursive: true });
for (const mood of MINI_MOODS) {
  writeFileSync(`${OUT}/${mood}.svg`, miniHeroSvg(mood) + '\n');
  writeFileSync(`${OUT}/${mood}-body.svg`, miniHeroSvg(mood, { body: true }) + '\n');
}
writeFileSync('public/assets/brand/favicon.svg', miniHeroSvg('happy', { tile: true }) + '\n');
console.log(`✔ ${MINI_MOODS.length * 2} variantes en ${OUT}/ y favicon.svg`);
