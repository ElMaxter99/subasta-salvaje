import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { galleryVote, hashToken, identifyPlayer, joinGame, leaveGame, playerBid } from '@/lib/services/play-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function mobileGame(host: string, mode: 'mobile' | 'host' = 'mobile') {
  const { room_code } = await createGame(ctx, host, { name: 'Móviles', play_mode: mode, integer_bids: false, players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] });
  return { room: room_code, snap: await getHostState(ctx, room_code, host) };
}
async function openAuction(host: string, room: string) {
  await act(ctx, room, host, { type: 'game.start' });
  const s = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
  return { auctionId: a.snapshot.auction!.id, s };
}

describe('modo móviles', () => {
  it('el modo se elige al crear y se puede cambiar; por defecto es «host»', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    expect(snap.game.play_mode).toBe('mobile');
    expect((await mobileGame(host, 'host')).snap.game.play_mode).toBe('host');
    const r = await act(ctx, room, host, { type: 'game.set_mode', play_mode: 'host' });
    expect(r.snapshot.game.play_mode).toBe('host');
    await expect(act(ctx, room, newHost(), { type: 'game.set_mode', play_mode: 'mobile' })).rejects.toMatchObject({ code: 'not_host' });
  });

  it('un jugador reclama su casilla (primero en llegar), se identifica con su token y la vista pública sólo expone `claimed`', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = playerByName(snap, 'Ana').id;
    const j = await joinGame(ctx, room, { player_id: ana });
    expect(j.player_id).toBe(ana);
    expect(await identifyPlayer(ctx, room, j.token)).toBe(ana);
    expect(await identifyPlayer(ctx, room, 'token-inventado-de-prueba-123456')).toBeNull();
    await expect(joinGame(ctx, room, { player_id: ana })).rejects.toMatchObject({ code: 'player_taken' });
    const pub = await getPublicState(ctx, room);
    expect(pub.players.find((p) => p.id === ana)!.claimed).toBe(true);
    expect(pub.players.find((p) => p.name === 'Beto')!.claimed).toBe(false);
    const dump = JSON.stringify(pub);
    expect(dump).not.toContain(j.token);
    expect(dump).not.toContain(hashToken(j.token));
    expect(dump).not.toContain('token_hash');
  });

  it('el anfitrión puede liberar una casilla y otro móvil la reclama; el token viejo deja de valer', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const beto = playerByName(snap, 'Beto').id;
    const first = await joinGame(ctx, room, { player_id: beto });
    await act(ctx, room, host, { type: 'player.release', player_id: beto });
    expect(await identifyPlayer(ctx, room, first.token)).toBeNull();
    const second = await joinGame(ctx, room, { player_id: beto });
    expect(await identifyPlayer(ctx, room, second.token)).toBe(beto);
    await leaveGame(ctx, room, second.token);
    expect(await identifyPlayer(ctx, room, second.token)).toBeNull();
    await expect(act(ctx, room, newHost(), { type: 'player.release', player_id: beto })).rejects.toMatchObject({ code: 'not_host' });
  });

  it('se puede entrar con un nombre nuevo sólo en la sala de espera y sin duplicar nombres', async () => {
    const host = newHost();
    const { room } = await mobileGame(host);
    const j = await joinGame(ctx, room, { name: 'Dani' });
    const pub = await getPublicState(ctx, room);
    const dani = pub.players.find((p) => p.name === 'Dani')!;
    expect(dani).toMatchObject({ claimed: true, balance_cents: 2000 });
    expect(await identifyPlayer(ctx, room, j.token)).toBe(dani.id);
    await expect(joinGame(ctx, room, { name: 'dani' })).rejects.toMatchObject({ code: 'duplicate_name' });
    await act(ctx, room, host, { type: 'game.start' });
    await expect(joinGame(ctx, room, { name: 'Tarde' })).rejects.toMatchObject({ code: 'game_already_started' });
  });

  it('en modo «host» nadie puede unirse ni pujar desde el móvil', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host, 'host');
    await expect(joinGame(ctx, room, { player_id: snap.players[0]!.id })).rejects.toMatchObject({ code: 'mobile_disabled' });
    await expect(playerBid(ctx, room, 'x'.repeat(30), { auction_id: crypto.randomUUID(), amount_cents: 100, idempotency_key: key() })).rejects.toMatchObject({ code: 'mobile_disabled' });
  });

  it('un jugador puja desde su móvil con las mismas reglas: saldo, mínimo, subir la puja, cierre y no pujar contra sí mismo', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    const beto = await joinGame(ctx, room, { player_id: playerByName(snap, 'Beto').id });
    const { auctionId } = await openAuction(host, room);
    const bid = (t: string, amount: number, k = key()) => playerBid(ctx, room, t, { auction_id: auctionId, amount_cents: amount, idempotency_key: k });

    const r = await bid(ana.token, 300);
    expect(r.auction!.current_bid_cents).toBe(300);
    expect(r.auction!.current_bidder_id).toBe(ana.player_id);
    await expect(bid(ana.token, 500)).rejects.toMatchObject({ code: 'already_leading' });
    await expect(bid(beto.token, 300)).rejects.toMatchObject({ code: 'bid_too_low' });
    await expect(bid(beto.token, 2001)).rejects.toMatchObject({ code: 'insufficient_balance' });
    await expect(bid(beto.token, 50)).rejects.toMatchObject({ code: 'bid_below_minimum' });
    await expect(bid('no-es-un-token-valido-123456789', 900)).rejects.toMatchObject({ code: 'not_player' });
    const k = key();
    await bid(beto.token, 600, k);
    await bid(beto.token, 600, k).catch(() => null); // reintento con la misma clave: no duplica
    const s = await getHostState(ctx, room, host);
    expect(s.auction!.bids.map((b) => b.amount_cents)).toEqual([600, 300]);
    // el anfitrión también puede seguir pujando por voz, y cierra/adjudica como siempre
    await act(ctx, room, host, { type: 'auction.close', auction_id: auctionId });
    await expect(bid(ana.token, 900)).rejects.toMatchObject({ code: 'auction_closed' });
    await act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: beto.player_id, expected_price_cents: 600, idempotency_key: key() });
    expect(playerByName(await getHostState(ctx, room, host), 'Beto').balance_cents).toBe(1400);
  });

  it('un token de un jugador no sirve en otra partida', async () => {
    const host = newHost();
    const a = await mobileGame(host);
    const b = await mobileGame(host);
    const ana = await joinGame(ctx, a.room, { player_id: playerByName(a.snap, 'Ana').id });
    expect(await identifyPlayer(ctx, b.room, ana.token)).toBeNull();
    const { auctionId } = await openAuction(host, b.room);
    await expect(playerBid(ctx, b.room, ana.token, { auction_id: auctionId, amount_cents: 200, idempotency_key: key() })).rejects.toMatchObject({ code: 'not_player' });
  });
});

