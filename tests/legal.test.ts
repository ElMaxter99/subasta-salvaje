import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import credits from '../src/lib/legal/credits.generated.json';
import { APP_VERSION, getLegalHolder, LEGAL_LINKS, LICENSE_NAME, STORAGE_INVENTORY } from '../src/lib/legal/site';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}
const SRC = walk('src').map((f) => ({ file: f, text: read(f) }));

describe('páginas legales', () => {
  it('la versión mostrada en el footer es la de package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(read('src/components/landing/site-footer.tsx')).toContain('APP_VERSION');
  });

  it('el footer enlaza las 5 páginas legales y las rutas existen', () => {
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(['/legal', '/privacidad', '/cookies', '/creditos', '/licencia']);
    for (const l of LEGAL_LINKS) expect(() => read(`src/app${l.href}/page.tsx`)).not.toThrow();
  });

  it('credits.generated.json cubre todas las dependencias directas con versión y licencia', () => {
    const all = [
      ['dependencies', credits.dependencies],
      ['devDependencies', credits.devDependencies],
    ] as const;
    for (const [group, list] of all) {
      const declared = Object.keys(pkg[group]).sort();
      expect(list.map((d) => d.name).sort(), group).toEqual(declared);
      for (const d of list) {
        expect(d.version, d.name).toMatch(/^\d+\.\d+\.\d+/);
        expect(d.license.trim(), d.name).not.toBe('');
      }
    }
  });

  it('el inventario de cookies incluye lo que el código usa de verdad', () => {
    const src = [
      'src/lib/auth/host.ts', 'src/proxy.ts', 'src/lib/services/play-service.ts', 'src/lib/audio/engine.ts', 'src/components/host/import-notice.tsx',
    ].map(read).join('\n');
    const names = STORAGE_INVENTORY.map((s) => s.name).join(' ');
    // lo que el código usa -> debe estar en el inventario
    expect(src).toContain("DEMO_COOKIE = 'ss_demo_host'");
    expect(names).toContain('ss_demo_host');
    expect(src).toContain('`ss_p_${roomCode.toUpperCase()}`');
    expect(names).toContain('ss_p_');
    expect(src).toContain('`ss_audio_${role}`');
    for (const r of ['tv', 'host', 'play']) expect(names).toContain(`ss_audio_${r}`);
    expect(src).toContain("startsWith('sb-')");
    expect(names).toContain('sb-');
    expect(src).toContain("'ss_import_notice'");
    expect(names).toContain('ss_import_notice');
    // y cada entrada del inventario sigue existiendo en el código (nada obsoleto)
    for (const s of STORAGE_INVENTORY) expect(src, s.key).toContain(s.key.replace(/'/g, ''));
  });

  it('no hay otras claves de localStorage/sessionStorage ni cookies sin inventariar en src/', () => {
    const text = SRC.map((f) => f.text).join('\n');
    const keys = new Set([...text.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*['`"]([A-Za-z_]+)/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(0);
    for (const k of keys) expect(STORAGE_INVENTORY.some((s) => s.name.includes(k)), `clave sin inventariar: ${k}`).toBe(true);
    // Cada escritura de cookie debe ser una de las inventariadas (la sesión de Supabase se escribe vía setAll).
    const sets = [...text.matchAll(/\bres\.cookies\.set\(\s*([A-Za-z_.]+)/g)].map((m) => m[1]!);
    for (const n of sets) expect(['DEMO_COOKIE', 'playerCookieName'], `cookie sin inventariar: ${n}`).toContain(n);
  });

  it('sin variables legales no se inventa ningún dato del titular', () => {
    const h = getLegalHolder({});
    expect(h).toEqual({ name: undefined, email: undefined, address: undefined, nif: undefined, incomplete: true });
    expect(getLegalHolder({ NEXT_PUBLIC_LEGAL_NAME: '   ', NEXT_PUBLIC_LEGAL_EMAIL: '' }).incomplete).toBe(true);
    const ok = getLegalHolder({ NEXT_PUBLIC_LEGAL_NAME: 'Ana', NEXT_PUBLIC_LEGAL_EMAIL: 'a@b.es' });
    expect(ok).toMatchObject({ name: 'Ana', email: 'a@b.es', incomplete: false });
  });

  it('la licencia declarada es MIT y coincide en LICENSE, package.json y la constante de la página', () => {
    expect(LICENSE_NAME).toBe('MIT');
    expect((pkg as Record<string, unknown>).license).toBe('MIT');
    const text = readFileSync(path.join(process.cwd(), 'LICENSE'), 'utf8');
    expect(text.startsWith('MIT License')).toBe(true);
    expect(text).toMatch(/Copyright \(c\) 2026 ElMaxter99/);
    expect(text).toMatch(/generaron con herramientas de IA/); // origen de logo y mascota
    expect(text).toContain('https://github.com/ElMaxter99/subasta-salvaje');
    expect((pkg as Record<string, unknown>).author).toMatch(/ElMaxter99/);
    expect(JSON.stringify((pkg as Record<string, unknown>).repository)).toContain('github.com/ElMaxter99/subasta-salvaje');
  });

  it('todas las dependencias directas tienen licencia permisiva compatible con MIT', () => {
    const credits = JSON.parse(readFileSync(path.join(process.cwd(), 'src/lib/legal/credits.generated.json'), 'utf8')) as Record<string, { license: string; name: string }[]>;
    for (const list of Object.values(credits)) for (const c of Array.isArray(list) ? list : []) expect(c.license, c.name).toMatch(/^(MIT|ISC|Apache-2\.0|BSD-[23]-Clause|0BSD|BlueOak-1\.0\.0|MPL-2\.0|\(.*\))$/);
  });

  it('el footer no se monta en rutas /game ni en componentes de TV, anfitrión o jugador', () => {
    const users = SRC.filter((f) => f.text.includes('SiteFooter')).map((f) => f.file);
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(u).not.toMatch(/app\/game|components\/(screen|host|play)\//);
  });
});
