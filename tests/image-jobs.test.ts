import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoProvider } from '@/lib/ai/demo';
import { createOpenAiProvider } from '@/lib/ai/openai';
import { sniffImageMime, validateImage } from '@/lib/ai/image-validation';
import { buildEditPrompt } from '@/lib/ai/prompts';
import { ProviderError, type ImageGenerationProvider } from '@/lib/ai/types';
import { getHostState, uploadInitialImage } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx, REAL_PNG, REAL_PNG_B64 } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

/** Partida con imágenes iniciales ya generadas (como en el flujo real, antes de empezar). */
async function gameWithImages(host: string, players = ['Ana', 'Beto']) {
  const { createGame } = await import('@/lib/services/game-service');
  const { room_code } = await createGame(ctx, host, { name: 'Con imágenes', integer_bids: false, players: players.map((name) => ({ name })) });
  let snap = await getHostState(ctx, room_code, host);
  for (const p of snap.players) await act(ctx, room_code, host, { type: 'image.request_initial', player_id: p.id });
  const run = await processImageJobs(ctx, { gameId: snap.game.id });
  expect(run.succeeded).toBe(players.length);
  await act(ctx, room_code, host, { type: 'game.start' });
  snap = await getHostState(ctx, room_code, host);
  return { room: room_code, snap };
}

async function buy(host: string, room: string, playerId: string, price = 300, itemIndex = 0) {
  const s = await getHostState(ctx, room, host);
  const item = s.items.filter((i) => i.status === 'available')[itemIndex]!;
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id });
  const auctionId = a.snapshot.auction!.id;
  await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerId, amount_cents: price, idempotency_key: key() });
  return act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: playerId, expected_price_cents: price, idempotency_key: key() });
}

