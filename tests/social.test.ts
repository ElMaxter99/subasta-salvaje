import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { houseAtStep, roundOutcome } from '@/lib/domain/replay';
import type { ImageVersion, ReplayRound } from '@/lib/domain/types';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { hashToken, joinGame, sendReaction } from '@/lib/services/play-service';
import { getReplay } from '@/lib/services/replay-service';
import { podiumRows, plainText, renderPodiumImage } from '@/lib/seo/podium-image';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function mobileGame(host: string, mode: 'mobile' | 'host' = 'mobile', players = ['Ana', 'Beto', 'Carla']) {
  const { room_code } = await createGame(ctx, host, { name: 'Social', play_mode: mode, integer_bids: false, ranking_rule: 'balance', players: players.map((name) => ({ name })) });
  return { room: room_code, snap: await getHostState(ctx, room_code, host) };
}
/** Salta el límite de 1,5 s por jugador retrasando sus reacciones (los tests no esperan de verdad). */
const age = (room: string, seconds: number) =>
  ctx.db.pg.query("update game_reactions set created_at = created_at - make_interval(secs => $2) where game_id = (select id from games where room_code = $1)", [room, seconds]);

describe('reacciones del móvil a la TV', () => {
  it('un jugador identificado reacciona con un emoji de la lista y aparece en la instantánea pública', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await act(ctx, room, host, { type: 'game.start' });
    const s = await sendReaction(ctx, room, ana.token, { emoji: '🔥' });
    expect(s.reactions).toHaveLength(1);
    expect(s.reactions![0]).toMatchObject({ player_id: ana.player_id, emoji: '🔥' });
    const dump = JSON.stringify(await getPublicState(ctx, room));
    expect(dump).not.toContain(hashToken(ana.token));
    expect((await getHostState(ctx, room, host)).reactions).toHaveLength(1);
  });

  it('exige partida activa, token válido, modo móviles y un emoji de la lista cerrada', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await expect(sendReaction(ctx, room, ana.token, { emoji: '👏' })).rejects.toMatchObject({ code: 'game_not_active' }); // sala de espera
    await act(ctx, room, host, { type: 'game.start' });
    await expect(sendReaction(ctx, room, 'token-inventado-de-prueba-123456', { emoji: '👏' })).rejects.toMatchObject({ code: 'not_player' });
    await expect(sendReaction(ctx, room, null, { emoji: '👏' })).rejects.toMatchObject({ code: 'not_player' });
    await expect(sendReaction(ctx, room, ana.token, { emoji: '💩' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(sendReaction(ctx, room, ana.token, { emoji: '👏', player_id: 'x' })).resolves.toBeTruthy(); // la identidad sale del token, el cuerpo extra se ignora
    // el token de otra partida no vale
    const other = await mobileGame(host);
    await act(ctx, other.room, host, { type: 'game.start' });
    await expect(sendReaction(ctx, other.room, ana.token, { emoji: '👏' })).rejects.toMatchObject({ code: 'not_player' });
    // modo «host»: no hay móviles
    const h = await mobileGame(host, 'host');
    await expect(sendReaction(ctx, h.room, ana.token, { emoji: '👏' })).rejects.toMatchObject({ code: 'mobile_disabled' });
  });

  it('límite por jugador (1,5 s), por partida (50 por minuto) y limpieza a las últimas 50', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    const beto = await joinGame(ctx, room, { player_id: playerByName(snap, 'Beto').id });
    await act(ctx, room, host, { type: 'game.start' });
    await sendReaction(ctx, room, ana.token, { emoji: '😂' });
    await expect(sendReaction(ctx, room, ana.token, { emoji: '😂' })).rejects.toMatchObject({ code: 'reaction_too_fast', status: 429 });
    await sendReaction(ctx, room, beto.token, { emoji: '😱' }); // otro jugador no está limitado por Ana
    await age(room, 2);
    await sendReaction(ctx, room, ana.token, { emoji: '😭' });

    // Con 48 reacciones ya hechas en el último minuto cabe una más; la siguiente (de otro jugador) topa con el límite de la partida
    await ctx.db.pg.query(
      "insert into game_reactions (game_id, player_id, emoji, created_at) select g.id, $2::uuid, '🤑', now() - interval '30 seconds' from games g, generate_series(1, 46 - 1) where g.room_code = $1",
      [room, ana.player_id],
    );
    // ya hay 3 + 45 = 48 en el último minuto
    await ctx.db.pg.query("update game_reactions set created_at = created_at - interval '3 seconds' where game_id = (select id from games where room_code = $1)", [room]);
    await sendReaction(ctx, room, ana.token, { emoji: '🤑' }); // 49
    await sendReaction(ctx, room, beto.token, { emoji: '🤑' }); // 50
    await ctx.db.pg.query("update game_reactions set created_at = created_at - interval '3 seconds' where game_id = (select id from games where room_code = $1)", [room]);
    await expect(sendReaction(ctx, room, beto.token, { emoji: '🤑' })).rejects.toMatchObject({ code: 'reactions_busy', status: 429 });
    const total = await ctx.db.pg.query<{ n: number }>("select count(*)::int as n from game_reactions where game_id = (select id from games where room_code = $1)", [room]);
    expect(total.rows[0]!.n).toBeLessThanOrEqual(50);
  });

  it('la limpieza conserva solo las últimas 50 reacciones de la partida', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await act(ctx, room, host, { type: 'game.start' });
    await ctx.db.pg.query(
      "insert into game_reactions (game_id, player_id, emoji, created_at) select g.id, $2::uuid, '🔥', now() - interval '5 minutes' from games g, generate_series(1, 70) where g.room_code = $1",
      [room, ana.player_id],
    );
    await sendReaction(ctx, room, ana.token, { emoji: '🎉' });
    const rows = await ctx.db.pg.query<{ n: number; last: string }>("select count(*)::int as n, (array_agg(emoji order by id desc))[1] as last from game_reactions where game_id = (select id from games where room_code = $1)", [room]);
    expect(rows.rows[0]).toEqual({ n: 50, last: '🎉' });
  });

  it('en la instantánea solo salen las reacciones de los últimos 10 s', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await act(ctx, room, host, { type: 'game.start' });
    await sendReaction(ctx, room, ana.token, { emoji: '🎉' });
    expect((await getPublicState(ctx, room)).reactions).toHaveLength(1);
    await age(room, 11);
    expect((await getPublicState(ctx, room)).reactions).toEqual([]);
  });

  it('cada reacción publica una versión nueva para que la TV la reciba', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await act(ctx, room, host, { type: 'game.start' });
    const before = (await getPublicState(ctx, room)).version;
    const calls = ctx.publisher.calls.length;
    const after = await sendReaction(ctx, room, ana.token, { emoji: '👏' });
    expect(after.version).toBeGreaterThan(before);
    expect(ctx.publisher.calls.length).toBe(calls + 1);
  });
});

