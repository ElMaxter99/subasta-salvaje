import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRESETS, PRESET_IDS, planPreset } from '@/lib/domain/presets';
import { actionSchema, createGameSchema } from '@/lib/domain/schemas';
import { createGame, getHostState } from '@/lib/services/game-service';
import { act, makeCtx, newHost, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const newRoom = async (host: string, extra: Record<string, unknown> = {}) =>
  (await createGame(ctx, host, { name: 'Presets', players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }], ...extra })).room_code;

describe('presets · cálculo (módulo de dominio)', () => {
  it('hay cinco presets con descripción y el presupuesto sale entre 1,5 y 3,5 Ohros por ronda', () => {
    expect(PRESET_IDS).toEqual(['rapida', 'normal', 'larga', 'pocos', 'muchos']);
    for (const p of PRESETS) expect(p.desc.length).toBeGreaterThan(10);
    for (const id of PRESET_IDS) {
      const plan = planPreset(id, { status: 'new', items: 25 });
      const per = plan.settings.initial_budget_cents! / 100 / plan.settings.max_rounds!;
      expect(per).toBeGreaterThanOrEqual(1.5);
      expect(per).toBeLessThanOrEqual(3.5);
      expect(plan.settings.integer_bids).toBe(true);
    }
  });

  it('las rondas se recortan al catálogo (y el presupuesto con ellas) y avisa', () => {
    const big = planPreset('larga', { status: 'new', items: 25 });
    expect(big.settings.max_rounds).toBe(20);
    expect(big.settings.initial_budget_cents).toBe(4000);
    const small = planPreset('larga', { status: 'new', items: 12 });
    expect(small.settings.max_rounds).toBe(12);
    expect(small.settings.initial_budget_cents).toBe(2400);
    expect(small.notes.join(' ')).toMatch(/12 elementos/);
  });

  it('con la partida en curso: no baja de las rondas jugadas, no toca el presupuesto y respeta la subasta abierta', () => {
    const plan = planPreset('rapida', { status: 'active', items: 16, rounds_done: 10, auction_live: true, current: { max_rounds: 16, min_bid_cents: 200 } });
    expect(plan.settings.max_rounds).toBe(10);
    expect(plan.settings.initial_budget_cents).toBeUndefined();
    expect(plan.settings.min_bid_cents).toBeUndefined();
    expect(plan.skipped.map((s) => s.label)).toEqual(expect.arrayContaining(['Presupuesto inicial', 'Puja mínima']));
    expect(plan.notes.join(' ')).toMatch(/10 rondas/);
  });

  it('el máximo de jugadores nunca baja de los que ya hay; «muchos» abre la entrada solo en móviles y antes de empezar', () => {
    expect(planPreset('pocos', { status: 'lobby', items: 16, players: 5 }).settings.max_players).toBe(5);
    expect(planPreset('muchos', { status: 'lobby', items: 16, play_mode: 'mobile' }).settings.join_policy).toBe('open');
    expect(planPreset('muchos', { status: 'lobby', items: 16, play_mode: 'host' }).settings.join_policy).toBeUndefined();
    expect(planPreset('muchos', { status: 'active', items: 16, play_mode: 'mobile' }).settings.join_policy).toBeUndefined();
  });

  it('solo lista como cambio lo que difiere del estado actual', () => {
    const p = planPreset('normal', { status: 'new', items: 16, current: { initial_budget_cents: 2500, min_bid_cents: 100, max_rounds: 10, integer_bids: true, auto_award_enabled: true, auto_award_seconds: 20, auto_run_gap_seconds: 10, auto_run_idle_seconds: 60, wild_chance_pct: 10 } });
    expect(p.changes).toEqual([]);
  });

  it('el esquema acepta game.apply_preset y game.set_access (al menos un campo)', () => {
    expect(actionSchema.safeParse({ type: 'game.apply_preset', preset_id: 'rapida' }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'game.apply_preset', preset_id: 'xx' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'game.set_access' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'game.set_access', play_mode: 'mobile', join_policy: 'open' }).success).toBe(true);
    expect(createGameSchema.safeParse({ name: 'x', extras: { wild_chance_pct: 101 } }).success).toBe(false);
  });
});

