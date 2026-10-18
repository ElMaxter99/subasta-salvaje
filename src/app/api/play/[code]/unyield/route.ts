import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit, readJson, roomKey } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';

import { identifyPlayer, unyieldBid, playerCookieName } from '@/lib/services/play-service';

export const maxDuration = 300;

/** Volver a pujar: retractarse de haber cedido (solo con la subasta abierta; ver ss_unyield_bid). La identidad sale de su cookie (token), nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  // Límite ANTES de consultar la BD, por IP y sala.
  limit(req, 'player-unyield', `${clientIp(req.headers)}:${roomKey(code)}`, 90);
  limit(req, 'player-unyield-room', roomKey(code), 600); // tope por sala: no depende de la IP (X-Forwarded-For es falsificable fuera de Vercel)
  const token = (await cookies()).get(playerCookieName(roomKey(code)))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  // Sin identidad válida se corta ANTES de la acción que bloquea la partida (un token falso no toma el bloqueo ni distingue salas).
  if (!me) throw new DomainError('not_player');
  limit(req, 'player-unyield-me', me, 60);
  const snapshot = await unyieldBid(ctx, code, token, await readJson(req));
  return json({ snapshot, player_id: me });
});
