import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/domain/errors';
import { PLAYER_COLORS, actionSchema, createGameSchema, roomCodeSchema, type CreateGameInput, type GameAction } from '@/lib/domain/schemas';
import { getThemePreset } from '@/lib/domain/themes';
import { planPreset, presetContextFromSnapshot, type PresetId } from '@/lib/domain/presets';
import { getImageProviderId } from '@/lib/config/env';
import { effectiveQuota, effectiveTtlHours, getSettings } from './settings';
import type { GameSummary, HostSnapshot, ImageUsage, PublicSnapshot } from '@/lib/domain/types';
import { validateImage } from '@/lib/ai/image-validation';
import { normalizeImage, NormalizeError, type ImageKind } from '@/lib/images/normalize';
import { extensionForMime } from '@/lib/storage/types';
import type { AppContext } from './context';
import { catalogSceneSvg } from '@/lib/ai/catalog-scenes';
import { attachUrls } from './urls';
import { redactSecrets } from '@/lib/security/redact';
import { isExternalRef, isHostedImage, mimeFromExtension } from '@/lib/storage/hosted';

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

/** La IA exige: proveedor configurado, interruptor global del superadmin encendido y permiso de ese anfitrión. */
async function assertAiAllowed(ctx: Ctx, hostId: string): Promise<void> {
  if (!getImageProviderId() || !(await getSettings(ctx.db)).ai_enabled) throw new DomainError('ai_not_available');
  const r = await ctx.db.rpc<{ allowed: boolean }>('ss_host_ai_allowed', { host_id: hostId });
  if (!r.allowed) throw new DomainError('ai_disabled_for_user');
}

/** Crea la partida. Si no se envía catálogo se usa el de la plantilla de temática. */
export async function createGame(ctx: Ctx, hostId: string, rawInput: unknown): Promise<{ room_code: string }> {
  const input: CreateGameInput = parseOrThrow(createGameSchema.safeParse(rawInput));
  if (input.image_mode === 'ai') await assertAiAllowed(ctx, hostId);
  await purgeExpiredGames(ctx).catch(() => undefined);
  const items = input.items ?? (getThemePreset(input.theme) ?? getThemePreset('free'))!.items;
  const players = input.players.map((p, i) => ({ ...p, color: p.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length] }));
  const res = await ctx.db.rpc<{ room_code: string }>('ss_create_game', { ...input, players, items, host_id: hostId });
  // Estadísticas: de qué partida del sistema sale (informativo; un fallo aquí nunca impide crear la partida).
  if (input.template_slug) await ctx.db.rpc('ss_set_game_template', { room_code: res.room_code, host_id: hostId, template_slug: input.template_slug }).catch(() => undefined);
  // Reglas: máximo de rondas (por defecto, el tamaño del catálogo) y pujas enteras.
  await ctx.db.rpc('ss_set_game_rules', { room_code: res.room_code, host_id: hostId, max_rounds: input.max_rounds ?? items.length, integer_bids: input.integer_bids });
  // Ajustes de ritmo (adjudicación/subasta automática, sorpresas, entrada): los valida SQL; un fallo aquí no debe dejar la partida a medias.
  const extras = input.extras;
  if (extras && (extras.auto_award || extras.auto_run || extras.wild_chance_pct !== undefined || extras.join_policy)) {
    await ctx.db.rpc('ss_apply_settings', { room_code: res.room_code, host_id: hostId, ...extras });
  }
  return res;
}

export async function getPublicState(ctx: Ctx, roomCode: string): Promise<PublicSnapshot> {
  const snap = await ctx.db.rpc<PublicSnapshot>('ss_get_state', { room_code: room(roomCode), view: 'public' });
  return attachUrls(snap, ctx.storage);
}

