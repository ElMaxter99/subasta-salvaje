import { cookies } from 'next/headers';
import { handle, json, limit, roomKey } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { identifyPlayer, playerCookieName } from '@/lib/services/play-service';

/** ¿Qué jugador soy en esta sala? (null si este móvil aún no se ha unido o fue liberado). */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  limit(req, 'player-me', `${clientIp(req.headers)}:${roomKey(code)}`, 240);
  const token = (await cookies()).get(playerCookieName(roomKey(code)))?.value;
  return json({ player_id: await identifyPlayer(await getContext(), code, token) });
});
