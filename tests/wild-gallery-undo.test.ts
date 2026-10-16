import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { galleryVote, joinGame } from '@/lib/services/play-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, startedGame, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

async function sell(host: string, room: string, playerId: string, price: number, wild?: 'none' | 'blind' | 'double') {
  const s = await getHostState(ctx, room, host);
  const item = s.items.find((i) => i.status === 'available')!;
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id, ...(wild ? { wild_event: wild } : {}) });
  const auctionId = a.snapshot.auction!.id;
  await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerId, amount_cents: price, idempotency_key: key() });
  const r = await act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: playerId, expected_price_cents: price, idempotency_key: key() });
  return { item, r, auctionId };
}

describe('deshacer la última adjudicación', () => {
  it('devuelve el saldo, libera el objeto y retira la compra y su trabajo de imagen', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const ana = playerByName(snap, 'Ana');
    const { item, r } = await sell(host, room, ana.id, 500);
    const purchaseId = r.snapshot.players.find((p) => p.id === ana.id)!.purchases[0]!.purchase_id;
    expect(r.snapshot.players.find((p) => p.id === ana.id)!.balance_cents).toBe(1500);

    const undo = { type: 'auction.undo_award', purchase_id: purchaseId, reason: 'me equivoqué', idempotency_key: key() };
    const out = await act(ctx, room, host, undo);
    const after = out.snapshot;
    expect(playerByName(after, 'Ana')).toMatchObject({ balance_cents: 2000, purchases: [] });
    expect(after.items.find((i) => i.id === item.id)!.status).toBe('available');
    expect(after.stats.purchases_count).toBe(0);
    expect(after.jobs.filter((j) => j.kind === 'edit')).toHaveLength(0);
    expect(after.events.some((e) => e.event_type === 'award_undone')).toBe(true);
    expect(after.game.current_auction_id).toBeNull();

    // Repetir con la misma clave NO devuelve el dinero dos veces
    const again = await act(ctx, room, host, undo);
    expect(playerByName(again.snapshot, 'Ana').balance_cents).toBe(2000);
    // Con otra clave la compra ya no existe
    await expect(act(ctx, room, host, { ...undo, idempotency_key: key() })).rejects.toMatchObject({ code: 'purchase_not_found' });
    // El objeto se puede subastar de nuevo
    await sell(host, room, ana.id, 300);
  });

  it('solo se puede deshacer la última; si la imagen ya se generó, vuelve a la anterior', async () => {
    const host = newHost();
    const { room_code: room } = await createGame(ctx, host, { name: 'Imágenes', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const pre = await getHostState(ctx, room, host);
    await act(ctx, room, host, { type: 'image.request_initial', player_id: playerByName(pre, 'Ana').id });
    await processImageJobs(ctx, { gameId: pre.game.id });
    await act(ctx, room, host, { type: 'game.start' });
    const snap = await getHostState(ctx, room, host);
    const ana = playerByName(snap, 'Ana');
    const beto = playerByName(snap, 'Beto');
    const base = ana.current_image_version_id;

    await sell(host, room, ana.id, 400);
    await sell(host, room, beto.id, 200);
    await processImageJobs(ctx, { gameId: snap.game.id });
    let s = await getHostState(ctx, room, host);
    const first = playerByName(s, 'Ana').purchases[0]!.purchase_id;
    await expect(act(ctx, room, host, { type: 'auction.undo_award', purchase_id: first, idempotency_key: key() })).rejects.toMatchObject({ code: 'not_last_purchase' });

    const last = playerByName(s, 'Beto').purchases[0]!.purchase_id;
    await act(ctx, room, host, { type: 'auction.undo_award', purchase_id: last, idempotency_key: key() });
    // Ahora la de Ana es la última: su imagen editada se retira y vuelve la base
    const out = await act(ctx, room, host, { type: 'auction.undo_award', purchase_id: first, idempotency_key: key() });
    expect(playerByName(out.snapshot, 'Ana').current_image_version_id).toBe(base);
    s = out.snapshot;
    expect(playerByName(s, 'Ana').balance_cents).toBe(2000);
    expect(playerByName(s, 'Beto').balance_cents).toBe(2000);
  });
});

describe('eventos sorpresa', () => {
  it('a ciegas: las vistas públicas no ven importe ni líder; el anfitrión sí; al adjudicar se revela', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const ana = playerByName(snap, 'Ana');
    const s = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, wild_event: 'blind' });
    const id = a.snapshot.auction!.id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: id, player_id: ana.id, amount_cents: 700, idempotency_key: key() });
    const pub = await getPublicState(ctx, room);
    expect(pub.auction).toMatchObject({ wild_event: 'blind', hidden: true, current_bid_cents: 0, current_bidder_id: null, bids: [], bids_count: 1 });
    const hostView = await getHostState(ctx, room, host);
    expect(hostView.auction).toMatchObject({ hidden: false, current_bid_cents: 700, current_bidder_id: ana.id });
    await act(ctx, room, host, { type: 'auction.award', auction_id: id, expected_winner_id: ana.id, expected_price_cents: 700, idempotency_key: key() });
    expect((await getPublicState(ctx, room)).auction).toMatchObject({ hidden: false, final_price_cents: 700 });
  });

  it('doble o mitad: se cobra la mitad o el doble (limitado al saldo) y el saldo cuadra', async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 12 && outcomes.size < 2; i++) {
      const host = newHost();
      const { room, snap } = await startedGame(ctx, host, { budget: 1000 });
      const ana = playerByName(snap, 'Ana');
      const { r } = await sell(host, room, ana.id, 600, 'double');
      const note = r.snapshot.auction!.wild_note!;
      outcomes.add(note.outcome);
      const charged = note.outcome === 'half' ? 300 : 1000; // el doble (1200) se limita al saldo (1000)
      expect(note.charged_cents).toBe(charged);
      const a = playerByName(r.snapshot, 'Ana');
      expect(a.balance_cents).toBe(1000 - charged);
      expect(a.purchases[0]!.price_cents).toBe(charged);
      // Deshacer devuelve exactamente lo cobrado
      const out = await act(ctx, room, host, { type: 'auction.undo_award', purchase_id: a.purchases[0]!.purchase_id, idempotency_key: key() });
      expect(playerByName(out.snapshot, 'Ana').balance_cents).toBe(1000);
    }
    expect(outcomes.size).toBe(2);
  });

  it('probabilidad 100 %: toda subasta sale con evento; "none" fuerza una normal', async () => {
    const host = newHost();
    const { room } = await startedGame(ctx, host);
    await act(ctx, room, host, { type: 'game.set_wild', chance_pct: 100 });
    const s = await getHostState(ctx, room, host);
    expect(s.game.wild_chance_pct).toBe(100);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    expect(['blind', 'double']).toContain(a.snapshot.auction!.wild_event);
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: a.snapshot.auction!.id });
    const b = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, wild_event: 'none' });
    expect(b.snapshot.auction!.wild_event).toBeNull();
  });

  it('impuesto al más rico: paga el 20 % y se reparte; la suma de saldos no cambia; no con subasta abierta', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host, { players: ['Ana', 'Beto', 'Carla'] });
    const ana = playerByName(snap, 'Ana');
    await sell(host, room, playerByName(snap, 'Beto').id, 500); // Beto 1500, resto 2000
    const s0 = await getHostState(ctx, room, host);
    const total = s0.players.reduce((n, p) => n + p.balance_cents, 0);
    const out = await act(ctx, room, host, { type: 'wild.tax', idempotency_key: key() });
    const s = out.snapshot;
    // Pagan Ana y Carla (2000 cada una, empatadas): 400 + 400 = 800; reparto entre 1 receptor (Beto)
    expect(playerByName(s, 'Beto').balance_cents).toBe(1500 + 800);
    expect(s.players.reduce((n, p) => n + p.balance_cents, 0)).toBe(total);
    expect(playerByName(s, 'Ana').balance_cents).toBe(1600);
    expect(s.wild_tax?.payload.share_cents).toBe(800);
    expect(ana.id).toBeDefined();

    // Con una subasta abierta no se permite
    const it = s.items.find((i) => i.status === 'available')!;
    await act(ctx, room, host, { type: 'auction.announce', item_id: it.id });
    await expect(act(ctx, room, host, { type: 'wild.tax', idempotency_key: key() })).rejects.toMatchObject({ code: 'auction_in_progress' });
  });

  it('la clave de idempotencia evita cobrar el impuesto dos veces', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    await sell(host, room, playerByName(snap, 'Ana').id, 500);
    const k = key();
    await act(ctx, room, host, { type: 'wild.tax', idempotency_key: k });
    const a = await getHostState(ctx, room, host);
    await act(ctx, room, host, { type: 'wild.tax', idempotency_key: k });
    const b = await getHostState(ctx, room, host);
    expect(b.players.map((p) => p.balance_cents)).toEqual(a.players.map((p) => p.balance_cents));
  });
});

