import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { getContext } from '@/lib/services/context';
import { identifyPlayer, playerBid, playerCookieName } from '@/lib/services/play-service';

/** Puja de un jugador desde su móvil. La identidad sale de su cookie (token), nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const token = (await cookies()).get(playerCookieName(code))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  limit(req, 'player-bid', me ?? 'anon', 60);
  const snapshot = await playerBid(ctx, code, token, await req.json().catch(() => null));
  return json({ snapshot, player_id: me });
});
