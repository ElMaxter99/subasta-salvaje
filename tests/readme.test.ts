import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vigila que el README no se quede desactualizado: enlaces, imágenes, scripts npm y peso de las capturas. */
const ROOT = path.resolve(__dirname, '..');
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

/** Texto del README sin bloques de código (``` … ```), donde los «enlaces» son ejemplos. */
const prose = readme.replace(/```[\s\S]*?```/g, '');

function localTargets(): string[] {
  const found: string[] = [];
  for (const m of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) found.push(m[1]!);
  for (const m of prose.matchAll(/\b(?:src|href)="([^"]+)"/g)) found.push(m[1]!);
  return found.filter((t) => !/^(https?:|mailto:|data:)/i.test(t));
}

/** Anclas que GitHub genera para los títulos, más los `id="…"` explícitos. */
function anchors(): Set<string> {
  const set = new Set<string>();
  for (const m of prose.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const text = m[1]!.replace(/<[^>]+>/g, '').replace(/[`*_]/g, '').trim().toLowerCase();
    set.add(text.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-'));
  }
  for (const m of prose.matchAll(/\bid="([^"]+)"/g)) set.add(m[1]!);
  return set;
}

describe('README.md', () => {
  it('todos los enlaces e imágenes locales existen', () => {
    const missing: string[] = [];
    const known = anchors();
    for (const target of localTargets()) {
      const [file, frag] = target.split('#');
      if (file) {
        if (!existsSync(path.join(ROOT, decodeURI(file)))) missing.push(target);
      } else if (frag && !known.has(decodeURI(frag).toLowerCase())) {
        missing.push(`${target} (ancla inexistente)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('cada script npm que menciona existe en package.json', () => {
    const mentioned = new Set<string>();
    for (const m of readme.matchAll(/\bnpm run ([A-Za-z0-9:_.-]+)/g)) mentioned.add(m[1]!);
    for (const m of readme.matchAll(/\bnpm (test|start|stop|restart)\b/g)) mentioned.add(m[1]!);
    const unknown = [...mentioned].filter((s) => !(s in pkg.scripts));
    expect(unknown).toEqual([]);
    expect(mentioned.size).toBeGreaterThan(5);
  });

  it('el script de capturas existe y está documentado', () => {
    expect(existsSync(path.join(ROOT, 'scripts/docs/screenshots.mjs'))).toBe(true);
    expect(readme).toContain('node scripts/docs/screenshots.mjs');
  });

  it('declara la licencia real (MIT, la de LICENSE y package.json) y que la marca queda fuera', () => {
    const lic = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).license;
    expect(lic).toBe('MIT');
    expect(readme).toMatch(/licencia \*\*MIT\*\*/i);
    expect(readme).toMatch(/ElMaxter99/);
    expect(readme).toContain('https://github.com/ElMaxter99/subasta-salvaje');
    expect(readme).toMatch(/no hay ninguna marca registrada/i);
    expect(readme).not.toMatch(/Sin licencia declarada/i);
  });
});

describe('docs/img (capturas)', () => {
  const dir = path.join(ROOT, 'docs/img');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(webp|png|jpe?g|svg)$/i.test(f)) : [];

  it('hay capturas', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('cada imagen pesa menos de 400 KB', () => {
    const heavy = files.filter((f) => statSync(path.join(dir, f)).size >= 400 * 1024);
    expect(heavy).toEqual([]);
  });

  it('todas están usadas en el README', () => {
    const unused = files.filter((f) => !readme.includes(`docs/img/${f}`));
    expect(unused).toEqual([]);
  });
});
