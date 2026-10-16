import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeNext } from '@/app/auth/callback/route';

const DIR = path.join(process.cwd(), 'supabase', 'templates');
const read = (n: string) => readFileSync(path.join(DIR, `${n}.html`), 'utf8');

describe('plantillas de correo de Supabase Auth', () => {
  const names = ['confirmation', 'invite', 'magic_link', 'recovery', 'email_change', 'reauthentication'];

  it('existen las 6 plantillas, con asunto, y son HTML autocontenido (sin scripts ni hojas externas)', () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()).toEqual(names.map((n) => `${n}.html`).sort());
    const subjects = JSON.parse(readFileSync(path.join(DIR, 'subjects.json'), 'utf8'));
    for (const n of names) {
      const h = read(n);
      expect(subjects[n], n).toBeTruthy();
      expect(h.startsWith('<!doctype html>'), n).toBe(true);
      expect(h, n).not.toMatch(/<script|<link |@import/i);
      expect(h, n).toContain('Subasta Salvaje');
      expect(h, n).toContain('{{ .SiteURL }}/assets/brand/email-logo.png');
    }
  });

  it('los enlaces usan token_hash con el tipo correcto y el destino interno; el código de reautenticación usa {{ .Token }}', () => {
    expect(read('recovery')).toContain('/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password');
    expect(read('confirmation')).toContain('type=signup');
    expect(read('invite')).toContain('type=invite');
    expect(read('magic_link')).toContain('type=magiclink');
    expect(read('email_change')).toContain('{{ .NewEmail }}');
    expect(read('reauthentication')).toContain('{{ .Token }}');
  });

  it('las imágenes de los correos existen y son ligeras', () => {
    for (const f of ['email-logo.png', 'email-head.png']) {
      const p = path.join(process.cwd(), 'public', 'assets', 'brand', f);
      expect(existsSync(p), f).toBe(true);
      expect(readFileSync(p).length, f).toBeLessThan(60 * 1024);
    }
  });
});

describe('destino del enlace del correo', () => {
  it('safeNext solo admite rutas internas (sin redirección abierta)', () => {
    expect(safeNext('/reset-password')).toBe('/reset-password');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('/\\evil')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
