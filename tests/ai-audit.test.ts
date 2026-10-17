import { describe, expect, it, vi } from 'vitest';
import { auditCloudflare, auditPollinations, suggestDailyCalls } from '@/lib/ai/audit';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const KEY = ['sk', 'abcdefghijklmnopqrstuvwx'].join('_');
const polCfg = { apiKey: KEY, model: 'm', editModel: null, size: '1024x768' };
const cfCfg = { accountId: 'acc123', apiToken: ['cfut', 'x'.repeat(24)].join('_'), model: 'm', steps: 4, editModel: null, width: 1024, height: 768 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('auditoría de Pollinations', () => {
  const route = (over: Record<string, () => Response> = {}) =>
    vi.fn(async (url: string) => {
      const u = new URL(url);
      if (over[u.pathname]) return over[u.pathname]!();
      if (u.pathname === '/account/key') return json({ valid: true, type: 'secret', name: 'subasta', expiresAt: null, pollenBudget: 1, permissions: { models: null, account: ['usage'] } });
      if (u.pathname === '/account/balance') return json({ balance: 0.5, accountBalance: { total: 3, tier: 3, paid: 0 } });
      return json({
        count: 3,
        usage: [
          { timestamp: '2026-10-17T10:00:00Z', model: 'flux', cost_usd: 0.002 },
          { timestamp: '2026-10-15T10:00:00Z', model: 'flux', cost_usd: 0.002 },
          { timestamp: '2026-09-25T10:00:00Z', model: 'kontext', cost_usd: 0.004 },
        ],
      });
    });

  it('agrega clave, saldo y uso por ventana, modelo y día', async () => {
    const f = route();
    const a = await auditPollinations(polCfg, { fetchImpl: f as never, now: () => NOW });
    expect(a.errors).toEqual([]);
    expect(a.key).toMatchObject({ valid: true, type: 'secret', pollenBudget: 1 });
    expect(a.balance).toMatchObject({ remaining: 0.5, total: 3 });
    expect(a.usage).toMatchObject({ requests24h: 1, requests7d: 2, requests30d: 3, truncated: false });
    expect(a.usage!.costUsd30d).toBeCloseTo(0.008, 6);
    expect(a.usage!.byModel[0]).toMatchObject({ model: 'flux', requests: 2 });
    expect(a.usage!.byDay.map((d) => d.date)).toEqual(['2026-09-25', '2026-10-15', '2026-10-17']);
    expect(a.estimatedImagesLeft).toBe(Math.floor(0.5 / (0.008 / 3)));
    // todas las llamadas llevan la clave como Bearer y ninguna otra cosa
    for (const [, init] of f.mock.calls as unknown as [string, RequestInit][]) expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('un fallo parcial no rompe el resto y no filtra la clave', async () => {
    const a = await auditPollinations(polCfg, { fetchImpl: route({ '/account/balance': () => new Response(`no ${KEY}`, { status: 403 }) }) as never, now: () => NOW });
    expect(a.key?.valid).toBe(true);
    expect(a.usage).toBeDefined();
    expect(a.balance).toBeUndefined();
    expect(a.errors).toHaveLength(1);
    expect(a.errors[0]).toContain('403');
    expect(a.errors.join(' ')).not.toContain(KEY);
  });

  it('sin conexión devuelve los tres errores', async () => {
    const a = await auditPollinations(polCfg, { fetchImpl: (async () => { throw new Error('boom'); }) as never, now: () => NOW });
    expect(a.errors).toHaveLength(3);
  });
});

describe('auditoría de Cloudflare', () => {
  const groups = [
    { count: 2, sum: { totalNeurons: 170 }, dimensions: { modelId: '@cf/black-forest-labs/flux-2-klein-4b', datetimeHour: '2026-10-17T09:00:00Z' } },
    { count: 3, sum: { totalNeurons: 30 }, dimensions: { modelId: '@cf/black-forest-labs/flux-1-schnell', datetimeHour: '2026-10-17T11:00:00Z' } },
    { count: 10, sum: { totalNeurons: 9000 }, dimensions: { modelId: '@cf/black-forest-labs/flux-1-schnell', datetimeHour: '2026-10-16T11:00:00Z' } },
  ];
  it('suma neuronas de hoy y de 7 días, por modelo y por día', async () => {
    const f = vi.fn(async () => json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: groups }] } } }));
    const a = await auditCloudflare(cfCfg, { fetchImpl: f as never, now: () => NOW });
    expect(a.errors).toEqual([]);
    expect(a.today).toEqual({ neurons: 200, calls: 5 });
    expect(a.last7d).toEqual({ neurons: 9200, calls: 15 });
    expect(a.remainingToday).toBe(9800);
    expect(a.neuronsPerCall).toBe(40);
    expect(a.byDay!.map((d) => d.date)).toEqual(['2026-10-16', '2026-10-17']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(JSON.parse(init.body as string).variables.accountTag).toBe('acc123');
  });
  it('errores GraphQL y HTTP se explican (y recuerdan el permiso)', async () => {
    const g = await auditCloudflare(cfCfg, { fetchImpl: (async () => json({ errors: [{ message: 'unknown field aiInferenceAdaptiveGroups' }] })) as never, now: () => NOW });
    expect(g.errors[0]).toContain('unknown field');
    const h = await auditCloudflare(cfCfg, { fetchImpl: (async () => new Response('forbidden', { status: 403 })) as never, now: () => NOW });
    expect(h.errors[0]).toContain('Account Analytics: Read');
    expect(h.today).toBeUndefined();
  });
  it('recomendación de llamadas por día', () => {
    expect(suggestDailyCalls(40)).toBe(225);
    expect(suggestDailyCalls(null)).toBeNull();
    expect(suggestDailyCalls(20_000)).toBe(1);
  });
});
