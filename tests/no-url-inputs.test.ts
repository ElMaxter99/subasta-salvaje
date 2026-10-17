import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Regla de producto: en la interfaz NUNCA se escribe una URL (https://…) para cargar algo: se sube un archivo o se elige de la biblioteca. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(p) ? [p] : [];
  });
}

describe('sin campos para escribir URLs', () => {
  it('ningún componente ofrece un campo de URL ni pide «https://» al usuario', () => {
    const offenders: string[] = [];
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      if (/inputMode="url"|type="url"|placeholder="https?:|URL https|pega (un |el )?enlace/i.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
