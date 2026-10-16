import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, uploadInitialImage } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function lobby(host: string) {
  const { room_code } = await createGame(ctx, host, { name: 'R', players: [{ name: 'Ana' }, { name: 'Beto' }] });
  return { room: room_code, snap: await getHostState(ctx, room_code, host) };
}

describe('regresiones de la revisión independiente', () => {
  it('empezar con imágenes iniciales aún pendientes no deja al jugador sin base de edición', async () => {
    const host = newHost();
    const { room, snap } = await lobby(host);
    const ana = playerByName(snap, 'Ana').id;
    await act(ctx, room, host, { type: 'image.request_initial', player_id: ana });
    await act(ctx, room, host, { type: 'game.start' });
    await processImageJobs(ctx, { gameId: snap.game.id });
    const s = await getHostState(ctx, room, host);
    expect(playerByName(s, 'Ana').current_image).not.toBeNull();
    expect(playerByName(s, 'Ana').initial_image).not.toBeNull();
  });

  it('una imagen inicial tardía no pisa la que el anfitrión subió después', async () => {
    const host = newHost();
    const { room, snap } = await lobby(host);
    const ana = playerByName(snap, 'Ana').id;
    await act(ctx, room, host, { type: 'image.request_initial', player_id: ana });
    const claimed = await ctx.db.rpc<{ job_id: string }>('ss_claim_image_job', { worker_id: 'w-lento', game_id: snap.game.id });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const up = await uploadInitialImage(ctx, room, host, ana, png);
    const uploaded = playerByName(up.snapshot, 'Ana').current_image_version_id;
    await ctx.db.rpc('ss_complete_image_job', { job_id: claimed.job_id, worker_id: 'w-lento', storage_path: 'games/x/tarde.png', mime_type: 'image/png', bytes: 5, prompt: 'p', provider: 'demo' });
    expect(playerByName(await getHostState(ctx, room, host), 'Ana').current_image_version_id).toBe(uploaded);
  });

  it('nombres duplicados y borrado de elementos ya subastados dan errores de dominio, no 500', async () => {
    const host = newHost();
    await expect(createGame(ctx, host, { name: 'D', players: [{ name: 'A' }, { name: 'a' }] })).rejects.toMatchObject({ code: 'duplicate_name' });
    const { room, snap } = await lobby(host);
    await expect(act(ctx, room, host, { type: 'player.update', player_id: playerByName(snap, 'Beto').id, name: 'ana' })).rejects.toMatchObject({ code: 'duplicate_name' });
    await act(ctx, room, host, { type: 'game.start' });
    const item = snap.items[0]!;
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id });
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: a.snapshot.auction!.id });
    await expect(act(ctx, room, host, { type: 'item.remove', item_id: item.id })).rejects.toMatchObject({ code: 'item_locked' });
  });

  it('una clave de idempotencia no puede reutilizarse para otra acción', async () => {
    const host = newHost();
    const { room, snap } = await lobby(host);
    await act(ctx, room, host, { type: 'game.start' });
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: snap.items[0]!.id });
    const auctionId = a.snapshot.auction!.id;
    const ana = playerByName(snap, 'Ana').id;
    const k = key();
    await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: ana, amount_cents: 300, idempotency_key: k });
    await expect(act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: k })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('un lease agotado y caducado termina en fallo terminal con versión fallida, sin tocar otras partidas', async () => {
    const host = newHost();
    const { room, snap } = await lobby(host);
    const ana = playerByName(snap, 'Ana').id;
    await act(ctx, room, host, { type: 'image.request_initial', player_id: ana });
    await ctx.db.pg.query("update image_jobs set status='running', attempts=3, locked_by='x', locked_until=now()-interval '1 minute' where player_id=$1", [ana]);
    await processImageJobs(ctx, { gameId: snap.game.id });
    const s = await getHostState(ctx, room, host);
    expect(s.jobs[0]).toMatchObject({ status: 'failed' });
    expect(s.versions.some((v) => v.generation_status === 'failed')).toBe(true);
  });
});

describe('topes de coste de IA', () => {
  it('limita los reintentos manuales de un mismo trabajo', async () => {
    const host = newHost();
    const { room, snap } = await lobby(host);
    const ana = playerByName(snap, 'Ana').id;
    await act(ctx, room, host, { type: 'image.request_initial', player_id: ana });
    const jobId = (await getHostState(ctx, room, host)).jobs[0]!.id;
    for (let i = 0; i < 5; i++) {
      await ctx.db.pg.query("update image_jobs set status='failed' where id=$1", [jobId]);
      await act(ctx, room, host, { type: 'image.retry', job_id: jobId });
    }
    await ctx.db.pg.query("update image_jobs set status='failed' where id=$1", [jobId]);
    await expect(act(ctx, room, host, { type: 'image.retry', job_id: jobId })).rejects.toMatchObject({ code: 'retry_limit' });
  });
});