describe('endurecimiento del modo móviles', () => {
  it('un móvil ya identificado no puede reclamar más casillas', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const first = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await expect(joinGame(ctx, room, { player_id: playerByName(snap, 'Beto').id }, first.token)).rejects.toMatchObject({ code: 'already_joined' });
    await leaveGame(ctx, room, first.token);
    await expect(joinGame(ctx, room, { player_id: playerByName(snap, 'Beto').id }, first.token)).resolves.toBeTruthy();
  });

  it('los nombres se normalizan: caracteres invisibles no permiten duplicar un nombre', async () => {
    const host = newHost();
    const { room } = await mobileGame(host);
    // «Ana» ya existe: la versión con un carácter invisible (U+200B) debe contar como duplicada
    await expect(joinGame(ctx, room, { name: 'An\u200Ba' })).rejects.toMatchObject({ code: 'duplicate_name' });
    await expect(joinGame(ctx, room, { name: 'Dani\u200B' })).resolves.toBeTruthy();
    await expect(joinGame(ctx, room, { name: 'dani' })).rejects.toMatchObject({ code: 'duplicate_name' });
  });

  it('tras finalizar el token no permite pujar y, cerrada la galería, tampoco votar', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const j = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await act(ctx, room, host, { type: 'game.start' });
    await act(ctx, room, host, { type: 'game.finish' });
    expect(await identifyPlayer(ctx, room, j.token)).not.toBeNull();
    await expect(playerBid(ctx, room, j.token, { auction_id: crypto.randomUUID(), amount_cents: 100, idempotency_key: 'k-12345678' })).rejects.toMatchObject({ code: expect.stringMatching(/game_not_active|auction_not_found/) });
    await act(ctx, room, host, { type: 'gallery.close' });
    await expect(galleryVote(ctx, room, j.token, { target_id: crypto.randomUUID() })).rejects.toMatchObject({ code: 'gallery_closed' });
  });

  it('salir con un token inventado no toca la BD ni publica nada', async () => {
    const host = newHost();
    const { room } = await mobileGame(host);
    const before = ctx.publisher.calls.length;
    await leaveGame(ctx, room, 'token-inventado-que-no-existe-123456');
    expect(ctx.publisher.calls.length).toBe(before);
  });
});

