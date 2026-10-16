import { handle, json } from '@/lib/api';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { getPublicState } from '@/lib/services/game-service';

/** Vista pública de solo lectura (pantalla de TV y resultados). Nunca incluye datos de anfitrión. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const ctx = await getContext();
  return json({ snapshot: await getPublicState(ctx, code), runtime: getRuntimeInfo(ctx) });
});
