import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { createDemoProvider } from '@/lib/ai/demo';
import { sniffImageMime } from '@/lib/ai/image-validation';
import { ProviderError, type ImageGenerationProvider } from '@/lib/ai/types';
import { cloudflareConfig, getImageProviderId, quotaConfig } from '@/lib/config/env';
import { createGame, getHostState } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const CF = { accountId: 'acc123', apiToken: 'tok-secret', model: '@cf/black-forest-labs/flux-1-schnell', steps: 4, editModel: null, width: 1024, height: 768 };

describe('selección de proveedor de IA: desactivado por defecto, nunca cambia solo a uno de pago', () => {
  const real = { OPENAI_API_KEY: 'k', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
  it('sin IMAGE_PROVIDER no hay IA aunque haya credenciales reales (no se consume cuota por accidente)', () => {
    expect(getImageProviderId({ ...real } as never)).toBeNull();
    expect(getImageProviderId({} as never)).toBeNull();
    expect(getImageProviderId({ IMAGE_PROVIDER: 'demo' } as never)).toBeNull();
  });
  it('un proveedor real sólo se activa si se pide y tiene credenciales; si faltan, "no configurado" (sin fallback)', () => {
    expect(getImageProviderId({ ...real, IMAGE_PROVIDER: 'cloudflare' } as never)).toBe('cloudflare');
    expect(getImageProviderId({ IMAGE_PROVIDER: 'cloudflare' } as never)).toBeNull();
    expect(getImageProviderId({ OPENAI_API_KEY: 'k', IMAGE_PROVIDER: 'cloudflare' } as never)).toBeNull();
    expect(getImageProviderId({ ...real, IMAGE_PROVIDER: 'openai' } as never)).toBe('openai');
  });
  it('configuración de Cloudflare y cuotas con valores por defecto y validación', () => {
    expect(cloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: 'a' } as never)).toBeNull();
    expect(cloudflareConfig({ ...real, CLOUDFLARE_IMAGE_STEPS: '99' } as never)).toMatchObject({ model: '@cf/black-forest-labs/flux-1-schnell', steps: 4, editModel: null });
    expect(quotaConfig({} as never)).toEqual({ perGame: 10, perDay: 50 });
    expect(quotaConfig({ IMAGE_QUOTA_PER_GAME: '5', IMAGE_QUOTA_PER_DAY: 'x' } as never)).toEqual({ perGame: 5, perDay: 50 });
  });
});

