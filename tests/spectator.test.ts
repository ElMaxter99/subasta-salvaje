import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { gameLinkText } from '@/lib/seo/site';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

describe('modo espectador: interruptor por partida', () => {
  it('por defecto está activo, el anfitrión lo desactiva y la instantánea PÚBLICA lo refleja (sin tocar nada más)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Mirones', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    let pub = await getPublicState(ctx, room_code);
    expect(pub.game.spectator_enabled).toBe(true);
    const before = pub.version;
    await act(ctx, room_code, host, { type: 'game.set_spectator', spectator_enabled: false });
    pub = await getPublicState(ctx, room_code);
    expect(pub.game.spectator_enabled).toBe(false);
    expect(pub.version).toBeGreaterThan(before);
    expect((await getHostState(ctx, room_code, host)).game.spectator_enabled).toBe(false);
    await act(ctx, room_code, host, { type: 'game.set_spectator', spectator_enabled: true });
    expect((await getPublicState(ctx, room_code)).game.spectator_enabled).toBe(true);
  });

  it('solo el anfitrión de la partida puede cambiarlo y el valor debe ser booleano', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Ajena', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await expect(act(ctx, room_code, newHost(), { type: 'game.set_spectator', spectator_enabled: false })).rejects.toMatchObject({ code: expect.stringMatching(/not_host|game_not_found/) });
    await expect(act(ctx, room_code, host, { type: 'game.set_spectator', spectator_enabled: 'no' })).rejects.toBeDefined();
    await expect(act(ctx, room_code, host, { type: 'game.set_spectator' })).rejects.toBeDefined();
    expect((await getPublicState(ctx, room_code)).game.spectator_enabled).toBe(true);
  });
});

describe('modo espectador: la instantánea pública no filtra nada privado ni pujas a ciegas', () => {
  it('con puja a ciegas el espectador no recibe importe, líder ni pujas; sin host_id, trabajos ni prompts', async () => {
    const host = newHost();
    const { room_code: room } = await createGame(ctx, host, { name: 'Ciegos', initial_budget_cents: 2000, integer_bids: false, players: [{ name: 'Ana' }, { name: 'Beto' }], items: [{ name: 'Lámpara', description: '' }] });
    await act(ctx, room, host, { type: 'game.start' });
    const s = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, wild_event: 'blind' });
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: playerByName(s, 'Ana').id, amount_cents: 777, idempotency_key: key() });
    const pub = await getPublicState(ctx, room);
    expect(pub.auction).toMatchObject({ hidden: true });
    expect(pub.auction!.current_bid_cents).toBe(0);
    expect(pub.auction!.current_bidder_id).toBeNull();
    expect(pub.auction!.bids).toEqual([]);
    const raw = JSON.stringify(pub);
    expect(raw).not.toContain('777');
    for (const k of ['host_id', '"jobs"', 'prompt_used', 'versions', '"events"']) expect(raw).not.toContain(k);
  });
});

describe('modo espectador: vista de solo lectura', () => {
  const src = readFileSync(path.join(process.cwd(), 'src/components/spectator/watch-view.tsx'), 'utf8');
  it('no tiene controles ni escribe nada (sin botones, campos, formularios, POST ni acceso a servidor)', () => {
    expect(src).not.toMatch(/<button|<input|<form|<textarea|<select|onClick|method:\s*'POST'|sendAction|getContext|service_role/);
    expect(src).toContain("view: 'watch'");
  });
  it('respeta `hidden` (no pinta importe, líder ni pujas a ciegas)', () => {
    expect(src).toContain('auction.hidden');
    expect(src).toMatch(/blind \? undefined/);
    expect(src).toMatch(/blind \? \[\]/);
  });
  it('texto del enlace para compartir (sin código de sala)', () => {
    const t = gameLinkText('watch', { code: 'ABC123', name: 'Noche', status: 'active', players: ['Ana', 'Beto'], winner: null });
    expect(t.title).toBe('Sigue en directo «Noche»');
    expect(t.description).not.toContain('ABC123');
  });
});

describe('modo espectador: control de acceso por clave secreta', () => {
  it('cada partida tiene su clave; solo el anfitrión la ve; nunca va en la instantánea pública', async () => {
    const { spectatorKeyValid } = await import('@/lib/services/spectator-service');
    const host = newHost();
    const a = await createGame(ctx, host, { name: 'A', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const b = await createGame(ctx, host, { name: 'B', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const ka = (await getHostState(ctx, a.room_code, host)).spectator_token!;
    const kb = (await getHostState(ctx, b.room_code, host)).spectator_token!;
    expect(ka).toMatch(/^[a-f0-9]{64}$/);
    expect(ka).not.toBe(kb);
    expect(JSON.stringify(await getPublicState(ctx, a.room_code))).not.toContain(ka);
    // Válida solo para SU partida; en minúsculas/mayúsculas de sala indistinto; basura y vacío fuera
    expect(await spectatorKeyValid(ctx, a.room_code, ka)).toBe(true);
    expect(await spectatorKeyValid(ctx, a.room_code.toLowerCase(), ka)).toBe(true);
    expect(await spectatorKeyValid(ctx, a.room_code, kb)).toBe(false);
    expect(await spectatorKeyValid(ctx, b.room_code, ka)).toBe(false);
    for (const bad of [undefined, null, '', 'x', ka.toUpperCase(), ka.slice(1), `${ka}0`, '0'.repeat(64)]) expect(await spectatorKeyValid(ctx, a.room_code, bad)).toBe(false);
    expect(await spectatorKeyValid(ctx, 'ZZZZZZ', ka)).toBe(false); // sala inexistente: misma respuesta
  });

  it('desactivar el modo o regenerar la clave invalida el enlace al instante; solo el anfitrión puede regenerar', async () => {
    const { spectatorKeyValid, getSpectatorState } = await import('@/lib/services/spectator-service');
    const host = newHost();
    const { room_code: room } = await createGame(ctx, host, { name: 'Privada', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const k1 = (await getHostState(ctx, room, host)).spectator_token!;
    expect((await getSpectatorState(ctx, room, k1)).game.name).toBe('Privada');
    await act(ctx, room, host, { type: 'game.set_spectator', spectator_enabled: false });
    expect(await spectatorKeyValid(ctx, room, k1)).toBe(false);
    await expect(getSpectatorState(ctx, room, k1)).rejects.toMatchObject({ code: 'spectator_denied' });
    await act(ctx, room, host, { type: 'game.set_spectator', spectator_enabled: true });
    expect(await spectatorKeyValid(ctx, room, k1)).toBe(true);
    await expect(act(ctx, room, newHost(), { type: 'game.regenerate_spectator' })).rejects.toMatchObject({ code: expect.stringMatching(/not_host|game_not_found/) });
    expect(await spectatorKeyValid(ctx, room, k1)).toBe(true); // el intento ajeno no cambió nada
    await act(ctx, room, host, { type: 'game.regenerate_spectator' });
    const k2 = (await getHostState(ctx, room, host)).spectator_token!;
    expect(k2).not.toBe(k1);
    expect(await spectatorKeyValid(ctx, room, k1)).toBe(false);
    expect(await spectatorKeyValid(ctx, room, k2)).toBe(true);
    // Otro anfitrión no puede leer la clave
    await expect(getHostState(ctx, room, newHost())).rejects.toBeDefined();
  });
});
