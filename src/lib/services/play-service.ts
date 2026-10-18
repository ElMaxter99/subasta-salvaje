import { createHash, randomBytes } from 'node:crypto';
import { DomainError } from '@/lib/domain/errors';
import { galleryVoteSchema, joinSchema, playerBidSchema, reactionSchema, PLAYER_COLORS, roomCodeSchema } from '@/lib/domain/schemas';
import type { PublicSnapshot } from '@/lib/domain/types';
import type { AppContext } from './context';
import { getPublicState } from './game-service';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'>;

/** Nombre de la cookie de identidad de jugador (una por sala, para poder estar en varias a la vez). */
export const playerCookieName = (roomCode: string) => `ss_p_${roomCode.toUpperCase()}`;

export const newPlayerToken = (): string => randomBytes(32).toString('base64url');
/** En la BD sólo se guarda el hash: un volcado de la tabla no permite hacerse pasar por un jugador. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function room(code: string): string {
  const r = roomCodeSchema.safeParse(code);
  if (!r.success) throw new DomainError('game_not_found');
  return r.data;
}

async function publishAfter(ctx: Ctx, code: string): Promise<PublicSnapshot> {
  const snapshot = await getPublicState(ctx, code);
  await ctx.publisher.publish(code, snapshot.version);
  return snapshot;
}

/** Devuelve el player_id al que pertenece el token, o null. */
export async function identifyPlayer(ctx: Ctx, roomCode: string, token: string | undefined | null): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const r = await ctx.db.rpc<{ player_id: string | null }>('ss_identify_player', { room_code: room(roomCode), token_hash: hashToken(token) });
  return r.player_id;
}

/** Unirse: reclamar una casilla libre (`player_id`) o crear un jugador nuevo (`name`, sólo en la sala de espera). */
export async function joinGame(ctx: Ctx, roomCode: string, rawBody: unknown, currentToken?: string | null): Promise<{ token: string; player_id: string; snapshot: PublicSnapshot }> {
  const parsed = joinSchema.safeParse(rawBody);
  if (!parsed.success) throw new DomainError('invalid_input');
  const code = room(roomCode);
  // Un mismo móvil no puede acaparar casillas: si ya está identificado en esta sala debe salir antes.
  if (await identifyPlayer(ctx, code, currentToken)) throw new DomainError('already_joined');
  const token = newPlayerToken();
  const token_hash = hashToken(token);
  let res: { player_id: string };
  if ('player_id' in parsed.data) {
    res = await ctx.db.rpc('ss_claim_player', { room_code: code, player_id: parsed.data.player_id, token_hash });
  } else {
    const state = await getPublicState(ctx, code);
    const color = PLAYER_COLORS.find((c) => !state.players.some((p) => p.color === c)) ?? PLAYER_COLORS[0];
    res = await ctx.db.rpc('ss_join_new_player', { room_code: code, name: parsed.data.name, color, token_hash });
  }
  return { token, player_id: res.player_id, snapshot: await publishAfter(ctx, code) };
}

export async function playerBid(ctx: Ctx, roomCode: string, token: string | undefined | null, rawBody: unknown): Promise<PublicSnapshot> {
  return (await playerBidResult(ctx, roomCode, token, rawBody)).snapshot;
}

/** Igual que playerBid pero indica si la puja provocó una adjudicación automática instantánea. */
export async function playerBidResult(ctx: Ctx, roomCode: string, token: string | undefined | null, rawBody: unknown): Promise<{ snapshot: PublicSnapshot; autoAwarded: boolean }> {
  const parsed = playerBidSchema.safeParse(rawBody);
  if (!parsed.success) throw new DomainError('invalid_input');
  if (!token) throw new DomainError('not_player');
  const code = room(roomCode);
  const res = await ctx.db.rpc<{ auto_awarded?: boolean }>('ss_player_bid', { ...parsed.data, room_code: code, token_hash: hashToken(token) });
  return { snapshot: await publishAfter(ctx, code), autoAwarded: Boolean(res.auto_awarded) };
}

export async function leaveGame(ctx: Ctx, roomCode: string, token: string | undefined | null): Promise<void> {
  // Sin identidad válida no se toca la BD con bloqueos ni se publica nada (evita amplificación anónima).
  if (!(await identifyPlayer(ctx, roomCode, token))) return;
  const code = room(roomCode);
  const res = await ctx.db.rpc<{ replay?: boolean }>('ss_release_player', { room_code: code, token_hash: hashToken(token!) });
  if (!res.replay) await publishAfter(ctx, code);
}

/** Voto de la galería final (un voto por jugador, se puede cambiar mientras no se cierre la votación). */
export async function galleryVote(ctx: Ctx, roomCode: string, token: string | undefined | null, rawBody: unknown): Promise<PublicSnapshot> {
  const parsed = galleryVoteSchema.safeParse(rawBody);
  if (!parsed.success) throw new DomainError('invalid_input');
  if (!token) throw new DomainError('not_player');
  const code = room(roomCode);
  await ctx.db.rpc('ss_gallery_vote', { target_id: parsed.data.target_id, room_code: code, token_hash: hashToken(token) });
  return publishAfter(ctx, code);
}

/** Reacción con emoji desde el móvil (lista cerrada, con límites en SQL). La identidad sale del token, nunca del cuerpo. */
export async function sendReaction(ctx: Ctx, roomCode: string, token: string | undefined | null, rawBody: unknown): Promise<PublicSnapshot> {
  const parsed = reactionSchema.safeParse(rawBody);
  if (!parsed.success) throw new DomainError('invalid_input');
  if (!token) throw new DomainError('not_player');
  const code = room(roomCode);
  await ctx.db.rpc('ss_send_reaction', { emoji: parsed.data.emoji, room_code: code, token_hash: hashToken(token) });
  return publishAfter(ctx, code);
}