export async function getHostState(ctx: Ctx, roomCode: string, hostId: string): Promise<HostSnapshot> {
  const snap = await ctx.db.rpc<HostSnapshot>('ss_get_state', { room_code: room(roomCode), view: 'host', host_id: hostId });
  const used = await ctx.db.rpc<{ game_used: number; day_used: number }>('ss_image_usage', { room_code: room(roomCode) });
  const settings = await getSettings(ctx.db);
  const provider = settings.ai_enabled ? getImageProviderId() : null;
  const q = effectiveQuota(settings);
  // Sólo las partidas en modo IA consumen (y tienen) cuota; el modo pegatinas es local y gratuito.
  const limited = provider !== null && snap.game.image_mode === 'ai';
  const usage: ImageUsage = {
    provider: limited ? provider! : 'demo',
    limited,
    game_used: limited ? used.game_used : 0,
    game_limit: limited ? q.perGame : null,
    day_used: limited ? used.day_used : 0,
    day_limit: limited ? q.perDay : null,
  };
  const activity = await ctx.db.rpc<{ updated_at: string | null }>('ss_game_activity', { room_code: room(roomCode) });
  const expires_at = activity.updated_at ? new Date(Date.parse(activity.updated_at) + effectiveTtlHours(settings) * 3600_000).toISOString() : null;
  // Clave secreta del enlace de espectador: solo la ve el anfitrión (nunca va en la instantánea pública).
  const spectator = await ctx.db.rpc<{ token: string }>('ss_spectator_token', { room_code: room(roomCode), host_id: hostId });
  return { ...attachUrls(snap, ctx.storage), usage, expires_at, spectator_token: spectator.token };
}

export async function listGames(ctx: Ctx, hostId: string): Promise<GameSummary[]> {
  await purgeExpiredGames(ctx).catch(() => undefined); // limpieza oportunista (no depende del cron)
  return ctx.db.rpc<GameSummary[]>('ss_list_games', { host_id: hostId });
}

