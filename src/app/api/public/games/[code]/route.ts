import { handle, json, limit, roomKey } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { autoAwardTick, getPublicState } from '@/lib/services/game-service';
import { kickJobsAfter } from '@/lib/services/kick';

export const maxDuration = 300;

/** Vista pública de solo lectura (pantalla de TV y resultados). Nunca incluye datos de anfitrión. */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  // Sondeo de TV, resultados y espectadores: generoso (cada pestaña consulta cada 1,5-8 s) pero acotado por IP y sala.
  limit(req, 'public-state', `${clientIp(req.headers)}:${roomKey(code)}`, 240);
  const ctx = await getContext();
  // Adjudicación automática por tiempo: cualquier lectura puede ejecutarla si la cuenta atrás venció.
  const awarded = await autoAwardTick(ctx, code);
  const snapshot = await getPublicState(ctx, code);
  if (awarded) kickJobsAfter(ctx, snapshot.game.id);
  return json({ snapshot, runtime: getRuntimeInfo(ctx) });
});