describe('imagen inicial', () => {
  it('genera, almacena y asocia la imagen inicial al jugador (proveedor de muestra marcado como demo)', async () => {
    const host = newHost();
    const { snap } = await gameWithImages(host);
    for (const p of snap.players) {
      expect(p.current_image?.storage_path).toMatch(/^games\/.+\.svg$/);
      expect(p.current_image?.provider).toBe('demo');
      expect(p.initial_image?.id).toBe(p.current_image?.id);
      expect(ctx.storage.files.has(p.current_image!.storage_path!)).toBe(true);
    }
  });

  it('permite regenerar y elegir otra imagen inicial antes de empezar', async () => {
    const host = newHost();
    const { createGame } = await import('@/lib/services/game-service');
    const { room_code } = await createGame(ctx, host, { name: 'X', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    let snap = await getHostState(ctx, room_code, host);
    const ana = playerByName(snap, 'Ana').id;
    await act(ctx, room_code, host, { type: 'image.request_initial', player_id: ana });
    await processImageJobs(ctx, { gameId: snap.game.id });
    await act(ctx, room_code, host, { type: 'image.request_initial', player_id: ana });
    await processImageJobs(ctx, { gameId: snap.game.id });
    snap = await getHostState(ctx, room_code, host);
    const versions = snap.versions.filter((v) => v.player_id === ana);
    expect(versions.length).toBe(2);
    const r = await act(ctx, room_code, host, { type: 'image.restore', player_id: ana, version_id: versions[0]!.id });
    expect(playerByName(r.snapshot, 'Ana').current_image_version_id).toBe(versions[0]!.id);
  });

  it('acepta una imagen subida válida y rechaza tipos/tamaños no permitidos', async () => {
    const host = newHost();
    const { createGame } = await import('@/lib/services/game-service');
    const { room_code } = await createGame(ctx, host, { name: 'X', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const snap = await getHostState(ctx, room_code, host);
    const png = REAL_PNG;
    const ok = await uploadInitialImage(ctx, room_code, host, snap.players[0]!.id, png);
    expect(ok.snapshot.players[0]!.current_image?.provider).toBe('upload');
    await expect(uploadInitialImage(ctx, room_code, host, snap.players[0]!.id, new TextEncoder().encode('<svg onload=alert(1)>'))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(uploadInitialImage(ctx, room_code, host, snap.players[0]!.id, new Uint8Array(9 * 1024 * 1024).fill(1))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(uploadInitialImage(ctx, room_code, newHost(), snap.players[0]!.id, png)).rejects.toMatchObject({ code: 'not_host' });
  });
});

describe('9. Trabajo de IA tras una compra', () => {
  it('la adjudicación crea un trabajo vinculado a la compra; al terminar se añade una versión nueva y actual', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana');
    const bought = await buy(host, room, ana.id);
    const job = bought.snapshot.jobs.find((j) => j.kind === 'edit')!;
    expect(job.status).toBe('queued');
    expect(job.purchase_id).toBe(playerByName(bought.snapshot, 'Ana').purchases[0]!.purchase_id);
    expect(playerByName(bought.snapshot, 'Ana').generating).toHaveLength(1);
    // Mientras tanto, la imagen anterior sigue siendo la actual
    expect(playerByName(bought.snapshot, 'Ana').current_image_version_id).toBe(ana.current_image_version_id);

    const run = await processImageJobs(ctx, { gameId: snap.game.id });
    expect(run.succeeded).toBe(1);
    const after = await getHostState(ctx, room, host);
    const a2 = playerByName(after, 'Ana');
    expect(a2.current_image_version_id).not.toBe(ana.current_image_version_id);
    expect(a2.generating).toHaveLength(0);
    const v = after.versions.find((x) => x.id === a2.current_image_version_id)!;
    expect(v).toMatchObject({ parent_version_id: ana.current_image_version_id, origin: 'edit', generation_status: 'completed', is_approved: true });
    expect(v.prompt_used).toContain('[PEGATINAS]');
    expect(v.source_purchase_id).toBe(job.purchase_id);
    expect(after.jobs.find((j) => j.id === job.id)!.status).toBe('completed');
    // Cumulativo: la nueva imagen contiene la anterior más la pegatina
    const svg = new TextDecoder().decode(ctx.storage.files.get(v.storage_path!)!.bytes);
    expect(svg.match(/data-demo-sticker/g)).toHaveLength(1);
  });

  it('las compras sucesivas se acumulan sobre la misma imagen, en orden', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana').id;
    await buy(host, room, ana, 200);
    await buy(host, room, ana, 200);
    await buy(host, room, ana, 200);
    const run = await processImageJobs(ctx, { gameId: snap.game.id });
    expect(run.succeeded).toBe(3);
    const after = await getHostState(ctx, room, host);
    const cur = playerByName(after, 'Ana').current_image!;
    const svg = new TextDecoder().decode(ctx.storage.files.get(cur.storage_path!)!.bytes);
    expect(svg.match(/data-demo-sticker/g)).toHaveLength(3);
    const chain = after.versions.filter((v) => v.player_id === ana);
    expect(chain).toHaveLength(4); // inicial + 3
    expect(chain[3]!.parent_version_id).toBe(chain[2]!.id);
    expect(chain[2]!.parent_version_id).toBe(chain[1]!.id);
  });

  it('procesar dos veces en paralelo no duplica versiones (reclamación atómica)', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    await buy(host, room, playerByName(snap, 'Ana').id);
    await buy(host, room, playerByName(snap, 'Beto').id);
    const [a, b] = await Promise.all([processImageJobs(ctx, { workerId: 'w1', gameId: snap.game.id }), processImageJobs(ctx, { workerId: 'w2', gameId: snap.game.id })]);
    expect(a.succeeded + b.succeeded).toBe(2);
    const after = await getHostState(ctx, room, host);
    expect(after.versions.filter((v) => v.origin === 'edit')).toHaveLength(2);
  });
});

describe('10-11. Fallos de IA: la compra se mantiene y el reintento no cobra', () => {
  const failing: ImageGenerationProvider = {
    ...createDemoProvider(),
    editScene: async () => {
      throw new ProviderError('OpenAI 500: servidor caído', true);
    },
  };

  it('la imagen guarda el proveedor que respondió realmente (cadena) y no el id del primero', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana');
    await buy(host, room, ana.id, 450);
    const demo = createDemoProvider();
    const chained = { ...demo, editScene: async (i: Parameters<typeof demo.editScene>[0]) => ({ ...(await demo.editScene(i)), provider: 'demo' }) };
    await processImageJobs({ ...ctx, provider: chained }, { gameId: snap.game.id });
    const after = await getHostState(ctx, room, host);
    expect(playerByName(after, 'Ana').current_image?.provider).toBe('demo');
  });

  it('tras agotar reintentos el trabajo queda fallido, se conserva la imagen aprobada y el saldo; reintentar no vuelve a cobrar', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana');
    await buy(host, room, ana.id, 450);

    const failCtx = { ...ctx, provider: failing };
    for (let i = 0; i < 3; i++) {
      await processImageJobs(failCtx, { gameId: snap.game.id });
      // Salta el backoff para el test
      await ctx.db.pg.query("update image_jobs set run_after = now() where status = 'queued'");
    }
    let after = await getHostState(ctx, room, host);
    const job = after.jobs.find((j) => j.kind === 'edit')!;
    expect(job).toMatchObject({ status: 'failed', attempts: 3 });
    expect(job.error_message).toContain('servidor caído');
    // La compra y el saldo siguen intactos; la imagen aprobada anterior sigue siendo la actual
    const a = playerByName(after, 'Ana');
    expect(a.balance_cents).toBe(1550);
    expect(a.purchases).toHaveLength(1);
    expect(a.current_image_version_id).toBe(ana.current_image_version_id);
    expect(after.versions.some((v) => v.generation_status === 'failed' && !v.is_approved && v.error_message)).toBe(true);
    expect(a.generating).toHaveLength(0);

    // Reintento manual con proveedor sano: sin nueva compra ni nuevo cobro
    await act(ctx, room, host, { type: 'image.retry', job_id: job.id });
    const retry = await processImageJobs(ctx, { gameId: snap.game.id });
    expect(retry.succeeded).toBe(1);
    after = await getHostState(ctx, room, host);
    const a2 = playerByName(after, 'Ana');
    expect(a2.balance_cents).toBe(1550);
    expect(a2.purchases).toHaveLength(1);
    expect(after.stats.purchases_count).toBe(1);
    expect(after.jobs.filter((j) => j.kind === 'edit')).toHaveLength(1);
    expect(after.jobs.find((j) => j.id === job.id)!.status).toBe('completed');
    expect(a2.current_image_version_id).not.toBe(ana.current_image_version_id);
    // Repetir el reintento de un trabajo completado se rechaza
    await expect(act(ctx, room, host, { type: 'image.retry', job_id: job.id })).rejects.toMatchObject({ code: 'job_already_completed' });
  });

  it('un error no reintentable (p. ej. moderación) falla de inmediato sin consumir todos los intentos', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    await buy(host, room, playerByName(snap, 'Beto').id);
    const blocked = { ...ctx, provider: { ...createDemoProvider(), editScene: async () => { throw new ProviderError('rechazado por seguridad', false); } } };
    await processImageJobs(blocked, { gameId: snap.game.id });
    const after = await getHostState(ctx, room, host);
    expect(after.jobs.find((j) => j.kind === 'edit')).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('un fallo intermedio reintenta con espera y el siguiente intento puede tener éxito', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    await buy(host, room, playerByName(snap, 'Ana').id);
    let calls = 0;
    const flaky: ImageGenerationProvider = {
      ...createDemoProvider(),
      editScene: async (i) => {
        if (++calls === 1) throw new ProviderError('timeout', true);
        return createDemoProvider().editScene(i);
      },
    };
    const first = await processImageJobs({ ...ctx, provider: flaky }, { gameId: snap.game.id });
    expect(first.failed).toBe(1);
    let s = await getHostState(ctx, room, host);
    expect(s.jobs.find((j) => j.kind === 'edit')).toMatchObject({ status: 'queued', attempts: 1 });
    expect(new Date(s.jobs.find((j) => j.kind === 'edit')!.run_after).getTime()).toBeGreaterThan(Date.now());
    // Aún en espera: no se reclama
    expect((await processImageJobs({ ...ctx, provider: flaky }, { gameId: snap.game.id })).processed).toBe(0);
    await ctx.db.pg.query("update image_jobs set run_after = now() where status = 'queued'");
    expect((await processImageJobs({ ...ctx, provider: flaky }, { gameId: snap.game.id })).succeeded).toBe(1);
    s = await getHostState(ctx, room, host);
    expect(s.jobs.find((j) => j.kind === 'edit')!.status).toBe('completed');
  });

  it('sin proveedor de IA configurado los trabajos quedan en cola y no se simula nada', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    await buy(host, room, playerByName(snap, 'Ana').id);
    const res = await processImageJobs({ ...ctx, provider: null }, { gameId: snap.game.id });
    expect(res).toMatchObject({ processed: 0, skipped: 'provider_not_configured' });
    const after = await getHostState(ctx, room, host);
    expect(after.jobs.find((j) => j.kind === 'edit')!.status).toBe('queued');
  });

  it('un worker caído (lease caducado) se recupera en la siguiente pasada', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    await buy(host, room, playerByName(snap, 'Ana').id);
    await ctx.db.rpc('ss_claim_image_job', { worker_id: 'muerto', lease_seconds: 300, game_id: snap.game.id });
    expect((await processImageJobs(ctx, { gameId: snap.game.id })).processed).toBe(0); // lease vigente
    await ctx.db.pg.query("update image_jobs set locked_until = now() - interval '1 minute' where status = 'running'");
    expect((await processImageJobs(ctx, { gameId: snap.game.id })).succeeded).toBe(1);
  });
});