describe('galería final con votación', () => {
  it('abre al terminar, un voto por jugador (cambiable), no a uno mismo; resultado oculto hasta cerrar', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Galería', play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] });
    let s = await getHostState(ctx, room_code, host);
    const [ana, beto, carla] = ['Ana', 'Beto', 'Carla'].map((n) => playerByName(s, n));
    const ta = (await joinGame(ctx, room_code, { player_id: ana!.id })).token;
    const tb = (await joinGame(ctx, room_code, { player_id: beto!.id })).token;
    await joinGame(ctx, room_code, { player_id: carla!.id }); // conectada pero sin votar: la votación no se cierra sola
    await act(ctx, room_code, host, { type: 'game.start' });

    await expect(galleryVote(ctx, room_code, ta, { target_id: beto!.id })).rejects.toMatchObject({ code: 'gallery_not_open' });
    await act(ctx, room_code, host, { type: 'game.finish' });
    expect((await getPublicState(ctx, room_code)).gallery).toMatchObject({ enabled: true, open: true, closed: false, results: null });

    await expect(galleryVote(ctx, room_code, ta, { target_id: ana!.id })).rejects.toMatchObject({ code: 'cannot_vote_self' });
    await expect(galleryVote(ctx, room_code, 'x'.repeat(30), { target_id: beto!.id })).rejects.toMatchObject({ code: 'not_player' });
    await galleryVote(ctx, room_code, ta, { target_id: beto!.id });
    await galleryVote(ctx, room_code, ta, { target_id: carla!.id }); // cambia su voto
    await galleryVote(ctx, room_code, tb, { target_id: carla!.id });

    const pub = await getPublicState(ctx, room_code);
    expect(pub.gallery!.voters.sort()).toEqual([ana!.id, beto!.id].sort());
    expect(pub.gallery!.results).toBeNull(); // el recuento no se filtra mientras está abierta
    s = await getHostState(ctx, room_code, host);
    expect(s.gallery!.results![0]).toEqual({ player_id: carla!.id, votes: 2 });

    await act(ctx, room_code, host, { type: 'gallery.close' });
    const closed = await getPublicState(ctx, room_code);
    expect(closed.gallery).toMatchObject({ closed: true, open: false });
    expect(closed.gallery!.results![0]).toEqual({ player_id: carla!.id, votes: 2 });
    await expect(galleryVote(ctx, room_code, ta, { target_id: beto!.id })).rejects.toMatchObject({ code: 'gallery_closed' });
  });
});

