import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('imagen interna: ninguna escritura en Storage se salta la normalización', () => {
  const root = path.join(process.cwd(), 'src');
  const writers = walk(root).filter((f) => !f.includes(`${path.sep}lib${path.sep}storage${path.sep}`) && /\.storage\.put\(|\bstorage\.put\(/.test(readFileSync(f, 'utf8')));

  it('los únicos módulos que escriben imágenes son los conocidos, y todos usan normalizeImage', () => {
    // Si añades otro punto de escritura, tiene que pasar por normalizeImage (y añadirse aquí a propósito).
    expect(writers.map((f) => path.relative(root, f)).sort()).toEqual(['lib/services/game-service.ts', 'lib/services/jobs-service.ts']);
    for (const f of writers) expect(readFileSync(f, 'utf8'), f).toContain("@/lib/images/normalize");
  });

  it('las tres subidas de usuario llaman a toInternalImage antes de guardar', () => {
    const src = readFileSync(path.join(root, 'lib/services/game-service.ts'), 'utf8');
    expect((src.match(/await toInternalImage\(/g) ?? []).length).toBe(3);
  });
});
