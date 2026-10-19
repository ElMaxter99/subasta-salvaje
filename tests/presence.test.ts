import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoAwardTick, createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, playerBid, playerPing, sendReaction, unyieldBid, yieldBid } from '@/lib/services/play-service';
import { act, ensureInitialImages, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const sql = (q: string, args: unknown[] = []) => ctx.db.pg.query(q, args);
const ago = (playerId: string, secs: number) => sql(`update players set last_seen_at = clock_timestamp() - make_interval(secs => $2) where id = $1`, [playerId, secs]);
const countEvents = async (gid: string, type: string, pid: string) =>
  Number(((await sql(`select count(*)::int as n from game_events where game_id = $1 and event_type = $2 and payload->>'player_id' = $3`, [gid, type, pid])).rows[0] as { n: number }).n);

async function setup(names = ['Ana', 'Beto', 'Carla'], opts: { auto?: boolean; budget?: number } = {}) {
  const host = newHost();
  const { room_code: room } = await createGame(ctx, host, {
    name: 'Presencia', play_mode: 'mobile', integer_bids: false, initial_budget_cents: opts.budget ?? 2000, players: names.map((name) => ({ name })),
  });
  await ensureInitialImages(ctx, room, host);
  const s0 = await getHostState(ctx, room, host);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const n of names) {
    ids[n] = playerByName(s0, n).id;
    tokens[n] = (await joinGame(ctx, room, { player_id: ids[n] })).token;
  }
  if (opts.auto) await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 10 });
  await act(ctx, room, host, { type: 'game.start' });
  const s = await getHostState(ctx, room, host);
  type Names = 'Ana' | 'Beto' | 'Carla';
  return { host, room, tokens: tokens as Record<Names, string>, ids: ids as Record<Names, string>, gid: s.game.id, items: s.items };
}
const open = async (g: Awaited<ReturnType<typeof setup>>, i = 0) =>
  (await act(ctx, g.room, g.host, { type: 'auction.announce', item_id: g.items[i]!.id })).snapshot.auction!.id;