describe('galería: cierre automático y podio', () => {
  async function mobileFinished(names: string[]) {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Podio', play_mode: 'mobile', players: names.map((name) => ({ name })) });
    const s = await getHostState(ctx, room_code, host);
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};
    for (const n of names) {
      const pl = playerByName(s, n)!;
      ids[n] = pl.id;
      tokens[n] = (await joinGame(ctx, room_code, { player_id: pl.id })).token;
    }
    await act(ctx, room_code, host, { type: 'game.start' });
    await act(ctx, room_code, host, { type: 'game.finish' });
    return { host, room_code, tokens, ids };
  }

  it('se cierra sola cuando han votado todos los conectados y el recuento queda público para el podio', async () => {
    const { room_code, tokens, ids } = await mobileFinished(['Ana', 'Beto', 'Carla']);
    await galleryVote(ctx, room_code, tokens.Ana!, { target_id: ids.Carla! });
    await galleryVote(ctx, room_code, tokens.Beto!, { target_id: ids.Carla! });
    let pub = await getPublicState(ctx, room_code);
    expect(pub.gallery).toMatchObject({ open: true, closed: false, results: null }); // faltan votos: sigue abierta y sin recuento público
    await galleryVote(ctx, room_code, tokens.Carla!, { target_id: ids.Ana! });
    pub = await getPublicState(ctx, room_code);
    expect(pub.gallery).toMatchObject({ open: false, closed: true });
    expect(pub.gallery!.results).toEqual([{ player_id: ids.Carla, votes: 2 }, { player_id: ids.Ana, votes: 1 }, { player_id: ids.Beto, votes: 0 }]);
    await expect(galleryVote(ctx, room_code, tokens.Ana!, { target_id: ids.Beto! })).rejects.toMatchObject({ code: 'gallery_closed' });
  });

  it('con un solo jugador conectado no se cierra sola (hace falta que el anfitrión la cierre)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Solo', play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const s = await getHostState(ctx, room_code, host);
    const ta = (await joinGame(ctx, room_code, { player_id: playerByName(s, 'Ana')!.id })).token;
    await act(ctx, room_code, host, { type: 'game.start' });
    await act(ctx, room_code, host, { type: 'game.finish' });
    await galleryVote(ctx, room_code, ta, { target_id: playerByName(s, 'Beto')!.id });
    expect((await getPublicState(ctx, room_code)).gallery).toMatchObject({ open: true, closed: false });
  });

  it('los empates: ambos aparecen con los mismos votos en el recuento', async () => {
    const { room_code, tokens, ids } = await mobileFinished(['Ana', 'Beto', 'Carla', 'Dani']);
    await galleryVote(ctx, room_code, tokens.Ana!, { target_id: ids.Beto! });
    await galleryVote(ctx, room_code, tokens.Beto!, { target_id: ids.Ana! });
    await galleryVote(ctx, room_code, tokens.Carla!, { target_id: ids.Beto! });
    await galleryVote(ctx, room_code, tokens.Dani!, { target_id: ids.Ana! });
    const pub = await getPublicState(ctx, room_code);
    expect(pub.gallery!.closed).toBe(true);
    expect(pub.gallery!.results!.slice(0, 2).map((r) => r.votes)).toEqual([2, 2]);
    expect(pub.gallery!.results!.slice(2).map((r) => r.votes)).toEqual([0, 0]);
  });
});