describe('presets · aplicar a una partida', () => {
  it('en la sala de espera rellena todo de golpe y lo deja en la instantánea', async () => {
    const host = newHost();
    const room = await newRoom(host, { play_mode: 'mobile' });
    const before = await getHostState(ctx, room, host);
    const r = await act(ctx, room, host, { type: 'game.apply_preset', preset_id: 'muchos' });
    const g = r.snapshot.game;
    const rounds = Math.min(12, before.items.length);
    expect(g.max_rounds).toBe(rounds);
    expect(g.total_rounds).toBe(rounds);
    expect(g.initial_budget_cents).toBe(Math.round(rounds * 2.5) * 100);
    expect(g.max_players).toBe(10);
    expect(g.auto_award_enabled).toBe(true);
    expect(g.auto_award_seconds).toBe(20);
    expect(g.auto_run_gap_seconds).toBe(8);
    expect(g.auto_run_idle_seconds).toBe(45);
    expect(g.auto_run_enabled).toBe(false); // un preset nunca enciende la subasta automática
    expect(g.wild_chance_pct).toBe(10);
    expect(g.join_policy).toBe('open');
    expect(r.snapshot.players.every((p) => p.balance_cents === g.initial_budget_cents)).toBe(true);
    expect((r.result as { changes: unknown[] }).changes.length).toBeGreaterThan(0);
  });

  it('no enciende ni apaga una subasta automática en marcha', async () => {
    const host = newHost();
    const room = await newRoom(host);
    await act(ctx, room, host, { type: 'game.start' });
    await act(ctx, room, host, { type: 'game.set_auto_run', enabled: true, gap_seconds: 30, idle_seconds: 90 });
    const r = await act(ctx, room, host, { type: 'game.apply_preset', preset_id: 'rapida' });
    expect(r.snapshot.game.auto_run_enabled).toBe(true);
    expect(r.snapshot.game.auto_run_gap_seconds).toBe(6);
  });

  it('en curso: salta el presupuesto, recorta rondas a las jugadas y con subasta abierta no toca la puja mínima', async () => {
    const host = newHost();
    const room = await newRoom(host);
    await act(ctx, room, host, { type: 'game.start' });
    let s = await getHostState(ctx, room, host);
    const budget = s.game.initial_budget_cents;
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    const r = await act(ctx, room, host, { type: 'game.apply_preset', preset_id: 'pocos' });
    s = r.snapshot;
    expect(s.game.initial_budget_cents).toBe(budget);
    expect(s.game.min_bid_cents).toBe(100);
    expect(s.game.max_rounds).toBe(8);
    expect(s.game.max_players).toBe(3);
    const skipped = (r.result as { skipped: { label: string }[] }).skipped.map((x) => x.label);
    expect(skipped).toEqual(expect.arrayContaining(['Presupuesto inicial', 'Puja mínima']));
    expect(a.snapshot.auction).toBeTruthy();
  });

  it('SQL: ss_apply_settings es atómico: si un valor falla (rondas por debajo de las jugadas) no se aplica nada', async () => {
    const host = newHost();
    const room = await newRoom(host);
    await act(ctx, room, host, { type: 'game.start' });
    const s = await getHostState(ctx, room, host);
    const ann = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: ann.snapshot.auction!.id }).catch(() => undefined);
    const wildBefore = (await getHostState(ctx, room, host)).game.wild_chance_pct ?? 0;
    await expect(ctx.db.rpc('ss_apply_settings', { room_code: room, host_id: host, wild_chance_pct: 77, max_rounds: 0 })).rejects.toBeTruthy();
    expect((await getHostState(ctx, room, host)).game.wild_chance_pct ?? 0).toBe(wildBefore);
    await expect(ctx.db.rpc('ss_apply_settings', { room_code: room, host_id: host, initial_budget_cents: 500 })).rejects.toMatchObject({ code: 'game_already_started' });
    await expect(ctx.db.rpc('ss_apply_settings', { room_code: room, host_id: newHost(), wild_chance_pct: 5 })).rejects.toMatchObject({ code: 'not_host' });
  });

  it('SQL: las rondas ya jugadas siguen siendo suelo (error en español vía ss_set_game_rules)', async () => {
    const host = newHost();
    const room = await newRoom(host);
    await act(ctx, room, host, { type: 'game.start' });
    const s = await getHostState(ctx, room, host);
    const ann = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    await act(ctx, room, host, { type: 'auction.bid', auction_id: ann.snapshot.auction!.id, player_id: s.players[0]!.id, amount_cents: 100, idempotency_key: 'k-presets-1-abc' });
    await act(ctx, room, host, { type: 'auction.award', auction_id: ann.snapshot.auction!.id, expected_winner_id: s.players[0]!.id, expected_price_cents: 100, idempotency_key: 'k-presets-2-abc' });
    const s2 = await getHostState(ctx, room, host);
    const ann2 = await act(ctx, room, host, { type: 'auction.announce', item_id: s2.items[1]!.id });
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: ann2.snapshot.auction!.id });
    await expect(ctx.db.rpc('ss_apply_settings', { room_code: room, host_id: host, max_rounds: 1 })).rejects.toMatchObject({ code: 'rounds_below_played' });
    const r = await act(ctx, room, host, { type: 'game.apply_preset', preset_id: 'rapida' });
    expect(r.snapshot.game.max_rounds).toBe(8); // por encima de 2 jugadas
  });

  it('crear con extras (ritmo de un preset) los deja aplicados desde el primer momento', async () => {
    const host = newHost();
    const room = await newRoom(host, { max_rounds: 8, extras: { auto_award: { enabled: true, seconds: 15 }, auto_run: { gap_seconds: 6, idle_seconds: 40 }, wild_chance_pct: 10, preset_id: 'rapida' } });
    const g = (await getHostState(ctx, room, host)).game;
    expect(g).toMatchObject({ auto_award_enabled: true, auto_award_seconds: 15, auto_run_gap_seconds: 6, auto_run_idle_seconds: 40, wild_chance_pct: 10, auto_run_enabled: false, max_rounds: 8 });
  });
});