describe('proveedor Cloudflare (HTTP simulado)', () => {
  it('genera con flux-1-schnell: JSON {prompt, steps}, token Bearer y respuesta {result:{image}}', async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response(JSON.stringify({ result: { image: jpeg }, success: true, errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const p = createCloudflareProvider({ ...CF, fetchImpl });
    expect(p.capabilities.edit).toBe(false);
    const img = await p.generateInitialScene({ theme: 'house', sceneDescription: 'an empty house', playerName: 'Ana' });
    expect(sniffImageMime(img.bytes)).toBe('image/jpeg');
    expect(seen[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-1-schnell');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer tok-secret');
    const body = JSON.parse(seen[0]!.body);
    expect(body.steps).toBe(4);
    expect(body.prompt.length).toBeLessThanOrEqual(2048);
  });

  it('flux-1-schnell NO edita: error claro no reintentable y sin llamar a la red', async () => {
    let calls = 0;
    const p = createCloudflareProvider({ ...CF, fetchImpl: (async () => { calls++; return new Response('{}'); }) as unknown as typeof fetch });
    await expect(p.editScene({ base: { bytes: new Uint8Array([1]), mime: 'image/png' }, theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null, previousItems: [] })).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('no puede editar') });
    expect(calls).toBe(0);
  });

  it('con CLOUDFLARE_EDIT_MODEL edita con multipart (prompt, width, height, input_image_0) usando una referencia reducida', async () => {
    let form: FormData | null = null;
    let url = '';
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = u;
      form = init.body as FormData;
      return new Response(JSON.stringify({ result: { image: jpeg }, success: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createCloudflareProvider({ ...CF, editModel: '@cf/black-forest-labs/flux-2-klein-4b', fetchImpl, resizeForReference: async () => new Uint8Array([9, 9]) });
    expect(p.capabilities.edit).toBe(true);
    await p.editScene({ base: { bytes: new Uint8Array([1]), mime: 'image/png' }, theme: 'house', itemName: 'Piscina', itemDescription: 'azul', itemEmoji: null, previousItems: ['Sofá'] });
    expect(url).toContain('/ai/run/@cf/black-forest-labs/flux-2-klein-4b');
    expect(form!.get('input_image_0')).toBeInstanceOf(Blob);
    expect(form!.get('width')).toBe('1024');
    expect(String(form!.get('prompt'))).toContain('Piscina');
  });

  it('el redimensionado real (sharp) deja la referencia por debajo de 512×512, también desde SVG', async () => {
    const { default: sharp } = await import('sharp');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="red"/></svg>');
    let refBytes: Uint8Array | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      refBytes = new Uint8Array(await ((init.body as FormData).get('input_image_0') as Blob).arrayBuffer());
      return new Response(JSON.stringify({ result: { image: jpeg }, success: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createCloudflareProvider({ ...CF, editModel: '@cf/black-forest-labs/flux-2-klein-4b', fetchImpl });
    await p.editScene({ base: { bytes: new Uint8Array(svg), mime: 'image/svg+xml' }, theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null, previousItems: [] });
    const meta = await sharp(Buffer.from(refBytes!)).metadata();
    expect(meta.width!).toBeLessThan(512);
    expect(meta.height!).toBeLessThan(512);
  });

  it('clasifica errores: cuota gratuita agotada y 401/403 definitivos (sin plan de pago automático); 429/5xx reintentables', async () => {
    const mk = (status: number, message: string) =>
      createCloudflareProvider({ ...CF, fetchImpl: (async () => new Response(JSON.stringify({ success: false, errors: [{ code: 1, message }] }), { status })) as unknown as typeof fetch });
    const input = { theme: 't', sceneDescription: 's', playerName: 'p' };
    await expect(mk(429, 'you have used up your daily free allocation of 10,000 neurons').generateInitialScene(input)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('cuota diaria gratuita agotada') });
    await expect(mk(403, 'model requires paid plan').generateInitialScene(input)).rejects.toMatchObject({ retryable: false });
    await expect(mk(429, 'too many requests').generateInitialScene(input)).rejects.toMatchObject({ retryable: true });
    await expect(mk(503, 'capacity').generateInitialScene(input)).rejects.toMatchObject({ retryable: true });
    const err = await mk(401, 'bad token').generateInitialScene(input).catch((e) => e);
    expect(String(err.message)).not.toContain('tok-secret');
  });
});

describe('cuota de generaciones reales por partida y por día', () => {
  let ctx: TestCtx;
  let calls = 0;
  const fakeReal = (): ImageGenerationProvider => ({
    ...createDemoProvider(),
    id: 'cloudflare',
    capabilities: { edit: true },
    // Un proveedor real devuelve PNG/JPEG (el SVG sólo se admite del proveedor demo)
    generateInitialScene: async () => { calls++; return { bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }; },
    editScene: async () => { calls++; return { bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }; },
  });
  beforeAll(async () => { ctx = await makeCtx(); });
  afterAll(async () => { await ctx.db.close(); });

  async function game(host: string, image_mode: 'stickers' | 'ai' = 'stickers') {
    const { room_code } = await createGame(ctx, host, { name: 'Q', image_mode, players: [{ name: 'Ana' }, { name: 'Beto' }] });
    return { room: room_code, snap: await getHostState(ctx, room_code, host) };
  }

  it('al llegar al límite por partida el trabajo falla con un mensaje claro, sin llamar al proveedor, y la partida sigue', async () => {
    process.env.IMAGE_QUOTA_PER_GAME = '2';
    process.env.IMAGE_QUOTA_PER_DAY = '1000';
    try {
      calls = 0;
      const host = newHost();
      const { room, snap } = await game(host);
      const real = { ...ctx, provider: fakeReal() };
      for (const p of snap.players) await act(ctx, room, host, { type: 'image.request_initial', player_id: p.id });
      await processImageJobs(real, { gameId: snap.game.id });
      expect(calls).toBe(2);
      // Tercera generación: se supera el límite
      const ana = playerByName(snap, 'Ana').id;
      await act(ctx, room, host, { type: 'image.request_initial', player_id: ana });
      const run = await processImageJobs(real, { gameId: snap.game.id });
      expect(run.failed).toBe(1);
      expect(calls).toBe(2);
      const s = await getHostState(ctx, room, host);
      const failed = s.jobs.find((j) => j.status === 'failed')!;
      expect(failed.error_message).toMatch(/Cuota de generaciones de esta partida alcanzada \(2\/2\)/);
      expect(s.usage).toMatchObject({ provider: 'demo', limited: false });
      // La partida sigue: la imagen existente se conserva y se puede continuar
      expect(playerByName(s, 'Ana').current_image).not.toBeNull();
      await act(ctx, room, host, { type: 'game.start' });
    } finally {
      delete process.env.IMAGE_QUOTA_PER_GAME;
      delete process.env.IMAGE_QUOTA_PER_DAY;
    }
  });

  it('el límite diario es global (todas las partidas) y el contador visible refleja el uso', async () => {
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.CLOUDFLARE_API_TOKEN = 't';
    process.env.IMAGE_QUOTA_PER_GAME = '50';
    try {
      const before = await ctx.db.pg.query<{ n: number }>("select count(*)::int as n from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date");
      process.env.IMAGE_QUOTA_PER_DAY = String(before.rows[0]!.n + 1);
      const host = newHost();
      const { room, snap } = await game(host, 'ai');
      const real = { ...ctx, provider: fakeReal() };
      for (const p of snap.players) await act(ctx, room, host, { type: 'image.request_initial', player_id: p.id });
      const run = await processImageJobs(real, { gameId: snap.game.id });
      expect(run.succeeded).toBe(1);
      expect(run.failed).toBe(1);
      const s = await getHostState(ctx, room, host);
      expect(s.usage).toMatchObject({ provider: 'cloudflare', limited: true, game_used: 1, game_limit: 50, day_limit: before.rows[0]!.n + 1 });
      expect(s.jobs.find((j) => j.status === 'failed')!.error_message).toMatch(/Cuota diaria/);
    } finally {
      for (const k of ['IMAGE_PROVIDER', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'IMAGE_QUOTA_PER_GAME', 'IMAGE_QUOTA_PER_DAY']) delete process.env[k];
    }
  });

  it('un proveedor sin edición no gasta cuota, conserva la imagen, el saldo y la compra; el reintento no cobra', async () => {
    const host = newHost();
    const { room, snap } = await game(host);
    for (const p of snap.players) await act(ctx, room, host, { type: 'image.request_initial', player_id: p.id });
    await processImageJobs(ctx, { gameId: snap.game.id });
    await act(ctx, room, host, { type: 'game.start' });
    const s0 = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s0.items[0]!.id });
    const ana = playerByName(s0, 'Ana');
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana.id, amount_cents: 400, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana.id, expected_price_cents: 400, idempotency_key: key() });
    const noEdit: ImageGenerationProvider = { ...fakeReal(), capabilities: { edit: false }, editScene: async () => { throw new ProviderError('no debe llamarse', false); } };
    const usageBefore = (await ctx.db.pg.query<{ n: number }>('select count(*)::int as n from image_usage')).rows[0]!.n;
    await processImageJobs({ ...ctx, provider: noEdit }, { gameId: snap.game.id });
    const s1 = await getHostState(ctx, room, host);
    const job = s1.jobs.find((j) => j.kind === 'edit')!;
    expect(job.status).toBe('failed');
    expect(job.error_message).toContain('no puede editar');
    expect((await ctx.db.pg.query<{ n: number }>('select count(*)::int as n from image_usage')).rows[0]!.n).toBe(usageBefore);
    expect(playerByName(s1, 'Ana')).toMatchObject({ balance_cents: 1600, current_image_version_id: ana.current_image_version_id });
    expect(s1.stats.purchases_count).toBe(1);
    // Con un proveedor que sí edita, el reintento completa sin recobrar ni crear otra compra
    await act(ctx, room, host, { type: 'image.retry', job_id: job.id });
    expect((await processImageJobs(ctx, { gameId: snap.game.id })).succeeded).toBe(1);
    const s2 = await getHostState(ctx, room, host);
    expect(playerByName(s2, 'Ana').balance_cents).toBe(1600);
    expect(s2.stats.purchases_count).toBe(1);
    expect(playerByName(s2, 'Ana').current_image_version_id).not.toBe(ana.current_image_version_id);
  });
});


describe('modo de imágenes por partida: pegatinas (sin IA) o IA', () => {
  let ctx: TestCtx;
  let aiCalls = 0;
  const ai: ImageGenerationProvider = {
    ...createDemoProvider(),
    id: 'cloudflare',
    capabilities: { edit: true },
    generateInitialScene: async () => { aiCalls++; return { bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }; },
    editScene: async () => { aiCalls++; return { bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }; },
  };
  beforeAll(async () => { ctx = await makeCtx(); });
  afterAll(async () => { await ctx.db.close(); });

  async function lobby(host: string, image_mode: 'stickers' | 'ai') {
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.CLOUDFLARE_API_TOKEN = 't';
    try {
      const { room_code } = await createGame(ctx, host, { name: 'M', image_mode, players: [{ name: 'Ana' }, { name: 'Beto' }] });
      return { room: room_code, snap: await getHostState(ctx, room_code, host) };
    } finally {
      for (const k of ['IMAGE_PROVIDER', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) delete process.env[k];
    }
  }

  it('el modo por defecto es pegatinas; elegir IA sin proveedor configurado se rechaza con un error claro', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'D', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    expect((await getHostState(ctx, room_code, host)).game.image_mode).toBe('stickers');
    await expect(createGame(ctx, host, { name: 'X', image_mode: 'ai', players: [] })).rejects.toMatchObject({ code: 'ai_not_available' });
    await expect(act(ctx, room_code, host, { type: 'game.set_image_mode', image_mode: 'ai' })).rejects.toMatchObject({ code: 'ai_not_available' });
  });

  it('cada partida usa SU proveedor: pegatinas -> local sin cuota; IA -> proveedor real con cuota', async () => {
    const both = { ...ctx, provider: ai, stickers: createDemoProvider() };
    const host = newHost();
    const st = await lobby(host, 'stickers');
    const real = await lobby(host, 'ai');
    expect(real.snap.game.image_mode).toBe('ai');
    aiCalls = 0;
    for (const g of [st, real]) for (const p of g.snap.players) await act(ctx, g.room, host, { type: 'image.request_initial', player_id: p.id });
    const r = await processImageJobs(both, { maxJobs: 20 });
    expect(r.succeeded).toBe(4);
    expect(aiCalls).toBe(2); // sólo la partida en modo IA llamó al proveedor real
    const stState = await getHostState(ctx, st.room, host);
    expect(stState.players.every((p) => p.current_image?.provider === 'demo')).toBe(true);
    expect(stState.players[0]!.current_image!.storage_path).toMatch(/\.svg$/);
    const aiState = await getHostState(ctx, real.room, host);
    expect(aiState.players.every((p) => p.current_image?.provider === 'cloudflare')).toBe(true);
    const used = await ctx.db.pg.query<{ n: number }>('select count(*)::int as n from image_usage u join games g on g.id = u.game_id where g.room_code = $1', [st.room]);
    expect(used.rows[0]!.n).toBe(0);
  });

  it('si la IA no está configurada, los trabajos del modo IA no se reclaman (siguen en cola) pero las pegatinas funcionan', async () => {
    const onlyStickers = { ...ctx, provider: null, stickers: createDemoProvider() };
    const host = newHost();
    const st = await lobby(host, 'stickers');
    const real = await lobby(host, 'ai');
    for (const g of [st, real]) for (const p of g.snap.players) await act(ctx, g.room, host, { type: 'image.request_initial', player_id: p.id });
    const r = await processImageJobs(onlyStickers, { maxJobs: 20 });
    expect(r.succeeded).toBe(2);
    const aiJobs = (await getHostState(ctx, real.room, host)).jobs;
    expect(aiJobs.every((j) => j.status === 'queued')).toBe(true);
    // El modo sólo se puede cambiar en la sala de espera
    await act(ctx, real.room, host, { type: 'game.set_image_mode', image_mode: 'stickers' });
    expect((await processImageJobs(onlyStickers, { maxJobs: 20 })).succeeded).toBe(2);
    await act(ctx, real.room, host, { type: 'game.start' });
    await expect(act(ctx, real.room, host, { type: 'game.set_image_mode', image_mode: 'stickers' })).rejects.toMatchObject({ code: 'game_already_started' });
  });
});

describe('interruptor de seguridad y continuidad de la partida', () => {
  it('IMAGE_AI_DISABLED apaga la IA real aunque haya proveedor y credenciales', () => {
    const real = { IMAGE_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    expect(getImageProviderId(real as never)).toBe('cloudflare');
    expect(getImageProviderId({ ...real, IMAGE_AI_DISABLED: 'true' } as never)).toBeNull();
    expect(getImageProviderId({ ...real, IMAGE_AI_DISABLED: '1' } as never)).toBeNull();
    expect(getImageProviderId({ ...real, IMAGE_AI_DISABLED: 'false' } as never)).toBe('cloudflare');
  });

  it('con 10 generaciones por partida: la 11ª no llama al proveedor, la última imagen válida se conserva y la subasta continúa', async () => {
    const c = await makeCtx();
    try {
      process.env.IMAGE_QUOTA_PER_GAME = '10';
      process.env.IMAGE_QUOTA_PER_DAY = '1000';
      let calls = 0;
      const real: ImageGenerationProvider = {
        ...createDemoProvider(), id: 'cloudflare', capabilities: { edit: true },
        generateInitialScene: async () => { calls++; return { bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }; },
        editScene: async () => { calls++; return { bytes: PNG, mime: 'image/png', prompt: 'p', model: 'm' }; },
      };
      const host = newHost();
      const { room_code: room } = await createGame(c, host, { name: 'Tope', players: [{ name: 'Ana' }, { name: 'Beto' }] });
      let snap = await getHostState(c, room, host);
      const ana = playerByName(snap, 'Ana').id;
      // 1 generación inicial (Ana) + 1 (Beto) = 2; y luego regeneraciones hasta agotar las 10
      for (const p of snap.players) await act(c, room, host, { type: 'image.request_initial', player_id: p.id });
      await processImageJobs({ ...c, provider: real }, { gameId: snap.game.id });
      await act(c, room, host, { type: 'game.start' });
      // Compras: cada una genera una edición real (8 más hasta llegar a 10)
      for (let i = 0; i < 9; i++) {
        snap = await getHostState(c, room, host);
        const item = snap.items.find((x) => x.status === 'available')!;
        const a = await act(c, room, host, { type: 'auction.announce', item_id: item.id });
        await act(c, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana, amount_cents: 100, idempotency_key: key() });
        await act(c, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana, expected_price_cents: 100, idempotency_key: key() });
        await processImageJobs({ ...c, provider: real }, { gameId: snap.game.id });
      }
      snap = await getHostState(c, room, host);
      expect(calls).toBe(10);
      const lastGood = playerByName(snap, 'Ana').current_image_version_id;
      expect(snap.jobs.filter((j) => j.status === 'failed')).toHaveLength(1); // la 10ª compra ya no cabe
      expect(snap.jobs.find((j) => j.status === 'failed')!.error_message).toMatch(/Cuota de generaciones de esta partida alcanzada/);
      // La subasta continúa con normalidad aunque la IA esté al límite
      const item = snap.items.find((x) => x.status === 'available')!;
      const a = await act(c, room, host, { type: 'auction.announce', item_id: item.id });
      await act(c, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana, amount_cents: 100, idempotency_key: key() });
      const aw = await act(c, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana, expected_price_cents: 100, idempotency_key: key() });
      expect(aw.snapshot.stats.purchases_count).toBe(10);
      await processImageJobs({ ...c, provider: real }, { gameId: snap.game.id });
      expect(calls).toBe(10); // el proveedor no se vuelve a llamar
      expect(playerByName(await getHostState(c, room, host), 'Ana').current_image_version_id).toBe(lastGood); // imagen válida conservada
    } finally {
      delete process.env.IMAGE_QUOTA_PER_GAME;
      delete process.env.IMAGE_QUOTA_PER_DAY;
      await c.db.close();
    }
  });
});
