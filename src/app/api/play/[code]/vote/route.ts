import { cookies } from 'next/headers';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { galleryVote, identifyPlayer, playerCookieName } from '@/lib/services/play-service';

/** Voto de la galería final desde el móvil. La identidad sale de la cookie del jugador, nunca del cuerpo. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'gallery-vote', `${clientIp(req.headers)}:${code.toUpperCase()}`, 60);
  const token = (await cookies()).get(playerCookieName(code))?.value;
  const ctx = await getContext();
  const me = await identifyPlayer(ctx, code, token);
  if (me) limit(req, 'gallery-vote-me', me, 30);
  const snapshot = await galleryVote(ctx, code, token, await req.json().catch(() => null));
  return json({ snapshot, player_id: me });
});
