import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

const root = path.resolve(__dirname, '..');
const wfPath = path.join(root, '.github/workflows/ci.yml');

describe('workflow de CI', () => {
  it('existe y se dispara en push y pull_request con Node 20', () => {
    expect(existsSync(wfPath)).toBe(true);
    const wf = readFileSync(wfPath, 'utf8');
    expect(wf).toMatch(/^on:\s*\n\s+push:\s*\n\s+pull_request:/m);
    expect(wf).toContain("NODE_VERSION: '20'");
    expect(wf).toContain('cache: npm');
  });

  it('cada «npm run X» del workflow existe en package.json y se ejecutan los scripts prometidos', () => {
    const wf = readFileSync(wfPath, 'utf8');
    const used = [...wf.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!);
    for (const s of ['lint', 'typecheck', 'build', 'scan:secrets']) expect(used, s).toContain(s);
    for (const s of used) expect(Object.keys(pkg.scripts), s).toContain(s);
    expect(wf).toMatch(/run: npm test\b/);
    expect(Object.keys(pkg.scripts)).toContain('test');
    expect(wf).toContain('run: npm ci');
  });

  it('Postgres real (servicio postgres:16 + PG_TEST_URL) y e2e con Chromium y artefacto si falla', () => {
    const wf = readFileSync(wfPath, 'utf8');
    expect(wf).toContain('image: postgres:16');
    expect(wf).toContain('PG_TEST_URL: postgres://');
    expect(wf).toContain('tests/postgres-real.test.ts');
    expect(existsSync(path.join(root, 'tests/postgres-real.test.ts'))).toBe(true);
    expect(wf).toContain('npx playwright install --with-deps chromium');
    expect(wf).toContain('npx playwright test');
    expect(wf).toMatch(/if: failure\(\)[\s\S]*upload-artifact@v4[\s\S]*test-results\/[\s\S]*playwright-report\//);
  });

  it('no contiene secretos ni usa el contexto secrets', () => {
    const wf = readFileSync(wfPath, 'utf8');
    expect(wf).not.toMatch(/\$\{\{\s*secrets\./);
    expect(wf).not.toMatch(/(sk-|sb_secret_|github_pat_|cfut_)[A-Za-z0-9_-]{8,}/);
  });
});