describe('12. Versiones: guardar y restaurar', () => {
  it('restaura una versión anterior sin borrar posteriores ni tocar saldos o compras', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana');
    await buy(host, room, ana.id, 400);
    await buy(host, room, ana.id, 250);
    await processImageJobs(ctx, { gameId: snap.game.id });
    let s = await getHostState(ctx, room, host);
    const versions = s.versions.filter((v) => v.player_id === ana.id);
    expect(versions).toHaveLength(3);
    const balance = playerByName(s, 'Ana').balance_cents;
    const r = await act(ctx, room, host, { type: 'image.restore', player_id: ana.id, version_id: versions[1]!.id });
    s = r.snapshot;
    expect(playerByName(s, 'Ana').current_image_version_id).toBe(versions[1]!.id);
    expect(s.versions.filter((v) => v.player_id === ana.id)).toHaveLength(3); // nada se borra
    expect(playerByName(s, 'Ana').balance_cents).toBe(balance);
    expect(playerByName(s, 'Ana').purchases).toHaveLength(2);
    // Restaurar la última recupera el estado completo
    s = (await act(ctx, room, host, { type: 'image.restore', player_id: ana.id, version_id: versions[2]!.id })).snapshot;
    expect(playerByName(s, 'Ana').current_image_version_id).toBe(versions[2]!.id);
  });

  it('una actualización atrasada no pisa una restauración más reciente', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana');
    await buy(host, room, ana.id);
    // El worker reclama el trabajo (base = versión inicial) ...
    const claimed = await ctx.db.rpc<{ job_id: string }>('ss_claim_image_job', { worker_id: 'lento', game_id: snap.game.id });
    // ... y mientras tanto el anfitrión sube/restaura otra imagen distinta
    const other = await ctx.db.pg.query<{ id: string }>(
      "insert into image_versions (game_id, player_id, storage_path, origin, provider, is_approved) select game_id, id, 'games/x/otra.png', 'uploaded', 'upload', true from players where id = $1 returning id",
      [ana.id],
    );
    await act(ctx, room, host, { type: 'image.restore', player_id: ana.id, version_id: other.rows[0]!.id });
    await ctx.db.rpc('ss_complete_image_job', { job_id: claimed.job_id, worker_id: 'lento', storage_path: 'games/x/tarde.png', mime_type: 'image/png', bytes: 10, prompt: 'p', provider: 'demo' });
    const s = await getHostState(ctx, room, host);
    expect(playerByName(s, 'Ana').current_image_version_id).toBe(other.rows[0]!.id);
    const late = s.versions.find((v) => v.storage_path === 'games/x/tarde.png')!;
    expect(late.is_approved).toBe(true); // queda disponible en el historial para restaurar
  });

  it('no se puede restaurar una versión fallida ni de otro jugador', async () => {
    const host = newHost();
    const { room, snap } = await gameWithImages(host);
    const ana = playerByName(snap, 'Ana');
    const beto = playerByName(snap, 'Beto');
    await expect(act(ctx, room, host, { type: 'image.restore', player_id: ana.id, version_id: beto.current_image_version_id })).rejects.toMatchObject({ code: 'version_not_found' });
    await buy(host, room, ana.id);
    const failCtx = { ...ctx, provider: { ...createDemoProvider(), editScene: async () => { throw new ProviderError('x', false); } } };
    await processImageJobs(failCtx, { gameId: snap.game.id });
    const s = await getHostState(ctx, room, host);
    const failedV = s.versions.find((v) => v.generation_status === 'failed')!;
    await expect(act(ctx, room, host, { type: 'image.restore', player_id: ana.id, version_id: failedV.id })).rejects.toMatchObject({ code: 'version_not_restorable' });
  });
});

