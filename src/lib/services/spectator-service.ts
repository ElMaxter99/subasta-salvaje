import { DomainError } from '@/lib/domain/errors';
import { getPublicState } from './game-service';
import type { AppContext } from './context';
import type { PublicSnapshot } from '@/lib/domain/types';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'>;

/** Formato de la clave de espectador: 64 hex en minúsculas (dos UUID v4 sin guiones). Cualquier otra cosa se rechaza sin tocar la BD. */
export const SPECTATOR_KEY_RE = /^[a-f0-9]{64}$/;

/** ¿La clave abre esta partida? Falso si la clave es incorrecta, el modo espectador está desactivado o la sala no existe (misma respuesta). */
export async function spectatorKeyValid(ctx: Ctx, roomCode: string, key: string | null | undefined): Promise<boolean> {
  if (!key || !SPECTATOR_KEY_RE.test(key)) return false;
  const r = await ctx.db.rpc<{ ok: boolean }>('ss_spectator_check', { room_code: roomCode.trim().toUpperCase(), token: key });
  return r.ok === true;
}

/** Instantánea pública para un espectador con clave válida; si no, `spectator_denied` (403). */
export async function getSpectatorState(ctx: Ctx, roomCode: string, key: string | null | undefined): Promise<PublicSnapshot> {
  if (!(await spectatorKeyValid(ctx, roomCode, key))) throw new DomainError('spectator_denied');
  return getPublicState(ctx, roomCode);
}
