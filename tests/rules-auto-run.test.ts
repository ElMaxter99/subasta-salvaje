import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoAwardTick, createGame, getHostState } from '@/lib/services/game-service';
import { playerBid, joinGame } from '@/lib/services/play-service';
import { act, ensureInitialImages, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

async function lobby(host: string, extra: Record<string, unknown> = {}) {
  const { room_code } = await createGame(ctx, host, { name: 'Reglas', players: [{ name: 'Ana' }, { name: 'Beto' }], items: [1, 2, 3, 4].map((n) => ({ name: `Elemento ${n}`, description: '' })), ...extra });
  return room_code;
}
const back = (gameId: string, sql: string) => ctx.db.pg.query(sql, [gameId]);

async function sell(room: string, host: string, player: string, cents = 100) {
  const s = await getHostState(ctx, room, host);
  const item = s.items.find((i) => i.status === 'available')!;
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id });
  const pid = playerByName(s, player).id;
  await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: cents, idempotency_key: key() });
  return act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: cents, idempotency_key: key() });
}

describe('máximo de rondas', () => {
  it('por defecto es el tamaño del catálogo y el progreso de la TV (total_rounds) lo refleja', async () => {
    const host = newHost();
    const room = await lobby(host);
    const s = await getHostState(ctx, room, host);
    expect(s.game.max_rounds).toBe(4);
    expect(s.game.total_rounds).toBe(4);
    const room2 = await lobby(host, { max_rounds: 2 });
    expect((await getHostState(ctx, room2, host)).game).toMatchObject({ max_rounds: 2, total_rounds: 2 });
  });

  it('al agotarse las rondas, anunciar termina la partida (sí o sí) y no se puede bajar el máximo por debajo de lo jugado', async () => {
    const host = newHost();
    const room = await lobby(host, { max_rounds: 2 });
    await act(ctx, room, host, { type: 'game.start' });
    await sell(room, host, 'Ana');
    await sell(room, host, 'Beto');
    await expect(act(ctx, room, host, { type: 'game.set_rules', max_rounds: 1 })).rejects.toMatchObject({ code: 'rounds_below_played' });
    const s = await getHostState(ctx, room, host);
    const next = s.items.find((i) => i.status === 'available')!;
    const out = await act(ctx, room, host, { type: 'auction.announce', item_id: next.id });
    expect(out.result).toMatchObject({ finished: true, reason: 'rounds_completed' });
    expect(out.snapshot.game.status).toBe('finished');
    expect(out.snapshot.stats.purchases_count).toBe(2);
  });

  it('el avance automático termina la partida tras una pausa para ver la última adjudicación, aunque el anfitrión no haga nada', async () => {
    const host = newHost();
    const room = await lobby(host, { max_rounds: 1 });
    await act(ctx, room, host, { type: 'game.start' });
    await sell(room, host, 'Ana');
    const gid = (await getHostState(ctx, room, host)).game.id;
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).game.status).toBe('active'); // aún se está viendo el «¡Adjudicado!»
    await back(gid, "update auctions set closed_at = now() - interval '20 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).game.status).toBe('finished');
  });
});

describe('pujas solo en euros enteros', () => {
  it('por defecto se rechazan 1,50 €; con la opción desactivada se admiten (anfitrión y móvil)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Enteras', play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    expect((await getHostState(ctx, room_code, host)).game.integer_bids).toBe(true);
    const s0 = await getHostState(ctx, room_code, host);
    const tok = (await joinGame(ctx, room_code, { player_id: playerByName(s0, 'Ana').id })).token;
    await act(ctx, room_code, host, { type: 'game.start' });
    const s = await getHostState(ctx, room_code, host);
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    const auction = a.snapshot.auction!.id;
    await expect(act(ctx, room_code, host, { type: 'auction.bid', auction_id: auction, player_id: playerByName(s, 'Beto').id, amount_cents: 150, idempotency_key: key() })).rejects.toMatchObject({ code: 'bid_not_whole' });
    await expect(playerBid(ctx, room_code, tok, { auction_id: auction, amount_cents: 250, idempotency_key: key() })).rejects.toMatchObject({ code: 'bid_not_whole' });
    await playerBid(ctx, room_code, tok, { auction_id: auction, amount_cents: 300, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'game.set_rules', integer_bids: false });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: auction, player_id: playerByName(s, 'Beto').id, amount_cents: 350, idempotency_key: key() });
    expect((await getHostState(ctx, room_code, host)).auction!.current_bid_cents).toBe(350);
  });

  it('«doble o mitad» con pujas enteras cobra la mitad redondeada a euros', async () => {
    for (let i = 0; i < 20; i++) {
      const host = newHost();
      const room = await lobby(host);
      await act(ctx, room, host, { type: 'game.start' });
      const s = await getHostState(ctx, room, host);
      const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, wild_event: 'double' });
      const pid = playerByName(s, 'Ana').id;
      await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 300, idempotency_key: key() });
      const r = await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 300, idempotency_key: key() });
      const charged = r.snapshot.auction!.wild_note!.charged_cents;
      expect(charged % 100).toBe(0);
      if (r.snapshot.auction!.wild_note!.outcome === 'half') {
        expect(charged).toBe(100); // 3 € / 2 = 1,50 € → 1 €
        return;
      }
    }
    throw new Error('no salió «mitad» en 20 intentos');
  });
});

