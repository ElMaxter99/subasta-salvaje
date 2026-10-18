import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoAwardTick, createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, playerBid } from '@/lib/services/play-service';
import { computeTeams } from '@/lib/domain/ranking';
import type { Player } from '@/lib/domain/types';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

const q = (sql: string, params: unknown[] = []) => ctx.db.pg.query(sql, params);

async function lobby(host: string, extra: Record<string, unknown> = {}) {
  const { room_code } = await createGame(ctx, host, {
    name: 'Extra',
    players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }],
    items: [1, 2, 3, 4].map((n) => ({ name: `Elemento ${n}`, description: '' })),
    ...extra,
  });
  return room_code;
}
async function started(host: string, extra: Record<string, unknown> = {}) {
  const room = await lobby(host, extra);
  await act(ctx, room, host, { type: 'game.start' });
  return room;
}
async function announce(room: string, host: string, wild?: string) {
  const s = await getHostState(ctx, room, host);
  const item = s.items.find((i) => i.status === 'available')!;
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id, ...(wild ? { wild_event: wild } : {}) });
  return { id: a.snapshot.auction!.id, snap: a.snapshot, item };
}
async function bid(room: string, host: string, auction: string, player: string, cents: number, k = key()) {
  const s = await getHostState(ctx, room, host);
  return act(ctx, room, host, { type: 'auction.bid', auction_id: auction, player_id: playerByName(s, player).id, amount_cents: cents, idempotency_key: k });
}
const award = async (room: string, host: string, auction: string, player: string, cents: number, k = key()) => {
  const s = await getHostState(ctx, room, host);
  return act(ctx, room, host, { type: 'auction.award', auction_id: auction, expected_winner_id: playerByName(s, player).id, expected_price_cents: cents, idempotency_key: k });
};
/** Retrasa las pujas y la apertura de la subasta para simular que pasó el tiempo. */
const age = async (auction: string, seconds: number) => {
  await q(`update bids set created_at = created_at - make_interval(secs => $2) where auction_id = $1`, [auction, seconds]);
  await q(`update auctions set opened_at = opened_at - make_interval(secs => $2) where id = $1`, [auction, seconds]);
};

