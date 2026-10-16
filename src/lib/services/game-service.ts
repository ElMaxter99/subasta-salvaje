import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/domain/errors';
import { PLAYER_COLORS, actionSchema, createGameSchema, roomCodeSchema, type CreateGameInput, type GameAction } from '@/lib/domain/schemas';
import { getThemePreset } from '@/lib/domain/themes';
import { getImageProviderId, quotaConfig } from '@/lib/config/env';
import type { GameSummary, HostSnapshot, ImageUsage, PublicSnapshot } from '@/lib/domain/types';
import { validateImage } from '@/lib/ai/image-validation';
import { extensionForMime } from '@/lib/storage/types';
import type { AppContext } from './context';
import { catalogSceneSvg } from '@/lib/ai/catalog-scenes';
import { attachUrls } from './urls';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'>;

/** 7 MB: el proveedor de muestra incrusta la imagen en base64 y el resultado debe caber en 10 MB. */
export const UPLOAD_MAX_BYTES = 7 * 1024 * 1024;

function room(code: string): string {
  const parsed = roomCodeSchema.safeParse(code);
  if (!parsed.success) throw new DomainError('game_not_found');
  return parsed.data;
}

function parseOrThrow<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new DomainError('invalid_input');
  return result.data;
}

/** Crea la partida. Si no se envía catálogo se usa el de la plantilla de temática. */
export async function createGame(ctx: Ctx, hostId: string, rawInput: unknown): Promise<{ room_code: string }> {
  const input: CreateGameInput = parseOrThrow(createGameSchema.safeParse(rawInput));
  const items = input.items ?? (getThemePreset(input.theme) ?? getThemePreset('free'))!.items;
  const players = input.players.map((p, i) => ({ ...p, color: p.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length] }));
  const res = await ctx.db.rpc<{ room_code: string }>('ss_create_game', { ...input, players, items, host_id: hostId });
  return res;
}

export async function getPublicState(ctx: Ctx, roomCode: string): Promise<PublicSnapshot> {
  const snap = await ctx.db.rpc<PublicSnapshot>('ss_get_state', { room_code: room(roomCode), view: 'public' });
  return attachUrls(snap, ctx.storage);
}

export async function getHostState(ctx: Ctx, roomCode: string, hostId: string): Promise<HostSnapshot> {
  const snap = await ctx.db.rpc<HostSnapshot>('ss_get_state', { room_code: room(roomCode), view: 'host', host_id: hostId });
  const used = await ctx.db.rpc<{ game_used: number; day_used: number }>('ss_image_usage', { room_code: room(roomCode) });
  const provider = getImageProviderId();
  const q = quotaConfig();
  const limited = provider !== null && provider !== 'demo';
  const usage: ImageUsage = {
    provider: provider ?? 'demo',
    limited,
    game_used: limited ? used.game_used : 0,
    game_limit: limited ? q.perGame : null,
    day_used: limited ? used.day_used : 0,
    day_limit: limited ? q.perDay : null,
  };
  return { ...attachUrls(snap, ctx.storage), usage };
}

export async function listGames(ctx: Ctx, hostId: string): Promise<GameSummary[]> {
  return ctx.db.rpc<GameSummary[]>('ss_list_games', { host_id: hostId });
}

/** Traduce una acción validada a su RPC SQL. El servidor y la BD vuelven a validar permisos y reglas. */
function toRpc(action: GameAction): { fn: string; params: Record<string, unknown> } {
  const { type, ...rest } = action as GameAction & Record<string, unknown>;
  switch (type) {
    case 'game.update':
      return { fn: 'ss_update_game', params: rest };
    case 'game.set_auto_award':
      return { fn: 'ss_set_auto_award', params: rest };
    case 'game.set_join_policy':
      return { fn: 'ss_set_join_policy', params: rest };
    case 'game.set_mode':
      return { fn: 'ss_set_play_mode', params: rest };
    case 'player.release':
      return { fn: 'ss_release_player', params: rest };
    case 'game.start':
    case 'game.pause':
    case 'game.resume':
    case 'game.finish':
      return { fn: 'ss_game_status', params: { action: type.split('.')[1] } };
    case 'player.add':
    case 'player.update':
    case 'player.remove':
    case 'player.reorder':
      return { fn: 'ss_player_op', params: { op: type.split('.')[1], ...rest } };
    case 'votes.adjust':
      return { fn: 'ss_adjust_votes', params: rest };
    case 'item.add':
    case 'item.update':
    case 'item.remove':
    case 'item.reorder':
      return { fn: 'ss_item_op', params: { op: type.split('.')[1], ...rest } };
    case 'auction.announce':
      return { fn: 'ss_announce', params: rest };
    case 'auction.bid':
      return { fn: 'ss_place_bid', params: rest };
    case 'auction.undo_bid':
      return { fn: 'ss_undo_bid', params: rest };
    case 'auction.close':
    case 'auction.reopen':
    case 'auction.cancel':
    case 'auction.clear':
      return { fn: 'ss_auction_state', params: { action: type.split('.')[1], ...rest } };
    case 'auction.award':
      return { fn: 'ss_award', params: rest };
    case 'image.request_initial':
      return { fn: 'ss_request_image', params: { kind: 'initial', ...rest } };
    case 'image.request_item':
      return { fn: 'ss_request_image', params: { kind: 'item', ...rest } };
    case 'image.retry':
      return { fn: 'ss_retry_image_job', params: rest };
    case 'image.restore':
      return { fn: 'ss_restore_version', params: rest };
    default:
      throw new DomainError('invalid_action');
  }
}

