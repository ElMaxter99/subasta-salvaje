import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeCtx, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
  vi.resetModules();
  vi.doMock('@/lib/services/context', () => ({ getContext: async () => ctx }));
});
afterAll(async () => {
  vi.doUnmock('@/lib/services/context');
  await ctx.db.close();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/telemetry/error', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', 'x-forwarded-for': headers['x-forwarded-for'] ?? '1.1.1.1', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const wait = () => new Promise((r) => setTimeout(r, 150));

describe('POST /api/telemetry/error', () => {
  it('guarda el error del navegador saneado y agrupado, sin IP', async () => {
    const { POST } = await import('@/app/api/telemetry/error/route');
    const body = { message: 'TypeError: x es undefined en /game/ABCD?token=zzz', stack: 'at f (a.js:1)', route: '/game/:code/play', kind: 'error' };
    expect((await POST(post(body))).status).toBe(204);
    expect((await POST(post(body))).status).toBe(204);
    await wait();
    const rows = await ctx.db.rpc<{ source: string; total: number; message: string; severity: string; route: string }[]>('ss_obs_error_list', {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'client', total: 2, severity: 'low' });
    expect(rows[0]!.message).not.toContain('zzz');
    expect(JSON.stringify(rows)).not.toContain('1.1.1.1');
  });
  it('rechaza otro origen, cuerpos enormes o inválidos y limita la tasa', async () => {
    const { POST } = await import('@/app/api/telemetry/error/route');
    expect((await POST(post({ message: 'x' }, { origin: 'http://evil.example' }))).status).toBe(403);
    expect((await POST(post({ message: 'x'.repeat(5000) }, { 'x-forwarded-for': '2.2.2.2' }))).status).toBe(413);
    expect((await POST(post('no es json', { 'x-forwarded-for': '3.3.3.3' }))).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await POST(post({ message: `e${i}` }, { 'x-forwarded-for': '4.4.4.4' }))).status;
    expect(last).toBe(429);
    await wait();
  });
});
