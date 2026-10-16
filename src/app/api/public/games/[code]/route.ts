import { handle, json } from '@/lib/api';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { autoAwardTick, getPublicState } from '@/lib/services/game-service';
import { kickJobsAfter } from '@/lib/services/kick';

export const maxDuration = 300;

/** Vista pública de solo lectura (pantalla de TV y resultados). Nunca incluye datos de anfitrión. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const ctx = await getContext();
  // Adjudicación automática por tiempo: cualquier lectura puede ejecutarla si la cuenta atrás venció.
  const awarded = await autoAwardTick(ctx, code);
  const snapshot = await getPublicState(ctx, code);
  if (awarded) kickJobsAfter(ctx, snapshot.game.id);
  return json({ snapshot, runtime: getRuntimeInfo(ctx) });
});