describe('proveedor OpenAI (HTTP simulado, sin red real)', () => {
  const png = REAL_PNG_B64;

  it('genera con /images/generations y edita con /images/edits enviando la imagen base', async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: init.body });
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createOpenAiProvider({ apiKey: 'test-key', fetchImpl });
    const gen = await p.generateInitialScene({ theme: 'house', sceneDescription: 'an empty house', playerName: 'Ana' });
    expect(sniffImageMime(gen.bytes)).toBe('image/png');
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer test-key');

    const edit = await p.editScene({ base: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }, theme: 'house', itemName: 'Piscina', itemDescription: 'azul', itemEmoji: null, previousItems: ['Sofá'] });
    expect(seen[1]!.url).toBe('https://api.openai.com/v1/images/edits');
    const form = seen[1]!.body as FormData;
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(form.get('input_fidelity')).toBe('high');
    expect(String(form.get('prompt'))).toContain('Piscina');
    expect(edit.prompt).toContain('Sofá');
  });

  it('clasifica errores: 429/5xx reintentables, moderación y 400 definitivos', async () => {
    const mk = (status: number, code?: string) =>
      createOpenAiProvider({ apiKey: 'k', fetchImpl: (async () => new Response(JSON.stringify({ error: { message: 'x', code } }), { status })) as unknown as typeof fetch });
    const input = { theme: 't', sceneDescription: 's', playerName: 'p' };
    await expect(mk(429).generateInitialScene(input)).rejects.toMatchObject({ retryable: true });
    await expect(mk(503).generateInitialScene(input)).rejects.toMatchObject({ retryable: true });
    await expect(mk(400, 'moderation_blocked').generateInitialScene(input)).rejects.toMatchObject({ retryable: false });
    await expect(mk(401).generateInitialScene(input)).rejects.toMatchObject({ retryable: false });
  });

  it('el prompt de edición pide EDITAR la base (no pegar), conservar su identidad y lo ya añadido', () => {
    const p = buildEditPrompt({ base: { bytes: new Uint8Array(), mime: 'image/png' }, theme: 'house', itemName: 'Piscina', itemDescription: 'azul', itemEmoji: null, previousItems: ['Sofá', 'Chimenea'] });
    expect(p).toMatch(/EDIT the base so the combination makes sense/);
    expect(p).toMatch(/edit it, do not replace it/);
    expect(p).toContain('Sofá, Chimenea');
    expect(p).toMatch(/No text, letters/);
  });

  it('valida el formato real de la imagen por sus bytes', () => {
    expect(() => validateImage(new TextEncoder().encode('<svg/>'))).toThrow();
    expect(() => validateImage(new Uint8Array())).toThrow();
    expect(validateImage(new TextEncoder().encode('<svg xmlns="x"/>'), { allowSvg: true })).toBe('image/svg+xml');
  });
});

