import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { createDemoProvider } from '@/lib/ai/demo';
import { ProviderError, type ImageGenerationProvider } from '@/lib/ai/types';
import { createGame, getHostState } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, makeCtx, newHost, type TestCtx, REAL_PNG } from './helpers';

const PNG = REAL_PNG;
const CF = { accountId: 'acc', apiToken: 'tok', model: '@cf/black-forest-labs/flux-1-schnell', steps: 4, editModel: null, width: 1024, height: 768 };

let ctx: TestCtx;
const ENV = { IMAGE_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', IMAGE_QUOTA_PER_GAME: '100', IMAGE_QUOTA_PER_DAY: '1000' };
beforeAll(async () => { ctx = await makeCtx(); Object.assign(process.env, ENV); });
afterAll(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await ctx.db.close(); });

const usage = async (room: string) => (await ctx.db.pg.query<{ n: number }>('select count(*)::int as n from image_usage u join games g on g.id = u.game_id where g.room_code = $1', [room])).rows[0]!.n;
const failing = (err: Error): ImageGenerationProvider => ({ ...createDemoProvider(), id: 'cloudflare', capabilities: { edit: true }, generateInitialScene: async () => { throw err; } });

async function oneInitialJob(provider: ImageGenerationProvider) {
  const host = newHost();
  const { room_code } = await createGame(ctx, host, { name: 'Cuota', image_mode: 'ai', players: [{ name: 'Ana' }, { name: 'Beto' }] });
  const snap = await getHostState(ctx, room_code, host);
  await act(ctx, room_code, host, { type: 'image.request_initial', player_id: snap.players[0]!.id });
  await processImageJobs({ ...ctx, provider }, { gameId: snap.game.id });
  return room_code;
}

describe('devolución de la cuota local cuando el proveedor no gastó nada', () => {
  it('un fallo que NO consume (sin conexión, credenciales, cuota del proveedor…) devuelve la unidad reservada', async () => {
    expect(await usage(await oneInitialJob(failing(new ProviderError('sin red', true, false))))).toBe(0);
    expect(await usage(await oneInitialJob(failing(new ProviderError('401', false, false))))).toBe(0);
  });

  it('un fallo que sí pudo consumir (5xx, respuesta rota, moderación…) se cuenta: ante la duda se cuenta', async () => {
    expect(await usage(await oneInitialJob(failing(new ProviderError('500', true))))).toBe(1);
    expect(await usage(await oneInitialJob(failing(new Error('error inesperado después de la llamada'))))).toBe(1);
  });

  it('un trabajo correcto consume exactamente una unidad', async () => {
    const ok: ImageGenerationProvider = { ...createDemoProvider(), id: 'cloudflare', generateInitialScene: async () => ({ bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }) };
    expect(await usage(await oneInitialJob(ok))).toBe(1);
  });

  it('ss_release_image_quota es idempotente y solo borra UNA fila del trabajo', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Idem', image_mode: 'ai', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const snap = await getHostState(ctx, room_code, host);
    await act(ctx, room_code, host, { type: 'image.request_initial', player_id: snap.players[0]!.id });
    const job = (await getHostState(ctx, room_code, host)).jobs[0]!;
    await ctx.db.rpc('ss_reserve_image_quota', { job_id: job.id, provider: 'cloudflare', game_limit: 10, day_limit: 100 });
    await ctx.db.rpc('ss_reserve_image_quota', { job_id: job.id, provider: 'cloudflare', game_limit: 10, day_limit: 100 });
    expect(await usage(room_code)).toBe(2);
    expect(await ctx.db.rpc('ss_release_image_quota', { job_id: job.id })).toMatchObject({ released: true });
    expect(await usage(room_code)).toBe(1);
    await ctx.db.rpc('ss_release_image_quota', { job_id: job.id });
    expect(await ctx.db.rpc('ss_release_image_quota', { job_id: job.id })).toMatchObject({ released: false });
    expect(await usage(room_code)).toBe(0);
  });
});

describe('clasificación de errores de Cloudflare según si gastaron neuronas', () => {
  const run = async (fetchImpl: typeof fetch) => {
    const p = createCloudflareProvider({ ...CF, fetchImpl });
    return p.generateInitialScene({ theme: 'house', sceneDescription: 'x', playerName: 'A' }).then(() => null, (e: ProviderError) => e);
  };
  const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('sin conexión, 401/403, 429 y cuota diaria agotada NO consumen; 5xx y respuesta sin imagen sí cuentan', async () => {
    expect(await run((async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch)).toMatchObject({ consumed: false, retryable: true });
    expect(await run(json(401, { success: false, errors: [{ message: 'bad token' }] }))).toMatchObject({ consumed: false, retryable: false });
    expect(await run(json(403, { success: false, errors: [{ message: 'nope' }] }))).toMatchObject({ consumed: false });
    expect(await run(json(429, { success: false, errors: [{ message: 'slow down' }] }))).toMatchObject({ consumed: false, retryable: true });
    expect(await run(json(429, { success: false, errors: [{ message: 'you have used up your daily free allocation of 10,000 neurons' }] }))).toMatchObject({ consumed: false, retryable: false });
    expect(await run(json(500, { success: false, errors: [{ message: 'boom' }] }))).toMatchObject({ consumed: true, retryable: true });
    expect(await run(json(200, { success: true, result: {} }))).toMatchObject({ consumed: true });
  });
});
