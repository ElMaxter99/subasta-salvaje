import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '@/lib/security/redact';

const FAKE_CF = 'cfut_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
const FAKE_SB = 'sb_secret_' + 'abcDEF1234567890abcDEF12';

describe('redacción de secretos', () => {
  it('elimina tokens por formato y por valor exacto de las variables secretas', () => {
    const env = { CLOUDFLARE_API_TOKEN: 'valor-personalizado-12345', CRON_SECRET: 'abcdef0123456789' } as never;
    const msg = `fallo ${FAKE_CF} y ${FAKE_SB} con Authorization: Bearer abcdefghijklmnop1234 y valor-personalizado-12345 y abcdef0123456789`;
    const out = redactSecrets(msg, env);
    for (const leaked of [FAKE_CF, FAKE_SB, 'abcdefghijklmnop1234', 'valor-personalizado-12345', 'abcdef0123456789']) expect(out).not.toContain(leaked);
    expect(out).toContain('[redactado]');
    expect(redactSecrets('mensaje normal sin secretos', {} as never)).toBe('mensaje normal sin secretos');
  });

  it('un error de proveedor que incluya el token no lo deja en el mensaje guardado del trabajo', async () => {
    const { createCloudflareProvider } = await import('@/lib/ai/cloudflare');
    const p = createCloudflareProvider({
      accountId: 'acc', apiToken: FAKE_CF, model: 'm', steps: 4, editModel: null, width: 1024, height: 768,
      fetchImpl: (async () => new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: `token inválido ${FAKE_CF}` }] }), { status: 400 })) as unknown as typeof fetch,
    });
    const err = await p.generateInitialScene({ theme: 't', sceneDescription: 's', playerName: 'p' }).catch((e) => e);
    expect(String(err.message)).not.toContain(FAKE_CF);
  });
});

describe('los secretos no pueden llegar al navegador', () => {
  const tracked = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter((f) => /^src\/.*\.(ts|tsx)$/.test(f));
  const SERVER_ONLY = [
    '@/lib/config/env', '@/lib/db/supabase', '@/lib/db/pglite', '@/lib/services/context', '@/lib/services/jobs-service', '@/lib/services/game-service',
    '@/lib/services/play-service', '@/lib/ai/cloudflare', '@/lib/ai/openai', '@/lib/storage/supabase', '@/lib/storage/local', '@/lib/auth/host',
  ];

  it('ningún componente cliente ("use client") importa módulos que leen secretos o hablan con servicios externos', () => {
    const offenders: string[] = [];
    for (const f of tracked) {
      const text = readFileSync(path.join(process.cwd(), f), 'utf8');
      if (!/^['"]use client['"]/.test(text.trimStart())) continue;
      for (const mod of SERVER_ONLY) if (new RegExp(`from ['"]${mod.replace(/[/@]/g, '\\$&')}['"]`).test(text)) offenders.push(`${f} -> ${mod}`);
    }
    expect(offenders).toEqual([]);
  });

  it('las variables secretas nunca se publican con prefijo NEXT_PUBLIC_ ni se exponen en next.config', () => {
    const cfg = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/env\s*:/);
    const all = tracked.map((f) => readFileSync(path.join(process.cwd(), f), 'utf8')).join('\n');
    expect(all).not.toMatch(/NEXT_PUBLIC_(SUPABASE_SERVICE|CLOUDFLARE|OPENAI|CRON)/);
  });

  it('no hay secretos en los archivos versionados (patrones de Cloudflare, Supabase, OpenAI y JWT)', () => {
    const files = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter((f) => f && f !== 'package-lock.json' && !/\.(png|jpe?g|webp|ico)$/.test(f) && f !== 'tests/security.test.ts');
    const re = [/cf[ua]t_[A-Za-z0-9_-]{16,}/, /sb_secret_[A-Za-z0-9_-]{8,}/, /sk-[A-Za-z0-9_-]{20,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/];
    const hits: string[] = [];
    for (const f of files) {
      let t = '';
      try { t = readFileSync(path.join(process.cwd(), f), 'utf8'); } catch { continue; }
      for (const r of re) if (r.test(t)) hits.push(`${f}: ${r}`);
    }
    expect(hits).toEqual([]);
    expect(files.filter((f) => /^\.env(\.|$)/.test(f) && f !== '.env.example')).toEqual([]);
  });
});