describe('repetición de la partida', () => {
  it('lista las rondas con ganador, precio, pujas, perdidas y canceladas; solo para el anfitrión', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host, 'host', ['Ana', 'Beto']);
    await act(ctx, room, host, { type: 'game.start' });
    const items = (await getHostState(ctx, room, host)).items;
    const ana = playerByName(snap, 'Ana').id;
    const beto = playerByName(snap, 'Beto').id;
    // Ronda 1: Beto gana tras dos pujas
    let a = (await act(ctx, room, host, { type: 'auction.announce', item_id: items[0]!.id })).snapshot.auction!.id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a, player_id: ana, amount_cents: 200, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a, player_id: beto, amount_cents: 450, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.close', auction_id: a });
    await act(ctx, room, host, { type: 'auction.award', auction_id: a, expected_winner_id: beto, expected_price_cents: 450, idempotency_key: key() });
    // Ronda 2: cancelada
    a = (await act(ctx, room, host, { type: 'auction.announce', item_id: items[1]!.id })).snapshot.auction!.id;
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: a });

    const rounds = await getReplay(ctx, room, host);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({ round_number: 1, status: 'awarded', winner_id: beto, price_cents: 450, bids_count: 2, item_name: items[0]!.name });
    expect(rounds[0]!.purchase_id).toBeTruthy();
    expect(roundOutcome(rounds[0]!)).toBe('sold');
    expect(rounds[1]).toMatchObject({ status: 'cancelled', winner_id: null, bids_count: 0, purchase_id: null });
    await expect(getReplay(ctx, room, newHost())).rejects.toMatchObject({ code: 'not_host' });
    await expect(getReplay(ctx, 'ZZZZZZ', host)).rejects.toMatchObject({ code: 'game_not_found' });
  });

  it('houseAtStep reconstruye la imagen de cada jugador ronda a ronda', () => {
    const v = (id: string, player_id: string, at: number, source: string | null, status: ImageVersion['generation_status'] = 'completed'): ImageVersion => ({
      id, player_id, parent_version_id: null, storage_path: id, source_purchase_id: source, item_name: null, origin: source ? 'edit' : 'initial', provider: 'demo',
      prompt_used: null, generation_status: status, is_approved: true, error_message: null, created_at: new Date(2026, 0, 1, 0, at).toISOString(),
    });
    const round = (n: number, purchase: string | null): ReplayRound => ({ auction_id: `a${n}`, round_number: n, status: purchase ? 'awarded' : 'cancelled', item_id: `i${n}`, item_name: `E${n}`, emoji: null, item_status: 'available', winner_id: null, price_cents: null, bids_count: 0, purchase_id: purchase, wild_event: null, opened_at: '', closed_at: null });
    const versions = [v('base', 'p1', 0, null), v('e1', 'p1', 2, 'c1'), v('fail', 'p1', 3, 'c2', 'failed'), v('e2', 'p1', 4, 'c2'), v('base2', 'p2', 1, null)];
    const rounds = [round(1, 'c1'), round(2, null), round(3, 'c2')];
    expect(houseAtStep(versions, rounds, 'p1', 0)?.id).toBe('base');
    expect(houseAtStep(versions, rounds, 'p1', 1)?.id).toBe('e1');
    expect(houseAtStep(versions, rounds, 'p1', 2)?.id).toBe('e1'); // ronda cancelada: no cambia
    expect(houseAtStep(versions, rounds, 'p1', 3)?.id).toBe('e2'); // la versión fallida se ignora
    expect(houseAtStep(versions, rounds, 'p2', 3)?.id).toBe('base2');
    expect(houseAtStep(versions, rounds, 'nadie', 3)).toBeNull();
  });
});

describe('imagen del podio', () => {
  it('usa solo jugadores que entraron, puntuación en Ohros y no filtra datos sensibles', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await joinGame(ctx, room, { player_id: playerByName(snap, 'Beto').id });
    await act(ctx, room, host, { type: 'game.start' });
    await act(ctx, room, host, { type: 'game.finish' });
    const pub = await getPublicState(ctx, room);
    const { rows } = podiumRows(pub);
    expect(rows.map((r) => r.name).sort()).toEqual(['Ana', 'Beto']); // Carla nunca entró
    expect(rows[0]!.rank).toBe(1);
    expect(rows[0]!.score).toMatch(/Ohros$/);
    const res = await renderPodiumImage(pub, ctx.storage, true);
    expect(res.headers.get('content-disposition')).toContain(`podio-${room}.png`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(3_000);
  });

  it('los nombres con emoji o texto largo se sanean para el PNG', () => {
    expect(plainText('Ana 🔥')).toBe('Ana');
    expect(plainText('🔥')).toBe('Jugador');
    expect(plainText('x'.repeat(40), 10)).toHaveLength(10);
  });
});
