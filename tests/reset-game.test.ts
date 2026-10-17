import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createGame, getHostState, uploadInitialImageForAll } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const png = async (r: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 10, b: 10 } } }).png().toBuffer());

describe('reiniciar la partida', () => {
  it('la deja como en la sala de espera: sin compras ni imágenes generadas, con presupuesto inicial, y borra los archivos', async () => {
    const provider: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no aplica'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      editScene: async () => ({ bytes: await png(200), mime: 'image/png', prompt: 'p', model: 'm' }),
    };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Reinicio', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(1), { current: true, new: true });
    const before = await getHostState(ctx, room_code, host);
    const initialFiles = new Set(before.versions.map((v) => v.storage_path));
    await act(ctx, room_code, host, { type: 'game.start' });
    const s = await getHostState(ctx, room_code, host);
    const pid = playerByName(s, 'Ana').id;
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    await processImageJobs({ ...ctx, provider }, { gameId: s.game.id, maxJobs: 1 });
    const mid = await getHostState(ctx, room_code, host);
    const edit = mid.versions.find((v) => v.origin === 'edit')!;
    expect(edit).toBeTruthy();
    expect(ctx.storage.files.has(edit.storage_path!)).toBe(true);
    expect(playerByName(mid, 'Ana').balance_cents).toBeLessThan(playerByName(before, 'Ana').balance_cents);

    const r = await act(ctx, room_code, host, { type: 'game.reset' });
    expect(r.result).not.toHaveProperty('storage_paths');
    const after = await getHostState(ctx, room_code, host);
    expect(after.game.status).toBe('lobby');
    expect(after.items.every((i) => i.status === 'available')).toBe(true);
    expect(after.auction).toBeNull();
    expect(after.versions.map((v) => v.id).sort()).toEqual(before.versions.map((v) => v.id).sort());
    for (const p of after.players) {
      const was = playerByName(before, p.name);
      expect(p.balance_cents).toBe(was.balance_cents);
      expect(p.current_image_version_id).toBe(was.current_image_version_id);
    }
    expect(ctx.storage.files.has(edit.storage_path!)).toBe(false); // archivo generado borrado
    for (const f of initialFiles) if (f) expect(ctx.storage.files.has(f)).toBe(true); // imagen inicial intacta
    // Se puede volver a jugar y cobrar igual que la primera vez
    await act(ctx, room_code, host, { type: 'game.start' });
    const s2 = await getHostState(ctx, room_code, host);
    const a2 = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s2.items[0]!.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a2.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a2.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    expect(playerByName(await getHostState(ctx, room_code, host), 'Ana').balance_cents).toBe(playerByName(mid, 'Ana').balance_cents);
  });
});
