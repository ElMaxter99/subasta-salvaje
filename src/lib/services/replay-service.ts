import { roomCodeSchema } from '@/lib/domain/schemas';
import { DomainError } from '@/lib/domain/errors';
import type { ReplayRound } from '@/lib/domain/types';
import type { AppContext } from './context';

/** Rondas de la partida en orden (solo anfitrión, solo lectura). Las imágenes de cada casa salen de `versions` de la instantánea del anfitrión. */
export async function getReplay(ctx: Pick<AppContext, 'db'>, roomCode: string, hostId: string): Promise<ReplayRound[]> {
  const parsed = roomCodeSchema.safeParse(roomCode);
  if (!parsed.success) throw new DomainError('game_not_found');
  const r = await ctx.db.rpc<{ rounds: ReplayRound[] }>('ss_get_replay', { room_code: parsed.data, host_id: hostId });
  return r.rounds;
}
