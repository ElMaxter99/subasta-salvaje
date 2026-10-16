import { z } from 'zod';
import { THEME_PRESETS } from './themes';

const uuid = z.string().uuid();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Normaliza (NFKC), quita caracteres de control/formato invisibles y recorta: evita nombres «idénticos» con caracteres ocultos. */
const name = z
  .string()
  .transform((s) => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(40));
const idempotencyKey = z.string().min(8).max(100);
const cents = z.number().int().min(1).max(100_000_000);

export const PLAYER_COLORS = ['#fbbf24', '#a78bfa', '#2dd4bf', '#fb7185', '#60a5fa', '#a3e635', '#f97316', '#e879f9', '#38bdf8', '#facc15', '#34d399', '#f472b6'];

export const createGameSchema = z.object({
  name: z.string().trim().min(1).max(80),
  theme: z.string().trim().min(1).max(120).default('house'),
  initial_budget_cents: z.number().int().min(0).max(100_000_000).default(2000),
  min_bid_cents: z.number().int().min(1).max(100_000_000).default(100),
  ranking_rule: z.enum(['none', 'balance', 'items', 'votes']).default('none'),
  play_mode: z.enum(['host', 'mobile']).default('host'),
  image_mode: z.enum(['stickers', 'ai']).default('stickers'),
  players: z.array(z.object({ name, color: color.optional() })).max(12).default([]),
  /** Si se omite, se usa el catálogo de la plantilla de temática (o vacío si es temática libre). */
  items: z
    .array(z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).default(''), emoji: z.string().max(8).nullable().optional() }))
    .max(100)
    .optional(),
});
export type CreateGameInput = z.infer<typeof createGameSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  // Partida
  z.object({ type: z.literal('game.update'), name: z.string().trim().min(1).max(80).optional(), theme: z.string().trim().min(1).max(120).optional(), initial_budget_cents: z.number().int().min(0).max(100_000_000).optional(), min_bid_cents: z.number().int().min(1).max(100_000_000).optional(), ranking_rule: z.enum(['none', 'balance', 'items', 'votes']).optional() }),
  z.object({ type: z.literal('game.set_mode'), play_mode: z.enum(['host', 'mobile']) }),
  z.object({ type: z.literal('game.set_image_mode'), image_mode: z.enum(['stickers', 'ai']) }),
  z.object({ type: z.literal('game.set_auto_award'), enabled: z.boolean(), seconds: z.number().int().min(3).max(300) }),
  z.object({ type: z.literal('game.set_join_policy'), join_policy: z.enum(['open', 'slots', 'closed']) }),
  z.object({ type: z.literal('player.release'), player_id: uuid }),
  z.object({ type: z.literal('game.start') }),
  z.object({ type: z.literal('game.pause') }),
  z.object({ type: z.literal('game.resume') }),
  z.object({ type: z.literal('game.finish') }),
  // Jugadores
  z.object({ type: z.literal('player.add'), name, color: color.optional() }),
  z.object({ type: z.literal('player.update'), player_id: uuid, name: name.optional(), color: color.optional() }),
  z.object({ type: z.literal('player.remove'), player_id: uuid }),
  z.object({ type: z.literal('player.reorder'), ordered_ids: z.array(uuid).min(1).max(12) }),
  z.object({ type: z.literal('votes.adjust'), player_id: uuid, delta: z.union([z.literal(1), z.literal(-1)]) }),
  // Catálogo
  z.object({ type: z.literal('item.add'), name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).default(''), emoji: z.string().max(8).nullable().optional() }),
  z.object({ type: z.literal('item.update'), item_id: uuid, name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(500).optional(), emoji: z.string().max(8).nullable().optional() }),
  z.object({ type: z.literal('item.remove'), item_id: uuid }),
  z.object({ type: z.literal('item.reorder'), ordered_ids: z.array(uuid).min(1).max(200) }),
  // Subasta
  z.object({ type: z.literal('auction.announce'), item_id: uuid, wild_event: z.enum(['none', 'blind', 'double']).optional() }),
  z.object({ type: z.literal('auction.bid'), auction_id: uuid, player_id: uuid, amount_cents: cents, idempotency_key: idempotencyKey }),
  z.object({ type: z.literal('auction.undo_bid'), auction_id: uuid, bid_id: uuid }),
  z.object({ type: z.literal('auction.close'), auction_id: uuid }),
  z.object({ type: z.literal('auction.reopen'), auction_id: uuid }),
  z.object({ type: z.literal('auction.cancel'), auction_id: uuid }),
  z.object({ type: z.literal('auction.clear') }),
  z.object({ type: z.literal('auction.award'), auction_id: uuid, expected_winner_id: uuid, expected_price_cents: z.number().int().min(0).max(100_000_000), idempotency_key: idempotencyKey }),
  z.object({ type: z.literal('auction.undo_award'), purchase_id: uuid, reason: z.string().trim().max(200).optional(), idempotency_key: idempotencyKey }),
  // Eventos sorpresa y galería final
  z.object({ type: z.literal('game.set_wild'), chance_pct: z.number().int().min(0).max(100) }),
  z.object({ type: z.literal('wild.tax'), idempotency_key: idempotencyKey }),
  z.object({ type: z.literal('gallery.close') }),
  // Imágenes
  z.object({ type: z.literal('image.request_initial'), player_id: uuid }),
  z.object({ type: z.literal('image.request_item'), item_id: uuid }),
  z.object({ type: z.literal('image.retry'), job_id: uuid }),
  // Imagen inicial común: `scope_current` = jugadores actuales (por defecto sí), `scope_new` = jugadores que se unan después.
  z.object({ type: z.literal('image.set_initial_all'), catalog_id: z.string().regex(/^[a-z0-9_-]{1,40}$/), scope_current: z.boolean().default(true), scope_new: z.boolean().default(false) }),
  z.object({ type: z.literal('image.generate_initial_all'), scope_current: z.boolean().default(true), scope_new: z.boolean().default(false) }),
  z.object({ type: z.literal('image.clear_new_player_image') }),
  z.object({ type: z.literal('image.restore'), player_id: uuid, version_id: uuid }),
]);
export type GameAction = z.infer<typeof actionSchema>;

export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/);
export const themeIds = THEME_PRESETS.map((t) => t.id);

/** Acciones de los jugadores desde el móvil (se autentican con su token, no con la sesión del anfitrión). */
export const playerBidSchema = z.object({
  auction_id: uuid,
  amount_cents: cents,
  idempotency_key: idempotencyKey,
});
/** Voto de la galería final desde el móvil del jugador. */
export const galleryVoteSchema = z.object({ target_id: uuid });
export const joinSchema = z.union([
  z.object({ player_id: uuid }),
  z.object({ name: name }),
]);
