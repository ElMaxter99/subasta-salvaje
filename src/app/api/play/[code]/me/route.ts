import { cookies } from 'next/headers';
import { handle, json } from '@/lib/api';
import { getContext } from '@/lib/services/context';
import { identifyPlayer, playerCookieName } from '@/lib/services/play-service';

/** ¿Qué jugador soy en esta sala? (null si este móvil aún no se ha unido o fue liberado). */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const token = (await cookies()).get(playerCookieName(code))?.value;
  return json({ player_id: await identifyPlayer(await getContext(), code, token) });
});