describe('rondas y catálogo', () => {
  it('al quitar elementos con el máximo de rondas al tope, el máximo se recorta al catálogo', async () => {
    const host = newHost();
    const room = await newRoom(host);
    const s = await getHostState(ctx, room, host);
    const n = s.items.length;
    expect(s.game.max_rounds).toBe(n);
    const r = await act(ctx, room, host, { type: 'item.remove', item_id: s.items[0]!.id });
    expect(r.result).toMatchObject({ rounds_adjusted: n - 1 });
    expect(r.snapshot.game.max_rounds).toBe(n - 1);
    expect(r.snapshot.game.total_rounds).toBe(n - 1);
    // Con un máximo por debajo del catálogo no se toca
    await act(ctx, room, host, { type: 'game.set_rules', max_rounds: 3 });
    const r2 = await act(ctx, room, host, { type: 'item.remove', item_id: r.snapshot.items[0]!.id });
    expect(r2.snapshot.game.max_rounds).toBe(3);
    expect(r2.result).not.toHaveProperty('rounds_adjusted');
    // Y subirlo por encima del catálogo sigue prohibido
    await expect(act(ctx, room, host, { type: 'game.set_rules', max_rounds: n + 5 })).rejects.toMatchObject({ code: 'rounds_above_catalog' });
  });

  it('al añadir elementos el máximo no cambia solo', async () => {
    const host = newHost();
    const room = await newRoom(host);
    const n = (await getHostState(ctx, room, host)).items.length;
    const r = await act(ctx, room, host, { type: 'item.add', name: 'Extra', description: '' });
    expect(r.snapshot.game.max_rounds).toBe(n);
    expect(r.snapshot.items.length).toBe(n + 1);
  });
});
