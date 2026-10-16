import { describe, expect, it } from 'vitest';
import { formatEuros, parseEurosToCents } from '@/lib/domain/money';
import { computeHighlights, computeRanking } from '@/lib/domain/ranking';
import { actionSchema, createGameSchema } from '@/lib/domain/schemas';
import { rateLimit } from '@/lib/auth/rate-limit';
import { attachUrls } from '@/lib/services/urls';
import { getRuntimeMode } from '@/lib/config/env';
import type { Player } from '@/lib/domain/types';

const player = (name: string, balance: number, items: number, votes = 0): Player => ({
  id: name, name, color: '#ffffff', sort_order: 0, balance_cents: balance, votes,
  current_image_version_id: null, current_image: null, initial_image: null, generating: [],
  purchases: Array.from({ length: items }, (_, i) => ({ purchase_id: `${name}${i}`, item_id: `${i}`, name: `x${i}`, emoji: null, price_cents: 100 * (i + 1), created_at: '' })),
});

describe('dinero', () => {
  it('convierte texto a céntimos con precisión y rechaza entradas inválidas', () => {
    expect(parseEurosToCents('12')).toBe(1200);
    expect(parseEurosToCents('12,5')).toBe(1250);
    expect(parseEurosToCents('0.07')).toBe(7);
    expect(parseEurosToCents('1,234')).toBeNull();
    expect(parseEurosToCents('-3')).toBeNull();
    expect(parseEurosToCents('abc')).toBeNull();
    expect(formatEuros(1250)).toMatch(/12,50/);
    expect(formatEuros(2000)).toMatch(/20/);
  });
});

describe('clasificación explícita', () => {
  it('no hay clasificación sin regla y los empates comparten posición', () => {
    const ps = [player('A', 500, 1), player('B', 500, 2), player('C', 100, 3)];
    expect(computeRanking(ps, 'none')).toBeNull();
    const bal = computeRanking(ps, 'balance')!;
    expect(bal.map((e) => e.rank)).toEqual([1, 1, 3]);
    expect(computeRanking(ps, 'items')![0]!.player.name).toBe('C');
    expect(computeRanking([player('A', 0, 0, 2), player('B', 0, 0, 5)], 'votes')![0]!.player.name).toBe('B');
  });
  it('calcula destacados', () => {
    const h = computeHighlights({ players: [player('A', 0, 1), player('B', 0, 3)] });
    expect(h.mostItems).toEqual({ playerName: 'B', count: 3 });
    expect(h.mostExpensive).toEqual({ playerName: 'B', itemName: 'x2', priceCents: 300 });
  });
});

describe('validación de entradas', () => {
  it('rechaza importes no enteros, negativos y claves de idempotencia cortas', () => {
    const base = { type: 'auction.bid', auction_id: crypto.randomUUID(), player_id: crypto.randomUUID(), idempotency_key: 'abcdefgh' };
    expect(actionSchema.safeParse({ ...base, amount_cents: 150 }).success).toBe(true);
    expect(actionSchema.safeParse({ ...base, amount_cents: 1.5 }).success).toBe(false);
    expect(actionSchema.safeParse({ ...base, amount_cents: -1 }).success).toBe(false);
    expect(actionSchema.safeParse({ ...base, amount_cents: 150, idempotency_key: 'x' }).success).toBe(false);
  });
  it('aplica valores por defecto al crear partida (presupuesto 20 €)', () => {
    expect(createGameSchema.parse({ name: 'x' }).initial_budget_cents).toBe(2000);
    expect(createGameSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createGameSchema.safeParse({ name: 'x', players: Array.from({ length: 13 }, (_, i) => ({ name: `p${i}` })) }).success).toBe(false);
  });
});

describe('infraestructura', () => {
  it('limita peticiones por ventana', () => {
    const t = 1_000_000;
    expect([1, 2, 3].map(() => rateLimit('k-test', 2, 1000, t))).toEqual([true, true, false]);
    expect(rateLimit('k-test', 2, 1000, t + 1500)).toBe(true);
  });
  it('resuelve URLs de imagen sin tocar otros campos', () => {
    const out = attachUrls({ a: [{ storage_path: 'p/1.png', id: 'x' }], item: { image_path: 'i.png' } }, { publicUrl: (p) => `https://cdn/${p}` });
    expect(out.a[0]).toMatchObject({ id: 'x', url: 'https://cdn/p/1.png' });
    expect((out.item as { image_url?: string }).image_url).toBe('https://cdn/i.png');
  });
  it('detecta el modo de ejecución: supabase, demo o sin configurar (nunca demo en producción)', () => {
    const full = { NEXT_PUBLIC_SUPABASE_URL: 'u', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' };
    expect(getRuntimeMode({ ...full, NODE_ENV: 'production' } as never)).toBe('supabase');
    expect(getRuntimeMode({ NODE_ENV: 'development' } as never)).toBe('demo');
    expect(getRuntimeMode({ NODE_ENV: 'production' } as never)).toBe('unconfigured');
    expect(getRuntimeMode({ NODE_ENV: 'production', ALLOW_DEMO_MODE: 'true' } as never)).toBe('demo');
    expect(getRuntimeMode({ NODE_ENV: 'production', SUPABASE_SERVICE_ROLE_KEY: 's' } as never)).toBe('unconfigured');
  });
});
