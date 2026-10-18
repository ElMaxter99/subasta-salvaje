import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit, readJson, roomKey } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { identifyPlayer, playerCookieName, sendReaction } from '@/lib/services/play-service';

/** Reacción (emoji) de un jugador desde su móvil. La identidad sale de su cookie (token), nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'player-react', `${clientIp(req.headers)}:${roomKey(code)}`, 120);
  limit(req, 'player-react-room', roomKey(code), 600); // tope por sala: no depende de la IP (X-Forwarded-For es falsificable fuera de Vercel)
  const token = (await cookies()).get(playerCookieName(roomKey(code)))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  // Sin identidad válida se corta ANTES de la acción que bloquea la partida (un token falso no toma el bloqueo ni distingue salas).
  if (!me) throw new DomainError('not_player');
  limit(req, 'player-react-me', me, 40);
  const snapshot = await sendReaction(ctx, code, token, await readJson(req));
  return json({ snapshot, player_id: me });
});
