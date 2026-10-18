import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
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
  limit(req, 'player-yield', `${clientIp(req.headers)}:${code.toUpperCase()}`, 90);
  const token = (await cookies()).get(playerCookieName(code))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  if (me) limit(req, 'player-yield-me', me, 60);
  const { snapshot, autoAwarded } = await yieldBid(ctx, code, token, await req.json().catch(() => null));
  if (autoAwarded) kickJobsAfter(ctx, snapshot.game.id);
  return json({ snapshot, player_id: me, auto_awarded: autoAwarded });
});