describe('latido y presencia', () => {
  it('quien acaba de reclamar cuenta como conectado (margen) y la vista pública no lleva marcas de tiempo', async () => {
    const g = await setup();
    const pub = await getPublicState(ctx, g.room);
    expect(pub.players.every((p) => p.online === true)).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('last_seen');
    // Aunque no haya marca (reclamo anterior a la migración) cuenta como recién conectado.
    await sql('update players set last_seen_at = null where id = $1', [g.ids.Ana]);
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Ana)!.online).toBe(true);
  });

  it('sin latido > 40 s: desconectado (público: online=false; anfitrión: segundos); el latido lo reconecta', async () => {
    const g = await setup();
    await ago(g.ids.Beto, 120);
    const pub = await getPublicState(ctx, g.room);
    expect(pub.players.find((p) => p.id === g.ids.Beto)!.online).toBe(false);
    expect(pub.players.find((p) => p.id === g.ids.Ana)!.online).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('last_seen');
    const host = await getHostState(ctx, g.room, g.host);
    const beto = host.players.find((p) => p.id === g.ids.Beto)!;
    expect(beto.last_seen_ago_seconds).toBeGreaterThanOrEqual(119);
    await ago(g.ids.Beto, 39);
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Beto)!.online).toBe(true);
    await ago(g.ids.Beto, 41);
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Beto)!.online).toBe(false);
    await playerPing(ctx, g.room, g.tokens.Beto, {});
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Beto)!.online).toBe(true);
  });

  it('eventos solo al CAMBIAR el estado: el barrido registra una desconexión; los latidos normales no registran nada ni cambian la versión', async () => {
    const g = await setup();
    const v0 = (await getPublicState(ctx, g.room)).version;
    for (let i = 0; i < 5; i++) await playerPing(ctx, g.room, g.tokens.Ana, {});
    expect((await getPublicState(ctx, g.room)).version).toBe(v0); // sin ss_touch: no inunda Realtime
    expect(await countEvents(g.gid, 'player_reconnected', g.ids.Ana)).toBe(0);

    await ago(g.ids.Beto, 90);
    expect(await autoAwardTick(ctx, g.room)).toBe(false);
    const v1 = (await getPublicState(ctx, g.room)).version;
    expect(v1).toBeGreaterThan(v0);
    expect(await countEvents(g.gid, 'player_disconnected', g.ids.Beto)).toBe(1);
    await autoAwardTick(ctx, g.room); await autoAwardTick(ctx, g.room);
    expect(await countEvents(g.gid, 'player_disconnected', g.ids.Beto)).toBe(1); // idempotente
    expect((await getPublicState(ctx, g.room)).version).toBe(v1);

    ctx.publisher.calls.length = 0;
    await playerPing(ctx, g.room, g.tokens.Beto, {});
    expect(await countEvents(g.gid, 'player_reconnected', g.ids.Beto)).toBe(1);
    expect(ctx.publisher.calls.length).toBe(1); // al reconectar sí se avisa
    await playerPing(ctx, g.room, g.tokens.Beto, {});
    expect(await countEvents(g.gid, 'player_reconnected', g.ids.Beto)).toBe(1);
    const events = (await getHostState(ctx, g.room, g.host)).events.map((e) => e.event_type);
    expect(events).toContain('player_disconnected');
    expect(events).toContain('player_reconnected');
  });

  it('aviso de salida (bye): desconecta al instante y una sola vez', async () => {
    const g = await setup();
    await playerPing(ctx, g.room, g.tokens.Carla, { bye: true });
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Carla)!.online).toBe(false);
    await playerPing(ctx, g.room, g.tokens.Carla, { bye: true });
    expect(await countEvents(g.gid, 'player_disconnected', g.ids.Carla)).toBe(1);
    await playerPing(ctx, g.room, g.tokens.Carla, {});
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Carla)!.online).toBe(true);
  });

  it('identidad: sin token o con token ajeno es not_player; el cuerpo no puede traer identidad', async () => {
    const g = await setup();
    const other = await setup();
    await expect(playerPing(ctx, g.room, undefined, {})).rejects.toMatchObject({ code: 'not_player' });
    await expect(playerPing(ctx, g.room, 'x'.repeat(43), {})).rejects.toMatchObject({ code: 'not_player' });
    await expect(playerPing(ctx, g.room, other.tokens.Ana, {})).rejects.toMatchObject({ code: 'not_player' });
    await expect(playerPing(ctx, g.room, g.tokens.Ana, { bye: 'si' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('en modo anfitrión no hay presencia (ni campo online)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'H', players: [{ name: 'Ana' }] });
    const pub = await getPublicState(ctx, room_code);
    expect(pub.players[0]!.online).toBeUndefined();
  });

  it('desconectarse no cambia reglas: sigue pudiendo pujar y la adjudicación automática funciona igual', async () => {
    const g = await setup(['Ana', 'Beto'], { auto: true });
    const aid = await open(g);
    await ago(g.ids.Ana, 300);
    await autoAwardTick(ctx, g.room);
    const r = await playerBid(ctx, g.room, g.tokens.Ana, { auction_id: aid, amount_cents: 300, idempotency_key: key() });
    expect(r.game.status).toBe('active');
    const s = await getHostState(ctx, g.room, g.host);
    expect(s.auction?.current_bidder_id).toBe(g.ids.Ana);
  });
});

describe('retirar de la TV', () => {
  it('retirar/volver: idempotente, con eventos, sin tocar saldo ni compras; la vista pública lo marca', async () => {
    const g = await setup();
    const before = (await getHostState(ctx, g.room, g.host)).players.find((p) => p.id === g.ids.Ana)!.balance_cents;
    const r1 = await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Ana });
    expect(r1.snapshot.players.find((p) => p.id === g.ids.Ana)!.retired).toBe(true);
    await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Ana });
    expect(await countEvents(g.gid, 'player_retired', g.ids.Ana)).toBe(1);
    const pub = await getPublicState(ctx, g.room);
    expect(pub.players.find((p) => p.id === g.ids.Ana)!.retired).toBe(true);
    expect(pub.players.find((p) => p.id === g.ids.Ana)!.balance_cents).toBe(before);
    expect(pub.players.find((p) => p.id === g.ids.Beto)!.retired).toBe(false);
    await act(ctx, g.room, g.host, { type: 'player.unretire', player_id: g.ids.Ana });
    await act(ctx, g.room, g.host, { type: 'player.unretire', player_id: g.ids.Ana });
    expect(await countEvents(g.gid, 'player_unretired', g.ids.Ana)).toBe(1);
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Ana)!.retired).toBe(false);
  });

  it('solo el anfitrión de la partida puede retirar; jugador de otra partida o inexistente falla', async () => {
    const g = await setup();
    await expect(act(ctx, g.room, newHost(), { type: 'player.retire', player_id: g.ids.Ana })).rejects.toMatchObject({ code: 'not_host' });
    const other = await setup();
    await expect(act(ctx, g.room, g.host, { type: 'player.retire', player_id: other.ids.Ana })).rejects.toMatchObject({ code: 'player_not_found' });
  });

  it('un retirado no puede pujar, ceder, retractarse ni reaccionar (player_retired); al volver, sí', async () => {
    const g = await setup(['Ana', 'Beto', 'Carla']);
    const aid = await open(g);
    await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Ana });
    await expect(playerBid(ctx, g.room, g.tokens.Ana, { auction_id: aid, amount_cents: 300, idempotency_key: key() })).rejects.toMatchObject({ code: 'player_retired' });
    await expect(yieldBid(ctx, g.room, g.tokens.Ana, { auction_id: aid })).rejects.toMatchObject({ code: 'player_retired' });
    await expect(unyieldBid(ctx, g.room, g.tokens.Ana, { auction_id: aid })).rejects.toMatchObject({ code: 'player_retired' });
    await expect(sendReaction(ctx, g.room, g.tokens.Ana, { emoji: '👏' })).rejects.toMatchObject({ code: 'player_retired' });
    await playerPing(ctx, g.room, g.tokens.Ana, {}); // sigue latiendo
    await playerBid(ctx, g.room, g.tokens.Beto, { auction_id: aid, amount_cents: 300, idempotency_key: key() }); // el resto, normal
    await act(ctx, g.room, g.host, { type: 'player.unretire', player_id: g.ids.Ana });
    await playerBid(ctx, g.room, g.tokens.Ana, { auction_id: aid, amount_cents: 400, idempotency_key: key() });
  });

  it('un retirado no cuenta para la cesión: si los demás ceden, se adjudica sin esperarle', async () => {
    const g = await setup(['Ana', 'Beto', 'Carla'], { auto: true });
    const aid = await open(g);
    await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Carla });
    await playerBid(ctx, g.room, g.tokens.Ana, { auction_id: aid, amount_cents: 300, idempotency_key: key() });
    const r = await yieldBid(ctx, g.room, g.tokens.Beto, { auction_id: aid });
    expect(r.autoAwarded).toBe(true); // Carla (retirada) no bloquea el «todos han cedido»
  });

  it('un retirado no impide la adjudicación instantánea «nadie puede superar la puja»', async () => {
    const g = await setup(['Ana', 'Beto'], { auto: true, budget: 1000 });
    const aid = await open(g);
    await playerBid(ctx, g.room, g.tokens.Ana, { auction_id: aid, amount_cents: 900, idempotency_key: key() }); // Beto aún puede superar (1000 > 900)
    expect((await getHostState(ctx, g.room, g.host)).auction?.status).toBe('open');
    const g2 = await setup(['Ana', 'Beto'], { auto: true, budget: 1000 });
    const aid2 = await open(g2);
    await act(ctx, g2.room, g2.host, { type: 'player.retire', player_id: g2.ids.Beto });
    const r = await playerBid(ctx, g2.room, g2.tokens.Ana, { auction_id: aid2, amount_cents: 900, idempotency_key: key() });
    expect((await getHostState(ctx, g2.room, g2.host)).players.find((p) => p.id === g2.ids.Ana)!.purchases.length).toBe(1);
    expect(r.game.status).toBe('active');
  });

  it('si el retirado va ganando una subasta abierta, NO se cambia el cobro: sigue abierta y el anfitrión decide', async () => {
    const g = await setup(['Ana', 'Beto']);
    const aid = await open(g);
    await playerBid(ctx, g.room, g.tokens.Ana, { auction_id: aid, amount_cents: 300, idempotency_key: key() });
    const r = await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Ana });
    expect(r.snapshot.auction?.status).toBe('open');
    expect(r.snapshot.auction?.current_bidder_id).toBe(g.ids.Ana);
    const s = await getHostState(ctx, g.room, g.host);
    expect(s.players.find((p) => p.id === g.ids.Ana)!.balance_cents).toBe(2000); // sin cobro
    // El anfitrión puede adjudicar como siempre.
    await act(ctx, g.room, g.host, { type: 'auction.award', auction_id: aid, expected_winner_id: g.ids.Ana, expected_price_cents: 300, idempotency_key: key() });
    const s2 = await getHostState(ctx, g.room, g.host);
    expect(s2.players.find((p) => p.id === g.ids.Ana)!.balance_cents).toBe(1700);
    expect(s2.players.find((p) => p.id === g.ids.Ana)!.retired).toBe(true); // sigue retirado, con su compra
  });

  it('un retirado no cuenta en «todos sin saldo»; si solo quedan retirados con saldo, la partida termina por falta de saldo', async () => {
    const g = await setup(['Ana', 'Beto'], { budget: 100 });
    await sql('update players set balance_cents = 0 where id = $1', [g.ids.Ana]);
    expect((await sql(`select ss_all_broke(g) as b from games g where g.id = $1`, [g.gid])).rows[0]).toMatchObject({ b: false });
    await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Beto });
    expect((await sql(`select ss_all_broke(g) as b from games g where g.id = $1`, [g.gid])).rows[0]).toMatchObject({ b: true });
  });

  it('puede volver a reclamar su casilla tras liberarla estando retirado (sigue retirado hasta «Volver a mostrar»)', async () => {
    const g = await setup(['Ana', 'Beto']);
    await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Ana });
    await act(ctx, g.room, g.host, { type: 'player.release', player_id: g.ids.Ana });
    const j = await joinGame(ctx, g.room, { player_id: g.ids.Ana });
    expect(j.snapshot.players.find((p) => p.id === g.ids.Ana)!.retired).toBe(true);
    await act(ctx, g.room, g.host, { type: 'player.unretire', player_id: g.ids.Ana });
    expect((await getPublicState(ctx, g.room)).players.find((p) => p.id === g.ids.Ana)!.retired).toBe(false);
  });

  it('«Reiniciar partida» devuelve a todos los retirados', async () => {
    const g = await setup(['Ana', 'Beto']);
    await act(ctx, g.room, g.host, { type: 'player.retire', player_id: g.ids.Ana });
    await act(ctx, g.room, g.host, { type: 'game.reset' });
    expect((await getPublicState(ctx, g.room)).players.every((p) => !p.retired)).toBe(true);
  });
});
