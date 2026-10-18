import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit, readJson, roomKey } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { galleryVote, identifyPlayer, playerCookieName } from '@/lib/services/play-service';

/** Voto de la galería final desde el móvil. La identidad sale de la cookie del jugador, nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'gallery-vote', `${clientIp(req.headers)}:${roomKey(code)}`, 60);
  limit(req, 'gallery-vote-room', roomKey(code), 600); // tope por sala: no depende de la IP (X-Forwarded-For es falsificable fuera de Vercel)
  const token = (await cookies()).get(playerCookieName(roomKey(code)))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  // Sin identidad válida se corta ANTES de la acción que bloquea la partida (un token falso no toma el bloqueo ni distingue salas).
  if (!me) throw new DomainError('not_player');
  limit(req, 'gallery-vote-me', me, 30);
  const snapshot = await galleryVote(ctx, code, token, await readJson(req));
  return json({ snapshot, player_id: me });
});
