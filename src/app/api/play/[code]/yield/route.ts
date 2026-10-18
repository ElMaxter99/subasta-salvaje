import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit, readJson, roomKey } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { kickJobsAfter } from '@/lib/services/kick';
import { identifyPlayer, yieldBid, playerCookieName } from '@/lib/services/play-service';

export const maxDuration = 300;

/** Ceder la puja: el jugador deja de pujar por el elemento en curso. La identidad sale de su cookie (token), nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  // Límite ANTES de consultar la BD, por IP y sala.
  limit(req, 'player-yield', `${clientIp(req.headers)}:${roomKey(code)}`, 90);
  limit(req, 'player-yield-room', roomKey(code), 600); // tope por sala: no depende de la IP (X-Forwarded-For es falsificable fuera de Vercel)
  const token = (await cookies()).get(playerCookieName(roomKey(code)))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  // Sin identidad válida se corta ANTES de la acción que bloquea la partida (un token falso no toma el bloqueo ni distingue salas).
  if (!me) throw new DomainError('not_player');
  limit(req, 'player-yield-me', me, 60);
  const { snapshot, autoAwarded } = await yieldBid(ctx, code, token, await readJson(req));
  if (autoAwarded) kickJobsAfter(ctx, snapshot.game.id);
  return json({ snapshot, player_id: me, auto_awarded: autoAwarded });
});