describe('evento relámpago (flash)', () => {
  it('se adjudica sola a los 8 s de la última puja aunque la adjudicación automática esté apagada, y cobra una sola vez', async () => {
    const host = newHost();
    const room = await started(host);
    expect((await getHostState(ctx, room, host)).game.auto_award_enabled).toBe(false);
    const a = await announce(room, host, 'flash');
    expect(a.snap.auction).toMatchObject({ wild_event: 'flash', auto_award_at: null });
    const row = await q(`select auto_seconds_override from auctions where id = $1`, [a.id]);
    expect((row.rows[0] as { auto_seconds_override: number }).auto_seconds_override).toBe(8);

    const b = await bid(room, host, a.id, 'Ana', 500);
    expect(b.snapshot.auction).toMatchObject({ flash_seconds: 8 });
    expect(b.snapshot.auction!.auto_award_at).toBeTruthy(); // la TV/móvil/panel muestran la cuenta atrás
    expect(await autoAwardTick(ctx, room)).toBe(false); // aún no vence
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('open');

    await age(a.id, 20);
    expect(await autoAwardTick(ctx, room)).toBe(true);
    expect(await autoAwardTick(ctx, room)).toBe(false); // segundo tick: nada que hacer
    const s = await getHostState(ctx, room, host);
    expect(s.auction).toMatchObject({ status: 'awarded', final_price_cents: 500 });
    expect(playerByName(s, 'Ana').balance_cents).toBe(1500); // cobrado UNA vez
    expect(s.stats.purchases_count).toBe(1);
    // El anfitrión pulsando «Adjudicar» después no vuelve a cobrar.
    await award(room, host, a.id, 'Ana', 500);
    const after = await getHostState(ctx, room, host);
    expect(playerByName(after, 'Ana').balance_cents).toBe(1500);
    expect(after.stats.purchases_count).toBe(1);
  });

  it('cada puja reinicia los 8 s', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'flash');
    await bid(room, host, a.id, 'Ana', 100);
    await age(a.id, 20);
    await bid(room, host, a.id, 'Beto', 200); // puja nueva y reciente
    expect(await autoAwardTick(ctx, room)).toBe(false);
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('open');
  });

  it('prevalece sobre el tiempo de la adjudicación automática de la partida', async () => {
    const host = newHost();
    const room = await started(host);
    await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 120 });
    const a = await announce(room, host, 'flash');
    await bid(room, host, a.id, 'Ana', 300);
    await age(a.id, 10); // 10 s > 8 s pero < 120 s
    expect(await autoAwardTick(ctx, room)).toBe(true);
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('awarded');
  });

  it('sin pujas no se adjudica: sigue la regla normal (el anfitrión cancela y el elemento queda perdido)', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'flash');
    await age(a.id, 60);
    expect(await autoAwardTick(ctx, room)).toBe(false);
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('open');
    const out = await act(ctx, room, host, { type: 'auction.cancel', auction_id: a.id });
    expect(out.snapshot.items.find((i) => i.id === a.item.id)!.status).toBe('lost');
    expect(out.snapshot.stats.purchases_count).toBe(0);
  });

  it('no actúa con la puja cerrada ni en pausa', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'flash');
    await bid(room, host, a.id, 'Ana', 100);
    await age(a.id, 20);
    await act(ctx, room, host, { type: 'game.pause' });
    expect(await autoAwardTick(ctx, room)).toBe(false);
    await act(ctx, room, host, { type: 'game.resume' });
    await act(ctx, room, host, { type: 'auction.close', auction_id: a.id });
    expect(await autoAwardTick(ctx, room)).toBe(false);
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('closed');
  });

  it('con la subasta automática activa convive: el relámpago se adjudica y la automática sigue con el siguiente', async () => {
    const host = newHost();
    const room = await started(host);
    await act(ctx, room, host, { type: 'game.set_auto_run', enabled: true, gap_seconds: 3, idle_seconds: 10 });
    // La automática anuncia sola el primero (normal)… pero si el anfitrión anuncia uno relámpago a mano, se resuelve igual.
    const s0 = await getHostState(ctx, room, host);
    if (s0.auction && s0.auction.status === 'open') await act(ctx, room, host, { type: 'auction.cancel', auction_id: s0.auction.id });
    const a = await announce(room, host, 'flash');
    await bid(room, host, a.id, 'Carla', 400);
    await age(a.id, 30);
    expect(await autoAwardTick(ctx, room)).toBe(true);
    const s = await getHostState(ctx, room, host);
    expect(playerByName(s, 'Carla').balance_cents).toBe(1600);
    expect(s.stats.purchases_count).toBe(1);
  });

  it('un evento desconocido sigue rechazándose', async () => {
    const host = newHost();
    const room = await started(host);
    const s = await getHostState(ctx, room, host);
    await expect(act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, wild_event: 'robo' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('sobre cerrado (sealed)', () => {
  it('oculta importes y líder al público, enseña quién ya pujó, y solo permite una puja por jugador', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'sealed');
    expect(a.snap.auction).toMatchObject({ wild_event: 'sealed' });

    await bid(room, host, a.id, 'Ana', 500);
    const pub = await getPublicState(ctx, room);
    const ana = playerByName(await getHostState(ctx, room, host), 'Ana');
    expect(pub.auction).toMatchObject({ wild_event: 'sealed', hidden: true, current_bid_cents: 0, current_bidder_id: null, bids: [], bids_count: 1, sealed_bidders: [ana.id], auto_award_at: null });
    expect(JSON.stringify(pub)).not.toContain('"amount_cents":500'); // ni siquiera en las pujas
    const host1 = await getHostState(ctx, room, host);
    expect(host1.auction).toMatchObject({ hidden: false, current_bid_cents: 500, current_bidder_id: ana.id }); // el anfitrión lo ve todo

    // Una puja MENOR de otro jugador se acepta (no da pistas)
    await bid(room, host, a.id, 'Beto', 300);
    // Segunda puja del mismo jugador, mayor o menor: rechazada
    await expect(bid(room, host, a.id, 'Ana', 900)).rejects.toMatchObject({ code: 'sealed_already_bid' });
    await expect(bid(room, host, a.id, 'Beto', 100)).rejects.toMatchObject({ code: 'sealed_already_bid' });
    const s = await getHostState(ctx, room, host);
    expect(s.auction).toMatchObject({ current_bid_cents: 500 });
    expect(s.auction!.bids).toHaveLength(2);
    expect((await getPublicState(ctx, room)).auction!.sealed_bidders).toHaveLength(2);
  });

  it('gana la puja más alta aunque no sea la última; el cobro es único y se revela al adjudicar', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'sealed');
    await bid(room, host, a.id, 'Ana', 800);
    await bid(room, host, a.id, 'Beto', 300);
    await bid(room, host, a.id, 'Carla', 500);
    await act(ctx, room, host, { type: 'auction.close', auction_id: a.id });
    await expect(bid(room, host, a.id, 'Beto', 100)).rejects.toMatchObject({ code: 'auction_closed' });
    const k = key();
    await award(room, host, a.id, 'Ana', 800, k);
    await award(room, host, a.id, 'Ana', 800, k); // misma clave
    await award(room, host, a.id, 'Ana', 800); // otra clave: reintento
    const s = await getHostState(ctx, room, host);
    expect(playerByName(s, 'Ana').balance_cents).toBe(1200);
    expect(playerByName(s, 'Beto').balance_cents).toBe(2000);
    expect(playerByName(s, 'Carla').balance_cents).toBe(2000);
    expect(s.stats.purchases_count).toBe(1);
    const pub = await getPublicState(ctx, room);
    expect(pub.auction).toMatchObject({ status: 'awarded', hidden: false, final_price_cents: 800 });
    expect(pub.auction!.bids).toHaveLength(3); // ya revelado
  });

  it('en empate gana la primera puja', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'sealed');
    await bid(room, host, a.id, 'Carla', 400);
    await bid(room, host, a.id, 'Ana', 400);
    await bid(room, host, a.id, 'Beto', 400);
    const s = await getHostState(ctx, room, host);
    expect(s.auction!.current_bidder_id).toBe(playerByName(s, 'Carla').id);
    await expect(award(room, host, a.id, 'Ana', 400)).rejects.toMatchObject({ code: 'stale_state' });
    await award(room, host, a.id, 'Carla', 400);
    expect(playerByName(await getHostState(ctx, room, host), 'Carla').balance_cents).toBe(1600);
  });

  it('nunca se adjudica sola (ni por tiempo ni por «nadie puede superarla») aunque la automática esté activa', async () => {
    const host = newHost();
    const room = await started(host, { initial_budget_cents: 1000 });
    await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 3 });
    const a = await announce(room, host, 'sealed');
    // Ana puja todo su saldo: nadie más podría superarla, pero en sobre cerrado NO se adjudica al instante.
    const out = await bid(room, host, a.id, 'Ana', 1000);
    expect(out.result).not.toHaveProperty('auto_awarded');
    await age(a.id, 120);
    expect(await autoAwardTick(ctx, room)).toBe(false);
    const s = await getHostState(ctx, room, host);
    expect(s.auction!.status).toBe('open');
    expect(s.stats.purchases_count).toBe(0);
    expect(playerByName(s, 'Ana').balance_cents).toBe(1000);
  });

  it('respeta saldo, puja mínima y pujas enteras', async () => {
    const host = newHost();
    const room = await started(host, { min_bid_cents: 200 });
    const a = await announce(room, host, 'sealed');
    await expect(bid(room, host, a.id, 'Ana', 100)).rejects.toMatchObject({ code: 'bid_below_minimum' });
    await expect(bid(room, host, a.id, 'Ana', 250)).rejects.toMatchObject({ code: 'bid_not_whole' });
    await expect(bid(room, host, a.id, 'Ana', 5000)).rejects.toMatchObject({ code: 'insufficient_balance' });
    await bid(room, host, a.id, 'Ana', 200); // sigue sin haber pujado: los rechazos no cuentan
  });

  it('si el anfitrión anula la puja de un jugador, puede volver a pujar', async () => {
    const host = newHost();
    const room = await started(host);
    const a = await announce(room, host, 'sealed');
    const first = await bid(room, host, a.id, 'Ana', 600);
    const bidId = first.snapshot.auction!.bids[0]!.id;
    await act(ctx, room, host, { type: 'auction.undo_bid', auction_id: a.id, bid_id: bidId });
    expect((await getHostState(ctx, room, host)).auction).toMatchObject({ current_bid_cents: 0, current_bidder_id: null });
    await bid(room, host, a.id, 'Ana', 700);
    expect((await getHostState(ctx, room, host)).auction!.current_bid_cents).toBe(700);
  });

  it('desde el móvil: una sola puja por jugador; el reintento con la misma clave no falla ni duplica', async () => {
    const host = newHost();
    const { room_code: room } = await createGame(ctx, host, { name: 'Sobre móvil', play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }], items: [{ name: 'X', description: '' }, { name: 'Y', description: '' }] });
    const s0 = await getHostState(ctx, room, host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(s0, 'Ana').id });
    const beto = await joinGame(ctx, room, { player_id: playerByName(s0, 'Beto').id });
    await act(ctx, room, host, { type: 'game.start' });
    const a = await announce(room, host, 'sealed');
    const k = key();
    const r1 = await playerBid(ctx, room, ana.token, { auction_id: a.id, amount_cents: 500, idempotency_key: k });
    expect(r1.auction).toMatchObject({ hidden: true, current_bid_cents: 0 });
    await playerBid(ctx, room, ana.token, { auction_id: a.id, amount_cents: 500, idempotency_key: k }); // reintento idéntico
    await expect(playerBid(ctx, room, ana.token, { auction_id: a.id, amount_cents: 600, idempotency_key: key() })).rejects.toMatchObject({ code: 'sealed_already_bid' });
    // Beto puja menos y NO recibe «bid_too_low» ni pista alguna
    await playerBid(ctx, room, beto.token, { auction_id: a.id, amount_cents: 100, idempotency_key: key() });
    const s = await getHostState(ctx, room, host);
    expect(s.auction!.bids).toHaveLength(2);
    expect(s.auction).toMatchObject({ current_bid_cents: 500 });
  });
});