describe('proveedor demo', () => {
  it('un nombre de elemento con patrones `$` no corrompe el SVG', async () => {
    const { createDemoProvider } = await import('@/lib/ai/demo');
    const p = createDemoProvider();
    const base = await p.generateInitialScene({ theme: 'house', sceneDescription: '', playerName: 'A' });
    const out = await p.editScene({ base: { bytes: base.bytes, mime: base.mime }, theme: 'house', itemName: "$` $' $& $$", itemDescription: '', itemEmoji: '🎁', previousItems: [] });
    const svg = new TextDecoder().decode(out.bytes);
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    expect(svg.length).toBeLessThan(base.bytes.length + 2000);
  });
});

describe('política de altas e imagen para quien entra tarde', () => {
  it('«slots» no admite nombres nuevos y «closed» no admite a nadie nuevo, pero los ya conectados siguen', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    const ana = await joinGame(ctx, room, { player_id: playerByName(snap, 'Ana').id });
    await act(ctx, room, host, { type: 'game.set_join_policy', join_policy: 'slots' });
    await expect(joinGame(ctx, room, { name: 'Nuevo' })).rejects.toMatchObject({ code: 'new_names_disabled' });
    await expect(joinGame(ctx, room, { player_id: playerByName(snap, 'Beto').id })).resolves.toBeTruthy();
    await act(ctx, room, host, { type: 'game.set_join_policy', join_policy: 'closed' });
    await expect(joinGame(ctx, room, { player_id: playerByName(snap, 'Carla').id })).rejects.toMatchObject({ code: 'room_closed' });
    expect(await identifyPlayer(ctx, room, ana.token)).toBe(ana.player_id);
    await expect(act(ctx, room, newHost(), { type: 'game.set_join_policy', join_policy: 'open' })).rejects.toMatchObject({ code: 'not_host' });
    await act(ctx, room, host, { type: 'game.set_join_policy', join_policy: 'open' });
    expect((await getPublicState(ctx, room)).game.join_policy).toBe('open');
  });

  it('quien entra con nombre nuevo hereda la imagen de partida común', async () => {
    const host = newHost();
    const { room } = await mobileGame(host);
    await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'island' });
    await joinGame(ctx, room, { name: 'Tarde' });
    const s = await getHostState(ctx, room, host);
    const late = s.players.find((p) => p.name === 'Tarde')!;
    expect(late.current_image?.storage_path).toBe(s.players[0]!.current_image!.storage_path);
    expect(new Set(s.players.map((p) => p.current_image!.storage_path)).size).toBe(1);
  });
});

