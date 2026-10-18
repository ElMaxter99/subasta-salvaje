import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { identifyPlayer, playerCookieName, sendReaction } from '@/lib/services/play-service';

/** Reacción (emoji) de un jugador desde su móvil. La identidad sale de su cookie (token), nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'player-react', `${clientIp(req.headers)}:${code.toUpperCase()}`, 120);
  const token = (await cookies()).get(playerCookieName(code))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  if (me) limit(req, 'player-react-me', me, 40);
  const snapshot = await sendReaction(ctx, code, token, await req.json().catch(() => null));
  return json({ snapshot, player_id: me });
});
