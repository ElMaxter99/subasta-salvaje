import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, deleteGame, getHostState, getPublicState, listGames, purgeExpiredGames } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function playedGame(host: string) {
  const { room_code: room } = await createGame(ctx, host, { name: 'Borrable', players: [{ name: 'Ana' }, { name: 'Beto' }] });
  let snap = await getHostState(ctx, room, host);
  for (const p of snap.players) await act(ctx, room, host, { type: 'image.request_initial', player_id: p.id });
  await processImageJobs(ctx, { gameId: snap.game.id });
  await act(ctx, room, host, { type: 'game.start' });
  snap = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: snap.items[0]!.id });
  const ana = playerByName(snap, 'Ana').id;
  await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana, amount_cents: 300, idempotency_key: key() });
  await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: key() });
  await processImageJobs(ctx, { gameId: snap.game.id });
  return { room, gameId: snap.game.id };
}
const count = async (table: string, gameId: string) =>
  (await ctx.db.pg.query<{ n: number }>(`select count(*)::int as n from ${table} where game_id = $1`, [gameId])).rows[0]!.n;

describe('borrar partida (anfitrión)', () => {
  it('borra la partida y TODO lo asociado, incluidos los archivos de imagen', async () => {
    const host = newHost();
    const { room, gameId } = await playedGame(host);
    expect([...ctx.storage.files.keys()].some((k) => k.startsWith(`games/${gameId}/`))).toBe(true);
    expect(await count('purchases', gameId)).toBe(1);
    await deleteGame(ctx, room, host);
    for (const t of ['players', 'auction_items', 'auctions', 'purchases', 'image_versions', 'image_jobs', 'game_events']) expect(await count(t, gameId)).toBe(0);
    expect([...ctx.storage.files.keys()].some((k) => k.startsWith(`games/${gameId}/`))).toBe(false);
    await expect(getPublicState(ctx, room)).rejects.toMatchObject({ code: 'game_not_found' });
    expect((await listGames(ctx, host)).some((g) => g.room_code === room)).toBe(false);
    await expect(deleteGame(ctx, room, host)).rejects.toMatchObject({ code: 'game_not_found' });
  });

  it('sólo el propietario puede borrarla y no se pierde nada si otro lo intenta', async () => {
    const host = newHost();
    const { room, gameId } = await playedGame(host);
    await expect(deleteGame(ctx, room, newHost())).rejects.toMatchObject({ code: 'not_host' });
    expect(await count('players', gameId)).toBe(2);
    expect((await getHostState(ctx, room, host)).game.name).toBe('Borrable');
  });

  it('se puede borrar en cualquier estado (sala de espera, en curso, pausada, finalizada)', async () => {
    const host = newHost();
    const lobby = (await createGame(ctx, host, { name: 'L', players: [{ name: 'A' }, { name: 'B' }] })).room_code;
    await expect(deleteGame(ctx, lobby, host)).resolves.toBeUndefined();
    const { room } = await playedGame(host);
    await act(ctx, room, host, { type: 'game.pause' });
    await act(ctx, room, host, { type: 'game.finish' }); // finalizar estando en pausa
    expect((await getHostState(ctx, room, host)).game.status).toBe('finished');
    await expect(deleteGame(ctx, room, host)).resolves.toBeUndefined();
  });
});

describe('borrado automático por inactividad', () => {
  it('borra las partidas sin actividad desde hace más de 7 días (y sus archivos) y respeta las recientes', async () => {
    const host = newHost();
    const old = await playedGame(host);
    const fresh = await playedGame(host);
    await ctx.db.pg.query("update games set updated_at = now() - interval '8 days' where id = $1", [old.gameId]);
    await ctx.db.pg.query("update games set updated_at = now() - interval '6 days' where id = $1", [fresh.gameId]);
    expect(await purgeExpiredGames(ctx)).toEqual({ deleted: 1 });
    await expect(getPublicState(ctx, old.room)).rejects.toMatchObject({ code: 'game_not_found' });
    expect([...ctx.storage.files.keys()].some((k) => k.startsWith(`games/${old.gameId}/`))).toBe(false);
    expect((await getPublicState(ctx, fresh.room)).game.name).toBe('Borrable');
    expect(await purgeExpiredGames(ctx)).toEqual({ deleted: 0 });
  });

  it('el plazo es configurable (GAME_TTL_HOURS) y la actividad reciente reinicia el contador', async () => {
    const host = newHost();
    const g = await playedGame(host);
    await ctx.db.pg.query("update games set updated_at = now() - interval '3 hours' where id = $1", [g.gameId]);
    process.env.GAME_TTL_HOURS = '2';
    try {
      // Una acción del anfitrión actualiza updated_at: la partida ya no está caducada
      await act(ctx, g.room, host, { type: 'game.update', name: 'Sigo jugando' });
      await purgeExpiredGames(ctx, { limit: 50 });
      expect((await getPublicState(ctx, g.room)).game.name).toBe('Sigo jugando'); // sigue viva
      await ctx.db.pg.query("update games set updated_at = now() - interval '3 hours' where id = $1", [g.gameId]);
      await purgeExpiredGames(ctx, { limit: 50 });
      await expect(getPublicState(ctx, g.room)).rejects.toMatchObject({ code: 'game_not_found' });
    } finally {
      delete process.env.GAME_TTL_HOURS;
    }
  });

  it('crear o listar partidas también limpia las caducadas (sin depender del cron) y muestra cuándo caducará', async () => {
    const host = newHost();
    const old = await playedGame(host);
    await ctx.db.pg.query("update games set updated_at = now() - interval '9 days' where id = $1", [old.gameId]);
    await listGames(ctx, host);
    await expect(getPublicState(ctx, old.room)).rejects.toMatchObject({ code: 'game_not_found' });
    const g = await playedGame(host);
    const s = await getHostState(ctx, g.room, host);
    const hours = (Date.parse(s.expires_at!) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(167.9);
    expect(hours).toBeLessThanOrEqual(168.01);
  });
});