describe('imagen inicial para jugadores actuales y/o nuevos', () => {
  it('«solo actuales» no cambia a los que entren después; «actuales y nuevos» los incluye (móvil y panel)', async () => {
    const host = newHost();
    const { room } = await mobileGame(host);
    await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'house', scope_current: true, scope_new: false });
    const late1 = await joinGame(ctx, room, { name: 'Tarde1' });
    let s = await getHostState(ctx, room, host);
    expect(s.game.new_player_image_kind ?? null).toBeNull();
    expect(s.players.find((p) => p.id === late1.player_id)!.current_image?.storage_path).toBe(s.players[0]!.current_image!.storage_path); // hereda por coincidencia de todos
    // Ahora «actuales y nuevos» con otra imagen
    await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'island', scope_current: true, scope_new: true });
    s = await getHostState(ctx, room, host);
    expect(s.game.new_player_image_kind).toBe('file');
    const islandPath = s.players[0]!.current_image!.storage_path;
    expect(new Set(s.players.map((p) => p.current_image!.storage_path)).size).toBe(1);
    const late2 = await joinGame(ctx, room, { name: 'Tarde2' }); // móvil
    const added = await act(ctx, room, host, { type: 'player.add', name: 'Panel1' }); // panel
    s = added.snapshot;
    for (const name of ['Tarde2', 'Panel1']) expect(s.players.find((p) => p.name === name)!.current_image?.storage_path).toBe(islandPath);
    expect(late2.player_id).toBeTruthy();
    // Quitar la imagen por defecto de los nuevos
    await act(ctx, room, host, { type: 'image.clear_new_player_image' });
    const none = await act(ctx, room, host, { type: 'player.add', name: 'Sin imagen' });
    expect(none.snapshot.game.new_player_image_kind ?? null).toBeNull();
  });

  it('«solo nuevos» deja a los actuales como están y guarda la imagen para los que lleguen', async () => {
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'castle', scope_current: false, scope_new: true });
    const s = await getHostState(ctx, room, host);
    expect(s.players.every((p) => p.current_image === null)).toBe(true);
    expect(s.game.new_player_image_kind).toBe('file');
    await joinGame(ctx, room, { name: 'Recien' });
    const after = await getHostState(ctx, room, host);
    expect(after.players.find((p) => p.name === 'Recien')!.current_image).not.toBeNull();
    expect(after.players.filter((p) => p.id !== after.players.find((x) => x.name === 'Recien')!.id).every((p) => p.current_image === null)).toBe(true);
    expect(snap.players).toHaveLength(3);
  });

  it('«generar» crea UNA sola imagen base compartida: la misma para actuales y para los que se unan antes de terminar la generación y después', async () => {
    const { processImageJobs } = await import('@/lib/services/jobs-service');
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    await act(ctx, room, host, { type: 'image.generate_initial_all', scope_current: true, scope_new: true });
    await act(ctx, room, host, { type: 'image.generate_initial_all', scope_current: true, scope_new: true }); // doble clic
    let s = await getHostState(ctx, room, host);
    expect(s.jobs.filter((j) => j.kind === 'base')).toHaveLength(1);
    expect(s.jobs.filter((j) => j.kind === 'initial')).toHaveLength(0);
    expect(s.game.new_player_image_kind).toBe('generate');
    await joinGame(ctx, room, { name: 'Antes' }); // se une con la generación aún en cola
    const calls = { n: 0 };
    const counting = { ...ctx.provider!, generateInitialScene: async (i: Parameters<NonNullable<typeof ctx.provider>['generateInitialScene']>[0]) => { calls.n++; return ctx.provider!.generateInitialScene(i); } };
    const run = await processImageJobs({ ...ctx, provider: counting }, { gameId: snap.game.id, maxJobs: 20 });
    expect(run.succeeded).toBe(1);
    expect(calls.n).toBe(1); // una sola generación (y una sola unidad de cuota) para toda la partida
    s = await getHostState(ctx, room, host);
    expect(s.players).toHaveLength(4);
    const paths = new Set(s.players.map((p) => p.current_image!.storage_path));
    expect(paths.size).toBe(1); // exactamente el mismo archivo para todos
    expect(s.game.new_player_image_kind).toBe('file'); // los nuevos heredan ese mismo archivo
    const late = await joinGame(ctx, room, { name: 'Despues' });
    s = await getHostState(ctx, room, host);
    expect(s.players.find((p) => p.id === late.player_id)!.current_image!.storage_path).toBe([...paths][0]);
    // Sólo se puede en la sala de espera y sólo el anfitrión
    await expect(act(ctx, room, newHost(), { type: 'image.generate_initial_all', scope_current: true, scope_new: false })).rejects.toMatchObject({ code: 'not_host' });
    await act(ctx, room, host, { type: 'game.start' });
    await expect(act(ctx, room, host, { type: 'image.generate_initial_all', scope_current: true, scope_new: true })).rejects.toMatchObject({ code: 'game_already_started' });
  });

  it('imagen base solo para los jugadores nuevos: los actuales no cambian y regenerar sustituye la imagen de todos', async () => {
    const { processImageJobs } = await import('@/lib/services/jobs-service');
    const host = newHost();
    const { room, snap } = await mobileGame(host);
    await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'house', scope_current: true, scope_new: false });
    const before = (await getHostState(ctx, room, host)).players.map((p) => p.current_image!.storage_path);
    await act(ctx, room, host, { type: 'image.generate_initial_all', scope_current: false, scope_new: true });
    await processImageJobs(ctx, { gameId: snap.game.id });
    let s = await getHostState(ctx, room, host);
    expect(s.players.map((p) => p.current_image!.storage_path)).toEqual(before); // los actuales no se tocan
    const j = await joinGame(ctx, room, { name: 'Nuevo' });
    s = await getHostState(ctx, room, host);
    const nuevo = s.players.find((p) => p.id === j.player_id)!.current_image!.storage_path;
    expect(nuevo).not.toBe(before[0]);
    // Regenerar para todos: nueva imagen única, también para los actuales
    await act(ctx, room, host, { type: 'image.generate_initial_all', scope_current: true, scope_new: true });
    await processImageJobs(ctx, { gameId: snap.game.id });
    s = await getHostState(ctx, room, host);
    expect(new Set(s.players.map((p) => p.current_image!.storage_path)).size).toBe(1);
  });

  it('una subida a «actuales y nuevos» guarda un solo archivo compartido', async () => {
    const { uploadInitialImageForAll } = await import('@/lib/services/game-service');
    const host = newHost();
    const { room } = await mobileGame(host);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
    await uploadInitialImageForAll(ctx, room, host, png, { current: true, new: true });
    await joinGame(ctx, room, { name: 'Nuevo' });
    const s = await getHostState(ctx, room, host);
    expect(new Set(s.players.map((p) => p.current_image!.storage_path)).size).toBe(1);
    expect(s.players.every((p) => p.current_image!.provider === 'upload')).toBe(true);
  });
});