export interface ActionResult {
  result: Record<string, unknown>;
  snapshot: HostSnapshot;
}

/** Ejecuta una acción del anfitrión y devuelve el estado actualizado. Publica el cambio. */
export async function performAction(ctx: Ctx, roomCode: string, hostId: string, rawAction: unknown): Promise<ActionResult> {
  const code = room(roomCode);
  const action = parseOrThrow(actionSchema.safeParse(rawAction));
  if (action.type === 'image.set_initial_all') return setInitialFromCatalog(ctx, code, hostId, action.catalog_id);
  const { fn, params } = toRpc(action);
  const result = await ctx.db.rpc<Record<string, unknown>>(fn, { ...params, room_code: code, host_id: hostId });
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

/** Sube una imagen inicial elegida por el anfitrión (valida tipo real y tamaño). */
export async function uploadInitialImage(
  ctx: Ctx,
  roomCode: string,
  hostId: string,
  playerId: string,
  bytes: Uint8Array,
): Promise<ActionResult> {
  const code = room(roomCode);
  const mime = (() => {
    try {
      return validateImage(bytes, { maxBytes: UPLOAD_MAX_BYTES });
    } catch (e) {
      throw new DomainError('invalid_input', (e as Error).message);
    }
  })();
  // Comprueba permisos ANTES de escribir en el almacenamiento.
  const before = await getHostState(ctx, code, hostId);
  const player = before.players.find((p) => p.id === playerId);
  if (!player) throw new DomainError('player_not_found');
  const storagePath = `games/${before.game.id}/players/${playerId}/${randomUUID()}.${extensionForMime(mime)}`;
  await ctx.storage.put(storagePath, bytes, mime);
  const result = await ctx.db.rpc<Record<string, unknown>>('ss_add_uploaded_version', {
    room_code: code,
    host_id: hostId,
    player_id: playerId,
    storage_path: storagePath,
    mime_type: mime,
    bytes: bytes.length,
  });
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

/** Aplica UNA misma imagen inicial a todos los jugadores (antes de empezar). El archivo se guarda una vez. */
async function storeAndSetForAll(ctx: Ctx, code: string, hostId: string, bytes: Uint8Array, mime: string, provider: string): Promise<ActionResult> {
  const before = await getHostState(ctx, code, hostId); // comprueba permisos antes de escribir
  if (before.game.status !== 'lobby') throw new DomainError('game_already_started');
  const storagePath = `games/${before.game.id}/shared/${randomUUID()}.${extensionForMime(mime)}`;
  await ctx.storage.put(storagePath, bytes, mime);
  const result = await ctx.db.rpc<Record<string, unknown>>('ss_set_initial_all', {
    room_code: code, host_id: hostId, storage_path: storagePath, mime_type: mime, bytes: bytes.length, provider,
  });
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

export async function setInitialFromCatalog(ctx: Ctx, code: string, hostId: string, catalogId: string): Promise<ActionResult> {
  const svg = catalogSceneSvg(catalogId);
  if (!svg) throw new DomainError('invalid_input', 'Esa imagen de la galería no existe.');
  return storeAndSetForAll(ctx, code, hostId, svg, 'image/svg+xml', 'catalog');
}

export async function uploadInitialImageForAll(ctx: Ctx, roomCode: string, hostId: string, bytes: Uint8Array): Promise<ActionResult> {
  let mime: string;
  try {
    mime = validateImage(bytes, { maxBytes: UPLOAD_MAX_BYTES });
  } catch (e) {
    throw new DomainError('invalid_input', (e as Error).message);
  }
  return storeAndSetForAll(ctx, room(roomCode), hostId, bytes, mime, 'upload');
}

/**
 * Adjudicación automática por tiempo: si la cuenta atrás de la subasta abierta venció, la adjudica y avisa.
 * Es idempotente y segura de llamar en cada lectura (la BD sólo toma el bloqueo cuando de verdad venció).
 * Devuelve true si adjudicó (el llamante debe procesar el trabajo de imagen generado).
 */
export async function autoAwardTick(ctx: Ctx, roomCode: string): Promise<boolean> {
  const code = room(roomCode);
  const r = await ctx.db.rpc<{ awarded?: boolean }>('ss_auto_award', { room_code: code });
  if (!r.awarded) return false;
  const snap = await ctx.db.rpc<{ version: number }>('ss_get_state', { room_code: code, view: 'public' });
  await ctx.publisher.publish(code, snap.version);
  return true;
}