describe('imagen inicial obligatoria para empezar', () => {
  it('sin imagen inicial no se puede empezar; con ella sí; un jugador nuevo sin imagen vuelve a bloquear', async () => {
    const host = newHost();
    const room = await lobby(host);
    await expect(act({ ...ctx } as TestCtx, room, host, { type: 'game.start' }).then(() => null)).resolves.toBeNull(); // el helper `act` pone imagen…
    const room2 = await lobby(host);
    const { performAction } = await import('@/lib/services/game-service');
    await expect(performAction(ctx, room2, host, { type: 'game.start' })).rejects.toMatchObject({ code: 'initial_image_required' }); // …pero el servicio no
    await performAction(ctx, room2, host, { type: 'image.set_initial_all', catalog_id: 'house' });
    await performAction(ctx, room2, host, { type: 'player.add', name: 'Carla' });
    await expect(performAction(ctx, room2, host, { type: 'game.start' })).rejects.toMatchObject({ code: 'initial_image_required' });
    await ensureInitialImages(ctx, room2, host);
    await performAction(ctx, room2, host, { type: 'game.start' });
    expect((await getHostState(ctx, room2, host)).game.status).toBe('active');
  });
});

describe('subasta automática', () => {
  const settings = (gap = 3, idle = 10, award?: number) => ({ type: 'game.set_auto_run', enabled: true, gap_seconds: gap, idle_seconds: idle, ...(award ? { auto_award_seconds: award } : {}) });

  it('activarla enciende la adjudicación automática con el último tiempo elegido (20 s de serie) o el indicado', async () => {
    const host = newHost();
    const room = await lobby(host);
    await act(ctx, room, host, { type: 'game.start' });
    expect((await act(ctx, room, host, settings())).snapshot.game).toMatchObject({ auto_run_enabled: true, auto_award_enabled: true, auto_award_seconds: 20 });
    await act(ctx, room, host, { type: 'game.set_auto_award', enabled: false, seconds: 45 });
    await act(ctx, room, host, { type: 'game.set_auto_run', enabled: false, gap_seconds: 3, idle_seconds: 10 });
    expect((await act(ctx, room, host, settings())).snapshot.game).toMatchObject({ auto_award_enabled: true, auto_award_seconds: 45 }); // la última seleccionada
    expect((await act(ctx, room, host, settings(3, 10, 30))).snapshot.game.auto_award_seconds).toBe(30);
    await expect(act(ctx, room, host, { ...settings(), gap_seconds: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('anuncia por orden tras la pausa, adjudica sola y al llegar al máximo de rondas termina la partida', async () => {
    const host = newHost();
    const room = await lobby(host, { max_rounds: 2 });
    await act(ctx, room, host, { type: 'game.start' });
    const gid = (await getHostState(ctx, room, host)).game.id;
    await act(ctx, room, host, settings(5, 60, 5));
    await autoAwardTick(ctx, room);
    let s = await getHostState(ctx, room, host);
    expect(s.auction).toBeNull(); // todavía dentro de la pausa
    expect(s.game.auto_run_next_at).toBeTruthy();

    await back(gid, "update games set auto_run_since = now() - interval '10 seconds' where id = $1");
    await autoAwardTick(ctx, room);
    s = await getHostState(ctx, room, host);
    expect(s.auction?.item.name).toBe('Elemento 1'); // en orden
    const ana = playerByName(s, 'Ana').id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: s.auction!.id, player_id: ana, amount_cents: 200, idempotency_key: key() });
    await back(gid, "update bids set created_at = now() - interval '30 seconds' where auction_id in (select id from auctions where game_id = $1)");
    await autoAwardTick(ctx, room); // adjudica por tiempo
    s = await getHostState(ctx, room, host);
    expect(s.stats.purchases_count).toBe(1);

    // pausa hasta la siguiente
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).auction?.status).toBe('awarded');
    await back(gid, "update auctions set closed_at = now() - interval '10 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    s = await getHostState(ctx, room, host);
    expect(s.auction?.item.name).toBe('Elemento 2');
    await act(ctx, room, host, { type: 'auction.bid', auction_id: s.auction!.id, player_id: ana, amount_cents: 100, idempotency_key: key() });
    await back(gid, "update bids set created_at = now() - interval '30 seconds' where auction_id = (select id from auctions where game_id = $1 and status = 'open')");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).stats.purchases_count).toBe(2);
    await back(gid, "update auctions set closed_at = now() - interval '30 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).game.status).toBe('finished'); // máximo de rondas
  });

  it('una subasta sin pujas deja el elemento PERDIDO (no vuelve a salir); si se pierden todos, la partida termina sola', async () => {
    const host = newHost();
    const room = await lobby(host);
    await act(ctx, room, host, { type: 'game.start' });
    const gid = (await getHostState(ctx, room, host)).game.id;
    await act(ctx, room, host, settings(3, 10));
    await back(gid, "update games set auto_run_since = now() - interval '10 seconds' where id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).auction?.item.name).toBe('Elemento 1');
    await back(gid, "update auctions set opened_at = now() - interval '20 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    let s = await getHostState(ctx, room, host);
    expect(s.auction).toBeNull(); // la subasta sin pujas se cancela y se sigue
    expect(s.items.find((i) => i.name === 'Elemento 1')!.status).toBe('lost'); // perdido: nadie lo quiso
    expect(s.events.some((e) => e.event_type === 'auction_unsold')).toBe(true);
    expect(s.last_unsold).toMatchObject({ item_name: 'Elemento 1' }); // la TV anima «¡Nadie lo quiere!»
    expect(s.game.auto_run_enabled).toBe(true);
    // El siguiente anuncio ya no es el perdido
    await back(gid, "update auctions set closed_at = now() - interval '10 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).auction?.item.name).toBe('Elemento 2');
    // Se pierden también los demás (3 más) y, sin elementos disponibles, la partida termina
    for (let i = 0; i < 3; i++) {
      await back(gid, "update auctions set opened_at = now() - interval '20 seconds' where game_id = $1 and status = 'open'");
      await autoAwardTick(ctx, room);
      await back(gid, "update auctions set closed_at = now() - interval '10 seconds' where game_id = $1");
      await autoAwardTick(ctx, room);
    }
    s = await getHostState(ctx, room, host);
    expect(s.items.every((i) => i.status === 'lost')).toBe(true);
    expect(s.game.status).toBe('finished');
  });

  it('cancelar a mano: sin pujas el elemento queda perdido; con pujas vuelve al catálogo', async () => {
    const host = newHost();
    const room = await lobby(host);
    await act(ctx, room, host, { type: 'game.start' });
    const s0 = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s0.items[0]!.id });
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: a.snapshot.auction!.id });
    expect((await getHostState(ctx, room, host)).items.find((i) => i.id === s0.items[0]!.id)!.status).toBe('lost');
    await expect(act(ctx, room, host, { type: 'auction.announce', item_id: s0.items[0]!.id })).rejects.toMatchObject({ code: 'item_not_available' });
    const b = await act(ctx, room, host, { type: 'auction.announce', item_id: s0.items[1]!.id });
    const pid = s0.players[0]!.id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: b.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: b.snapshot.auction!.id });
    expect((await getHostState(ctx, room, host)).items.find((i) => i.id === s0.items[1]!.id)!.status).toBe('available');
  });

  it('anunciar al azar elige un elemento disponible (nunca uno perdido o vendido) y no hay rondas por encima del catálogo', async () => {
    const host = newHost();
    const room = await lobby(host);
    await act(ctx, room, host, { type: 'game.start' });
    const s0 = await getHostState(ctx, room, host);
    // Pierde 3 de los 4 elementos: el único disponible es el que debe salir
    for (const it of s0.items.slice(0, 3)) {
      const a = await act(ctx, room, host, { type: 'auction.announce', item_id: it.id });
      await act(ctx, room, host, { type: 'auction.cancel', auction_id: a.snapshot.auction!.id });
    }
    const r = await act(ctx, room, host, { type: 'auction.announce_random' });
    expect(r.snapshot.auction!.item.id).toBe(s0.items[3]!.id);
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: r.snapshot.auction!.id });
    await expect(act(ctx, room, host, { type: 'auction.announce_random' })).rejects.toMatchObject({ code: 'no_items_left' });
    // Rondas máximas: entre 1 y el número de elementos del catálogo
    await expect(act(ctx, room, host, { type: 'game.set_rules', max_rounds: 5 })).rejects.toMatchObject({ code: 'rounds_above_catalog' });
    await act(ctx, room, host, { type: 'game.set_rules', max_rounds: 4 });
  });

  it('sin elementos disponibles termina la partida; en pausa no avanza; desactivarla la detiene', async () => {
    const host = newHost();
    const room = await lobby(host, { items: [{ name: 'Único', description: '' }] });
    await act(ctx, room, host, { type: 'game.start' });
    const gid = (await getHostState(ctx, room, host)).game.id;
    await act(ctx, room, host, settings());
    await act(ctx, room, host, { type: 'game.pause' });
    await back(gid, "update games set auto_run_since = now() - interval '1 minute' where id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).auction).toBeNull(); // en pausa no anuncia
    await act(ctx, room, host, { type: 'game.resume' });
    await act(ctx, room, host, { type: 'game.set_auto_run', enabled: false, gap_seconds: 3, idle_seconds: 10 });
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).auction).toBeNull(); // desactivada
    await act(ctx, room, host, settings());
    await back(gid, "update games set auto_run_since = now() - interval '1 minute' where id = $1");
    await autoAwardTick(ctx, room);
    const s = await getHostState(ctx, room, host);
    expect(s.auction?.item.name).toBe('Único');
  });
});
