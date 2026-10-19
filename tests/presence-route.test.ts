import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame, getHostState, getPublicState, performAction } from '@/lib/services/game-service';
import { joinGame, playerCookieName } from '@/lib/services/play-service';
import { ensureInitialImages, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (cookieJar[n] ? { value: cookieJar[n] } : undefined) }) }));
vi.mock('@/lib/services/context', () => ({ getContext: async () => ctx }));
vi.mock('@/lib/observability/record', () => ({ observeRequest: () => undefined }));

const { POST } = await import('@/app/api/play/[code]/ping/route');

beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function setup() {
  const host = newHost();
  const { room_code: room } = await createGame(ctx, host, { name: 'Ruta', play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }] });
  await ensureInitialImages(ctx, room, host);
  const s0 = await getHostState(ctx, room, host);
  const ana = playerByName(s0, 'Ana').id;
  const token = (await joinGame(ctx, room, { player_id: ana })).token;
  await performAction(ctx, room, host, { type: 'game.start' });
  return { room, ana, token };
}
const call = (room: string, body: unknown, headers: Record<string, string> = {}, ip = '10.0.0.1') =>
  POST(new Request(`http://localhost/api/play/${room}/ping`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'x-forwarded-for': ip, ...headers } }), { params: Promise.resolve({ code: room }) });

describe('POST /api/play/[code]/ping', () => {
  it('con la cookie del jugador responde 200 y no devuelve snapshot ni marcas de tiempo', async () => {
    const s = await setup();
    cookieJar = { [playerCookieName(s.room)]: s.token };
    const res = await call(s.room, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, retired: false });
  });

  it('sin cookie: 403/401 not_player sin tocar la BD; origen distinto: rechazado; cuerpo enorme: 413', async () => {
    const s = await setup();
    cookieJar = {};
    const res = await call(s.room, {});
    expect((await res.json()).error.code).toBe('not_player');
    cookieJar = { [playerCookieName(s.room)]: s.token };
    expect((await call(s.room, {}, { origin: 'http://evil.example', host: 'localhost' })).status).toBe(403);
    expect((await call(s.room, 'x'.repeat(5000))).status).toBe(413);
  });

  it('la identidad sale solo de la cookie: un token de otro jugador/sala no sirve y `bye` marca desconectado', async () => {
    const s = await setup();
    cookieJar = { [playerCookieName(s.room)]: 'a'.repeat(43) };
    expect((await (await call(s.room, {})).json()).error.code).toBe('not_player');
    cookieJar = { [playerCookieName(s.room)]: s.token };
    expect((await call(s.room, { bye: true })).status).toBe(200);
    expect((await getPublicState(ctx, s.room)).players.find((p) => p.id === s.ana)!.online).toBe(false);
  });

  it('límite por jugador: más de 30 latidos/min dan 429 (≈ 4/min es lo normal)', async () => {
    const s = await setup();
    cookieJar = { [playerCookieName(s.room)]: s.token };
    let last = 200;
    for (let i = 0; i < 35; i++) last = (await call(s.room, {}, {}, `10.1.${i}.1`)).status;
    expect(last).toBe(429);
  });
});
