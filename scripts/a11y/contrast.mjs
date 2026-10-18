#!/usr/bin/env node
/**
 * Contraste WCAG 2.x de los tokens de color de src/app/globals.css (bloque @theme) y de los textos «text-white/NN» usados en src/.
 *   node scripts/a11y/contrast.mjs          # informe; sale con código 1 si algún texto normal no llega a 4.5:1
 * Texto normal: mínimo 4.5:1. Texto grande/negrita y componentes de interfaz: 3:1 (se informa aparte, no hace fallar).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const theme = css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme')));
const tokens = Object.fromEntries([...theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// night-600 solo se usa como borde/relleno de controles, no como fondo de texto. `violet` y `electric` son fondos/decoración (no se usan como color de texto).
const backgrounds = Object.entries(tokens).filter(([k]) => k.startsWith('night-') && k !== 'night-600').map(([k, v]) => [k, rgb(v)]);
const body = rgb('#e8ecff');
let failures = 0;
const out = [];

// 1) Texto de color de marca sobre los fondos nocturnos (texto normal: 4.5:1)
const textTokens = { body: body, white: [255, 255, 255], ...Object.fromEntries(['gold', 'gold-soft', 'violet-soft', 'teal', 'rose'].filter((k) => tokens[k]).map((k) => [k, rgb(tokens[k])])) };
for (const [name, fg] of Object.entries(textTokens)) {
  for (const [bgName, bg] of backgrounds) {
    const r = ratio(fg, bg);
    const level = r >= 4.5 ? 'OK ' : r >= 3 ? 'GRANDE' : 'FALLA';
    if (r < 4.5) { out.push(`${level.padEnd(6)} ${name} sobre ${bgName}: ${r.toFixed(2)}:1`); if (r < 3) failures++; else if (name === 'violet' || name === 'electric') { /* se usan como fondo/decoración: ver nota */ } }
  }
}

// 2) Fondos de marca con texto oscuro (botones): night-950 sobre gold/teal/rose/violet-soft
for (const bgName of ['gold', 'gold-soft', 'teal', 'rose', 'violet-soft']) {
  const r = ratio(rgb(tokens['night-950']), rgb(tokens[bgName]));
  if (r < 4.5) { out.push(`FALLA  night-950 sobre fondo ${bgName}: ${r.toFixed(2)}:1`); failures++; }
}

// 3) text-white/NN usados: blanco con transparencia sobre el peor fondo claro (night-700 en tarjetas)
const used = new Map();
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) for (const m of readFileSync(p, 'utf8').matchAll(/(?<![\w-])text-white\/(\d{1,3})\b/g)) used.set(+m[1], (used.get(+m[1]) ?? 0) + 1);
  }
})(path.join(root, 'src'));
const worst = backgrounds.find(([k]) => k === 'night-700')?.[1] ?? backgrounds[0][1];
const minAlpha = [...Array(100).keys()].map((i) => i + 1).find((a) => ratio(mix([255, 255, 255], worst, a / 100), worst) >= 4.5);
out.push(`text-white/NN: se necesita al menos /${minAlpha} sobre night-700 para 4.5:1 (sobre night-950: /${[...Array(100).keys()].map((i) => i + 1).find((a) => ratio(mix([255, 255, 255], backgrounds[0][1], a / 100), backgrounds[0][1]) >= 4.5)})`);
for (const [a, n] of [...used].sort((x, y) => x[0] - y[0])) {
  const r = ratio(mix([255, 255, 255], worst, a / 100), worst);
  if (r < 4.5) out.push(`${r < 3 ? 'FALLA ' : 'GRANDE'} text-white/${a} (${n} usos) sobre night-700: ${r.toFixed(2)}:1`);
}
console.log(out.join('\n') || 'Todo cumple 4.5:1.');
console.log(failures ? `\n${failures} combinaciones por debajo de 3:1` : '\nSin fallos por debajo de 3:1');
process.exit(failures ? 1 : 0);
