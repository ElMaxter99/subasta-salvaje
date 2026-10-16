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

describe('imagen de partida común para todos', () => {
  it('la galería aplica la misma imagen a todos, sólo antes de empezar, y se puede seguir editando con el proveedor de muestra', async () => {
    const host = newHost();
    const { room } = await lobby(host);
    const r = await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'house' });
    expect(r.snapshot.players.every((p) => p.current_image?.provider === 'catalog')).toBe(true);
    const paths = new Set(r.snapshot.players.map((p) => p.current_image!.storage_path));
    expect(paths.size).toBe(1); // un único archivo compartido
    await expect(act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'no-existe' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(act(ctx, room, newHost(), { type: 'image.set_initial_all', catalog_id: 'house' })).rejects.toMatchObject({ code: 'not_host' });
    await act(ctx, room, host, { type: 'game.start' });
    await expect(act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'island' })).rejects.toMatchObject({ code: 'game_already_started' });
    // compra y edición sobre la imagen de galería (SVG)
    const s = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    const ana = playerByName(s, 'Ana').id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana, amount_cents: 300, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: key() });
    expect((await processImageJobs(ctx, { gameId: s.game.id })).succeeded).toBe(1);
  });

  it('una imagen PNG subida para todos también se puede editar con el proveedor de muestra (se incrusta en un SVG)', async () => {
    const { uploadInitialImageForAll } = await import('@/lib/services/game-service');
    const host = newHost();
    const { room } = await lobby(host);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const r = await uploadInitialImageForAll(ctx, room, host, png);
    expect(r.snapshot.players.every((p) => p.current_image?.provider === 'upload')).toBe(true);
    await expect(uploadInitialImageForAll(ctx, room, host, new TextEncoder().encode('no es imagen'))).rejects.toMatchObject({ code: 'invalid_input' });
    await act(ctx, room, host, { type: 'game.start' });
    const s = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    const beto = playerByName(s, 'Beto').id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: beto, amount_cents: 300, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: beto, expected_price_cents: 300, idempotency_key: key() });
    expect((await processImageJobs(ctx, { gameId: s.game.id })).succeeded).toBe(1);
    const cur = playerByName(await getHostState(ctx, room, host), 'Beto').current_image!;
    const svg = new TextDecoder().decode(ctx.storage.files.get(cur.storage_path!)!.bytes);
    expect(svg).toContain('data:image/png;base64');
    expect(svg).toContain('data-demo-sticker');
  });
});

describe('migraciones del modo demo', () => {
  it('una base local antigua (sin tabla de seguimiento) se actualiza sola sin repetir migraciones', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createPgliteDb, portableMigrations } = await import('@/lib/db/pglite');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ss-legacy-'));
    try {
      // Simula una BD creada sólo con la migración núcleo (versión antigua, sin seguimiento)
      const { PGlite } = await import('@electric-sql/pglite');
      const old = new PGlite(path.join(dir, 'pg'));
      await old.exec(portableMigrations()[0]!.sql);
      await old.close();
      const db = await createPgliteDb(path.join(dir, 'pg'));
      const cols = await db.pg.query("select 1 from information_schema.columns where table_name='games' and column_name='play_mode'");
      expect(cols.rows).toHaveLength(1);
      const applied = (await db.pg.query<{ name: string }>('select name from ss_migrations order by name')).rows.map((r) => r.name);
      expect(applied).toEqual(portableMigrations().map((m) => m.name));
      await db.close();
      // Reabrir no vuelve a aplicar nada
      const again = await createPgliteDb(path.join(dir, 'pg'));
      expect((await again.pg.query('select count(*)::int as n from ss_migrations')).rows[0]).toEqual({ n: portableMigrations().length });
      await again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
