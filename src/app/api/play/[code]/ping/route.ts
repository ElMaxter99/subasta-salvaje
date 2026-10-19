import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit, readJson, roomKey } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { hashToken, playerCookieName, playerPing } from '@/lib/services/play-service';

export const maxDuration = 30;

/**
 * Latido del móvil (cada ~15 s con la pestaña visible) y aviso de salida `{ "bye": true }` (navigator.sendBeacon en pagehide).
 * La identidad sale de la cookie (token), nunca del cuerpo. Una sola consulta a la BD; sin cookie ni se consulta.
 * Límites: ≈ 4 latidos/min por móvil; el tope por IP+sala admite muchos móviles tras la misma wifi (NAT).
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'player-ping', `${clientIp(req.headers)}:${roomKey(code)}`, 300);
  limit(req, 'player-ping-room', roomKey(code), 1500); // tope por sala: no depende de la IP (X-Forwarded-For es falsificable fuera de Vercel)
  const token = (await cookies()).get(playerCookieName(roomKey(code)))?.value;
  if (!token) throw new DomainError('not_player');
  limit(req, 'player-ping-me', hashToken(token).slice(0, 24), 30);
  const body = await readJson(req);
  const r = await playerPing(await getContext(), code, token, body);
  return json({ ok: true, retired: r.retired });
});