/** Traduce una acción validada a su RPC SQL. El servidor y la BD vuelven a validar permisos y reglas. */
function toRpc(action: GameAction): { fn: string; params: Record<string, unknown> } {
  const { type, ...rest } = action as GameAction & Record<string, unknown>;
  switch (type) {
    case 'game.update':
      return { fn: 'ss_update_game', params: rest };
    case 'image.generate_initial_all':
      return { fn: 'ss_apply_initial_image', params: { kind: 'generate', scope_current: rest.scope_current, scope_new: rest.scope_new } };
    case 'image.clear_new_player_image':
      return { fn: 'ss_apply_initial_image', params: { kind: 'clear', scope_current: false, scope_new: true } };
    case 'game.set_image_mode':
      return { fn: 'ss_set_image_mode', params: rest };
    case 'game.set_auto_award':
      return { fn: 'ss_set_auto_award', params: rest };
    case 'game.set_wild':
      return { fn: 'ss_set_wild', params: rest };
    case 'wild.tax':
      return { fn: 'ss_wild_tax', params: rest };
    case 'auction.undo_award':
      return { fn: 'ss_undo_award', params: rest };
    case 'gallery.close':
      return { fn: 'ss_gallery_set', params: {} };
    case 'game.set_rules':
      return { fn: 'ss_set_game_rules', params: rest };
    case 'game.set_sound':
      return { fn: 'ss_set_sound', params: rest };
    case 'game.set_spectator':
      return { fn: 'ss_set_spectator', params: rest };
    case 'game.regenerate_spectator':
      return { fn: 'ss_spectator_regenerate', params: rest };
    case 'game.set_auto_run':
      return { fn: 'ss_set_auto_run', params: rest };
    case 'game.set_access':
      return { fn: 'ss_apply_settings', params: rest };
    case 'game.set_join_policy':
      return { fn: 'ss_set_join_policy', params: rest };
    case 'game.set_mode':
      return { fn: 'ss_set_play_mode', params: rest };
    case 'player.release':
      return { fn: 'ss_release_player', params: rest };
    case 'player.retire':
      return { fn: 'ss_player_retire', params: rest };
    case 'player.unretire':
      return { fn: 'ss_player_unretire', params: rest };
    case 'game.reset':
      return { fn: 'ss_reset_game', params: {} };
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
    case 'player.set_budget':
      return { fn: 'ss_player_set_budget', params: rest };
    case 'player.set_team':
      return { fn: 'ss_player_set_team', params: rest };
    case 'votes.adjust':
      return { fn: 'ss_adjust_votes', params: rest };
    case 'item.add':
    case 'item.update':
    case 'item.remove':
    case 'item.reorder':
      return { fn: 'ss_item_op', params: { op: type.split('.')[1], ...rest } };
    case 'auction.announce':
      return { fn: 'ss_announce', params: rest };
    case 'auction.announce_random':
      return { fn: 'ss_announce_random', params: rest };
    case 'auction.bid':
      return { fn: 'ss_place_bid', params: rest };
    case 'auction.undo_bid':
      return { fn: 'ss_undo_bid', params: rest };
    case 'auction.close':
    case 'auction.reopen':
    case 'auction.cancel':
    case 'auction.clear':
      return { fn: 'ss_auction_state', params: { action: type.split('.')[1], ...rest } };
    case 'auction.grace':
      return { fn: 'ss_auction_grace', params: rest };
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
    case 'image.regenerate':
      return { fn: 'ss_regenerate_image', params: rest };
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
  if (action.type === 'game.set_image_mode' && action.image_mode === 'ai') await assertAiAllowed(ctx, hostId);
  if (action.type === 'item.clear_image') return setItemImage(ctx, code, hostId, action.item_id, null);
  if (action.type === 'image.set_initial_all') return setInitialFromCatalog(ctx, code, hostId, action.catalog_id, { current: action.scope_current, new: action.scope_new });;
  if (action.type === 'game.apply_preset') return applyPreset(ctx, code, hostId, action.preset_id);
  const { fn, params } = toRpc(action);
  const result = await ctx.db.rpc<Record<string, unknown>>(fn, { ...params, room_code: code, host_id: hostId });
  if (action.type === 'game.reset') {
    // Las referencias https (fotos alojadas en nuestro repositorio) nunca se borran: solo lo generado y guardado en Storage.
    const paths = ((result.storage_paths as string[] | undefined) ?? []).filter((p) => p.startsWith('games/') && !isExternalRef(p));
    delete result.storage_paths;
    try {
      await ctx.storage.deleteFiles(paths);
    } catch (e) {
      console.error('[reset] no se pudieron borrar algunos archivos de', code, redactSecrets((e as Error).message));
    }
  }
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

/**
 * Aplica un preset: calcula los valores con `planPreset` (catálogo y estado reales de la partida) y los envía a
 * `ss_apply_settings`, que los valida con las funciones de siempre y lo hace todo o nada.
 */
async function applyPreset(ctx: Ctx, code: string, hostId: string, presetId: PresetId): Promise<ActionResult> {
  const snap = await getHostState(ctx, code, hostId);
  const plan = planPreset(presetId, presetContextFromSnapshot(snap));
  const result = await ctx.db.rpc<Record<string, unknown>>('ss_apply_settings', { ...plan.settings, preset_id: presetId, room_code: code, host_id: hostId });
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result: { ...result, changes: plan.changes, skipped: plan.skipped, notes: plan.notes }, snapshot };
}

/** Valida (tipo real y tamaño) y lleva la imagen al formato interno (WebP, tamaño y peso acotados, sin metadatos). */
async function toInternalImage(bytes: Uint8Array, kind: ImageKind): Promise<{ bytes: Uint8Array; mime: string }> {
  try {
    validateImage(bytes, { maxBytes: UPLOAD_MAX_BYTES });
    const n = await normalizeImage(bytes, kind);
    return { bytes: n.bytes, mime: n.mime };
  } catch (e) {
    throw new DomainError('invalid_input', e instanceof NormalizeError || e instanceof Error ? e.message : 'Imagen no válida');
  }
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
  const img = await toInternalImage(bytes, 'scene');
  bytes = img.bytes;
  const mime = img.mime;
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

/**
 * Pone (o quita, con `bytes = null`) la foto de un elemento del catálogo. Esa foto se usa como referencia cuando alguien gana el
 * elemento: la IA la mezcla con la imagen de la casa del ganador. Sólo el anfitrión propietario; valida tipo real y tamaño.
 */
async function setItemImage(ctx: Ctx, code: string, hostId: string, itemId: string, bytes: Uint8Array | null): Promise<ActionResult> {
  let mime = '';
  if (bytes) {
    const img = await toInternalImage(bytes, 'item');
    bytes = img.bytes;
    mime = img.mime;
  }
  const before = await getHostState(ctx, code, hostId); // comprueba permisos ANTES de escribir en el almacenamiento
  if (!before.items.some((i) => i.id === itemId)) throw new DomainError('item_not_found');
  const storagePath = bytes ? `games/${before.game.id}/items/${itemId}/${randomUUID()}.${extensionForMime(mime)}` : null;
  if (bytes && storagePath) await ctx.storage.put(storagePath, bytes, mime);
  const result = await ctx.db.rpc<{ old_path: string | null }>('ss_set_item_image', { room_code: code, host_id: hostId, item_id: itemId, storage_path: storagePath });
  if (result.old_path && !isExternalRef(result.old_path)) await ctx.storage.deletePrefix(result.old_path).catch(() => undefined); // la foto anterior ya no hace falta (nunca se borra nada del repositorio de fotos)
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

/** Foto de un elemento YA alojada en el repositorio de fotos: se usa su enlace, sin descargarla ni copiarla. */
export async function setItemImageFromHosted(ctx: Ctx, roomCode: string, hostId: string, itemId: string, url: string): Promise<ActionResult> {
  if (!isHostedImage(url)) throw new DomainError('invalid_input', 'La imagen no está en el repositorio de fotos.');
  const code = room(roomCode);
  const result = await ctx.db.rpc<{ old_path: string | null }>('ss_set_item_image', { room_code: code, host_id: hostId, item_id: itemId, storage_path: url });
  if (result.old_path && !isExternalRef(result.old_path)) await ctx.storage.deletePrefix(result.old_path).catch(() => undefined);
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

/** Imagen inicial YA alojada en el repositorio de fotos: se aplica por enlace (sin copiarla) a los jugadores actuales y a los futuros. */
export async function setInitialFromHosted(ctx: Ctx, roomCode: string, hostId: string, url: string, scope: InitialScope = { current: true, new: true }): Promise<ActionResult> {
  if (!isHostedImage(url)) throw new DomainError('invalid_input', 'La imagen no está en el repositorio de fotos.');
  const code = room(roomCode);
  const before = await getHostState(ctx, code, hostId);
  if (before.game.status !== 'lobby') throw new DomainError('game_already_started');
  const result = await ctx.db.rpc<Record<string, unknown>>('ss_apply_initial_image', {
    room_code: code, host_id: hostId, kind: 'file', storage_path: url, mime_type: mimeFromExtension(url), bytes: null, provider: 'template',
    scope_current: scope.current, scope_new: scope.new,
  });
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

export async function uploadItemImage(ctx: Ctx, roomCode: string, hostId: string, itemId: string, bytes: Uint8Array): Promise<ActionResult> {
  return setItemImage(ctx, room(roomCode), hostId, itemId, bytes);
}

/** Aplica UNA misma imagen inicial a todos los jugadores (antes de empezar). El archivo se guarda una vez. */
export interface InitialScope {
  /** Aplicar a los jugadores que ya están en la partida. */
  current: boolean;
  /** Guardarla como imagen inicial de los que se unan después (móvil o añadidos en el panel). */
  new: boolean;
}

async function storeAndSetForAll(ctx: Ctx, code: string, hostId: string, bytes: Uint8Array, mime: string, provider: string, scope: InitialScope): Promise<ActionResult> {
  const before = await getHostState(ctx, code, hostId); // comprueba permisos antes de escribir
  if (before.game.status !== 'lobby') throw new DomainError('game_already_started');
  const storagePath = `games/${before.game.id}/shared/${randomUUID()}.${extensionForMime(mime)}`;
  await ctx.storage.put(storagePath, bytes, mime);
  const result = await ctx.db.rpc<Record<string, unknown>>('ss_apply_initial_image', {
    room_code: code, host_id: hostId, kind: 'file', storage_path: storagePath, mime_type: mime, bytes: bytes.length, provider,
    scope_current: scope.current, scope_new: scope.new,
  });
  const snapshot = await getHostState(ctx, code, hostId);
  await ctx.publisher.publish(code, snapshot.version);
  return { result, snapshot };
}

export async function setInitialFromCatalog(ctx: Ctx, code: string, hostId: string, catalogId: string, scope: InitialScope = { current: true, new: false }): Promise<ActionResult> {
  const svg = catalogSceneSvg(catalogId);
  if (!svg) throw new DomainError('invalid_input', 'Esa imagen de la galería no existe.');
  return storeAndSetForAll(ctx, code, hostId, svg, 'image/svg+xml', 'catalog', scope);
}

export async function uploadInitialImageForAll(ctx: Ctx, roomCode: string, hostId: string, bytes: Uint8Array, scope: InitialScope = { current: true, new: false }): Promise<ActionResult> {
  const img = await toInternalImage(bytes, 'scene');
  return storeAndSetForAll(ctx, room(roomCode), hostId, img.bytes, img.mime, 'upload', scope);
}

/**
 * Adjudicación automática por tiempo: si la cuenta atrás de la subasta abierta venció, la adjudica y avisa.
 * Es idempotente y segura de llamar en cada lectura (la BD sólo toma el bloqueo cuando de verdad venció).
 * Devuelve true si adjudicó (el llamante debe procesar el trabajo de imagen generado).
 */
export async function autoAwardTick(ctx: Ctx, roomCode: string): Promise<boolean> {
  const code = room(roomCode);
  const r = await ctx.db.rpc<{ awarded?: boolean }>('ss_auto_award', { room_code: code });
  // Avance automático: fin por rondas agotadas, subasta automática (anunciar el siguiente) y saltar subastas sin pujas.
  const run = await ctx.db.rpc<{ changed?: boolean }>('ss_auto_run_tick', { room_code: code });
  // Barrido de presencia: marca como desconectados (y lo registra una vez) a los móviles sin latido.
  const presence = await ctx.db.rpc<{ changed?: boolean }>('ss_presence_sweep', { room_code: code });
  if (!r.awarded && !run.changed && !presence.changed) return false;
  const snap = await ctx.db.rpc<{ version: number }>('ss_get_state', { room_code: code, view: 'public' });
  await ctx.publisher.publish(code, snap.version);
  return Boolean(r.awarded);
}

/** Borra una partida y sus archivos de Storage. Sólo el anfitrión propietario. Irreversible. */
export async function deleteGame(ctx: Ctx, roomCode: string, hostId: string): Promise<void> {
  const res = await ctx.db.rpc<{ game_id: string }>('ss_delete_game', { room_code: room(roomCode), host_id: hostId });
  await removeGameFiles(ctx, res.game_id);
  await ctx.publisher.publish(room(roomCode), Number.MAX_SAFE_INTEGER); // los clientes releen y ven que ya no existe
}

async function removeGameFiles(ctx: Ctx, gameId: string): Promise<void> {
  try {
    await ctx.storage.deletePrefix(`games/${gameId}/`);
  } catch (e) {
    // La BD ya no tiene la partida: un fallo de Storage sólo deja archivos huérfanos (se registra).
    console.error('[purge] no se pudieron borrar los archivos de', gameId, redactSecrets((e as Error).message));
  }
}

/** Borra las partidas sin actividad desde hace más de GAME_TTL_HOURS (12 por defecto). Idempotente y segura en paralelo. */
export async function purgeExpiredGames(ctx: Ctx, opts: { limit?: number } = {}): Promise<{ deleted: number }> {
  const hours = effectiveTtlHours(await getSettings(ctx.db));
  const expired = await ctx.db.rpc<{ id: string; room_code: string }[]>('ss_expired_games', { hours, limit: opts.limit ?? 5 });
  let deleted = 0;
  for (const g of expired) {
    const r = await ctx.db.rpc<{ deleted: boolean; game_id?: string }>('ss_purge_expired_game', { game_id: g.id, hours });
    if (!r.deleted) continue;
    deleted++;
    await removeGameFiles(ctx, g.id);
  }
  return { deleted };
}