describe('presupuesto individual', () => {
  it('fija el saldo de UN jugador en la sala de espera y «Reiniciar partida» lo restaura', async () => {
    const host = newHost();
    const room = await lobby(host);
    const s0 = await getHostState(ctx, room, host);
    const out = await act(ctx, room, host, { type: 'player.set_budget', player_id: playerByName(s0, 'Ana').id, budget_cents: 5000 });
    expect(playerByName(out.snapshot, 'Ana')).toMatchObject({ balance_cents: 5000, initial_balance_cents: 5000 });
    expect(playerByName(out.snapshot, 'Beto')).toMatchObject({ balance_cents: 2000, initial_balance_cents: 2000 });
    await act(ctx, room, host, { type: 'player.set_budget', player_id: playerByName(s0, 'Carla').id, budget_cents: 0 });

    await act(ctx, room, host, { type: 'game.start' });
    const a = await announce(room, host);
    await bid(room, host, a.id, 'Ana', 3000);
    await award(room, host, a.id, 'Ana', 3000);
    expect(playerByName(await getHostState(ctx, room, host), 'Ana').balance_cents).toBe(2000);

    const r = await act(ctx, room, host, { type: 'game.reset' });
    expect(r.snapshot.game.status).toBe('lobby');
    expect(playerByName(r.snapshot, 'Ana').balance_cents).toBe(5000);
    expect(playerByName(r.snapshot, 'Beto').balance_cents).toBe(2000);
    expect(playerByName(r.snapshot, 'Carla').balance_cents).toBe(0);
    expect(r.snapshot.stats.purchases_count).toBe(0);
  });

  it('solo antes de empezar y con valores válidos', async () => {
    const host = newHost();
    const room = await lobby(host);
    const id = playerByName(await getHostState(ctx, room, host), 'Ana').id;
    for (const bad of [-1, 100_000_001, 12.5, '100']) {
      await expect(act(ctx, room, host, { type: 'player.set_budget', player_id: id, budget_cents: bad })).rejects.toMatchObject({ code: 'invalid_input' });
    }
    await act(ctx, room, host, { type: 'player.set_budget', player_id: id, budget_cents: 100_000_000 }); // el máximo vale
    await expect(act(ctx, room, host, { type: 'player.set_budget', player_id: '00000000-0000-4000-8000-000000000000', budget_cents: 100 })).rejects.toMatchObject({ code: 'player_not_found' });
    await act(ctx, room, host, { type: 'game.start' });
    await expect(act(ctx, room, host, { type: 'player.set_budget', player_id: id, budget_cents: 100 })).rejects.toMatchObject({ code: 'game_already_started' });
  });

  it('solo el anfitrión de la partida puede hacerlo', async () => {
    const host = newHost();
    const room = await lobby(host);
    const id = playerByName(await getHostState(ctx, room, host), 'Ana').id;
    await expect(act(ctx, room, newHost(), { type: 'player.set_budget', player_id: id, budget_cents: 100 })).rejects.toMatchObject({ code: 'not_host' });
  });

  it('cambiar el presupuesto GENERAL pisa los individuales (documentado) y los jugadores nuevos reciben el general', async () => {
    const host = newHost();
    const room = await lobby(host);
    const s0 = await getHostState(ctx, room, host);
    await act(ctx, room, host, { type: 'player.set_budget', player_id: playerByName(s0, 'Ana').id, budget_cents: 9000 });
    const out = await act(ctx, room, host, { type: 'game.update', initial_budget_cents: 3000 });
    for (const p of out.snapshot.players) expect(p).toMatchObject({ balance_cents: 3000, initial_balance_cents: 3000 });
    await act(ctx, room, host, { type: 'player.set_budget', player_id: playerByName(s0, 'Ana').id, budget_cents: 100 });
    const added = await act(ctx, room, host, { type: 'player.add', name: 'Dani' });
    expect(playerByName(added.snapshot, 'Dani')).toMatchObject({ balance_cents: 3000, initial_balance_cents: 3000 });
    // Reiniciar sin partida jugada deja a todos igual
    const r = await act(ctx, room, host, { type: 'game.reset' });
    expect(playerByName(r.snapshot, 'Ana').balance_cents).toBe(100);
    expect(playerByName(r.snapshot, 'Dani').balance_cents).toBe(3000);
  });

  it('un jugador que se une desde el móvil nace con el presupuesto general', async () => {
    const host = newHost();
    const { room_code: room } = await createGame(ctx, host, { name: 'Móvil', play_mode: 'mobile', join_policy: 'open', initial_budget_cents: 4000, players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const j = await joinGame(ctx, room, { name: 'Nuevo' });
    const s = await getHostState(ctx, room, host);
    expect(s.players.find((p) => p.id === j.player_id)).toMatchObject({ balance_cents: 4000, initial_balance_cents: 4000 });
  });
});

describe('equipos ligeros', () => {
  it('etiqueta editable en la sala de espera: normaliza, reutiliza mayúsculas/minúsculas y se borra con vacío', async () => {
    const host = newHost();
    const room = await lobby(host);
    const s0 = await getHostState(ctx, room, host);
    const ana = playerByName(s0, 'Ana').id;
    const beto = playerByName(s0, 'Beto').id;
    let out = await act(ctx, room, host, { type: 'player.set_team', player_id: ana, team: '  Rojo  ' });
    expect(playerByName(out.snapshot, 'Ana').team).toBe('Rojo');
    out = await act(ctx, room, host, { type: 'player.set_team', player_id: beto, team: 'rojo' });
    expect(playerByName(out.snapshot, 'Beto').team).toBe('Rojo'); // mismo equipo
    expect(playerByName(out.snapshot, 'Carla').team).toBeNull();
    // No comparten saldo
    expect(playerByName(out.snapshot, 'Ana').balance_cents).toBe(2000);
    out = await act(ctx, room, host, { type: 'player.set_team', player_id: ana, team: '' });
    expect(playerByName(out.snapshot, 'Ana').team).toBeNull();
    expect((await getPublicState(ctx, room)).players.find((p) => p.id === beto)!.team).toBe('Rojo');
    await expect(act(ctx, room, host, { type: 'player.set_team', player_id: ana, team: 'x'.repeat(21) })).rejects.toMatchObject({ code: 'invalid_input' });
    await act(ctx, room, host, { type: 'player.set_team', player_id: ana, team: 'x'.repeat(20) });
    await act(ctx, room, host, { type: 'game.start' });
    await expect(act(ctx, room, host, { type: 'player.set_team', player_id: ana, team: 'Azul' })).rejects.toMatchObject({ code: 'game_already_started' });
  });

  it('reiniciar la partida conserva los equipos', async () => {
    const host = newHost();
    const room = await lobby(host);
    const ana = playerByName(await getHostState(ctx, room, host), 'Ana').id;
    await act(ctx, room, host, { type: 'player.set_team', player_id: ana, team: 'Azul' });
    await act(ctx, room, host, { type: 'game.start' });
    const r = await act(ctx, room, host, { type: 'game.reset' });
    expect(playerByName(r.snapshot, 'Ana').team).toBe('Azul');
  });

  const mk = (name: string, team: string | null, balance: number, items: number, votes = 0): Player =>
    ({ id: name, name, color: '#fff', sort_order: 0, balance_cents: balance, votes, claimed: false, current_image_version_id: null, current_image: null, initial_image: null,
       purchases: Array.from({ length: items }, (_, i) => ({ purchase_id: `${name}${i}`, item_id: `${name}${i}`, name: 'x', emoji: null, price_cents: 100, created_at: '' })), generating: [], team }) as Player;

  it('computeTeams: sin etiquetas no hay tabla; suma saldos/elementos/votos y puntúa según la regla activa', () => {
    const players = [mk('Ana', null, 1000, 1), mk('Beto', null, 500, 0)];
    expect(computeTeams(players, 'balance')).toBeNull();
    expect(computeTeams([mk('Ana', '', 1000, 1), mk('Beto', '  ', 500, 0)], 'items')).toBeNull();

    const teamed = [mk('Ana', 'Rojo', 1000, 1, 2), mk('Beto', 'rojo', 500, 3, 1), mk('Carla', 'Azul', 2000, 1, 5), mk('Dani', null, 9999, 9, 9)];
    const bal = computeTeams(teamed, 'balance')!;
    expect(bal.map((t) => [t.team, t.balance_cents, t.items, t.score, t.rank])).toEqual([['Azul', 2000, 1, 2000, 1], ['Rojo', 1500, 4, 1500, 2]]);
    expect(bal.flatMap((t) => t.players.map((p) => p.name))).not.toContain('Dani'); // sin etiqueta: fuera
    const items = computeTeams(teamed, 'items')!;
    expect(items.map((t) => [t.team, t.score])).toEqual([['Rojo', 4], ['Azul', 1]]);
    const votes = computeTeams(teamed, 'votes')!;
    expect(votes.map((t) => [t.team, t.score])).toEqual([['Azul', 5], ['Rojo', 3]]);
    const none = computeTeams(teamed, 'none')!;
    expect(none.every((t) => t.rank === null && t.score === null)).toBe(true);
    // Empate: comparten puesto
    const tie = computeTeams([mk('A', 'X', 100, 1), mk('B', 'Y', 100, 1)], 'balance')!;
    expect(tie.map((t) => t.rank)).toEqual([1, 1]);
  });
});
