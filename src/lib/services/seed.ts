import { randomUUID } from 'node:crypto';
import { PLAYER_COLORS } from '@/lib/domain/schemas';
import type { AppContext } from './context';
import { createGame, getHostState, performAction } from './game-service';
import { ProviderError } from '@/lib/ai/types';
import { processImageJobs } from './jobs-service';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher' | 'provider'>;

export type SeedStage = 'lobby' | 'bidding' | 'midgame' | 'finished' | 'failedjob';

/**
 * SOLO MODO DEMO (la ruta que lo expone está desactivada en producción): crea una partida de ejemplo
 * para probar la interfaz. Todo pasa por los mismos servicios que la aplicación real.
 */
export async function seedDemoGame(ctx: Ctx, hostId: string, stage: SeedStage = 'midgame'): Promise<string> {
  const names = ['Lucía', 'Marcos', 'Irene', 'Pablo', 'Sofía'];
  const { room_code } = await createGame(ctx, hostId, {
    name: 'Noche de Subasta (demo)',
    theme: 'house',
    initial_budget_cents: 2000,
    ranking_rule: 'balance',
    players: names.map((name, i) => ({ name, color: PLAYER_COLORS[i] })),
  });
  let snap = await getHostState(ctx, room_code, hostId);
  for (const p of snap.players) await performAction(ctx, room_code, hostId, { type: 'image.request_initial', player_id: p.id });
  await processImageJobs(ctx, { gameId: snap.game.id, maxJobs: 20 });
  if (stage === 'lobby') return room_code;
  await performAction(ctx, room_code, hostId, { type: 'game.start' });
  snap = await getHostState(ctx, room_code, hostId);
  if (stage === 'failedjob') {
    // Escenario de pruebas de UI: una compra cuya edición de imagen falla de forma definitiva.
    const s = await getHostState(ctx, room_code, hostId);
    const item = s.items[0]!;
    const a = await performAction(ctx, room_code, hostId, { type: 'auction.announce', item_id: item.id });
    const id = a.snapshot.auction!.id;
    const player = s.players[0]!;
    await performAction(ctx, room_code, hostId, { type: 'auction.bid', auction_id: id, player_id: player.id, amount_cents: 400, idempotency_key: randomUUID() });
    await performAction(ctx, room_code, hostId, { type: 'auction.award', auction_id: id, expected_winner_id: player.id, expected_price_cents: 400, idempotency_key: randomUUID() });
    const failing = { ...ctx, provider: ctx.provider && { ...ctx.provider, editScene: async () => { throw new ProviderError('Simulado: proveedor no disponible', false); } } };
    await processImageJobs(failing, { gameId: snap.game.id });
    return room_code;
  }
  if (stage === 'midgame' || stage === 'finished') {
    const buys: [number, number][] = [[0, 450], [1, 600], [0, 300], [2, 250]];
    for (const [pi, price] of buys) {
      const s = await getHostState(ctx, room_code, hostId);
      const item = s.items.find((i) => i.status === 'available')!;
      const a = await performAction(ctx, room_code, hostId, { type: 'auction.announce', item_id: item.id });
      const auctionId = a.snapshot.auction!.id;
      const player = s.players[pi]!;
      await performAction(ctx, room_code, hostId, { type: 'auction.bid', auction_id: auctionId, player_id: player.id, amount_cents: price, idempotency_key: randomUUID() });
      await performAction(ctx, room_code, hostId, { type: 'auction.award', auction_id: auctionId, expected_winner_id: player.id, expected_price_cents: price, idempotency_key: randomUUID() });
    }
    await processImageJobs(ctx, { gameId: snap.game.id, maxJobs: 20 });
  }
  if (stage === 'finished') {
    await performAction(ctx, room_code, hostId, { type: 'game.finish' });
    return room_code;
  }
  if (stage === 'midgame' || stage === 'bidding') {
    const s = await getHostState(ctx, room_code, hostId);
    const item = s.items.find((i) => i.status === 'available')!;
    const a = await performAction(ctx, room_code, hostId, { type: 'auction.announce', item_id: item.id });
    if (stage === 'bidding' || stage === 'midgame') {
      const [p1, p2] = [s.players[3]!, s.players[4]!];
      const id = a.snapshot.auction!.id;
      await performAction(ctx, room_code, hostId, { type: 'auction.bid', auction_id: id, player_id: p1.id, amount_cents: 300, idempotency_key: randomUUID() });
      await performAction(ctx, room_code, hostId, { type: 'auction.bid', auction_id: id, player_id: p2.id, amount_cents: 500, idempotency_key: randomUUID() });
    }
  }
  return room_code;
}
