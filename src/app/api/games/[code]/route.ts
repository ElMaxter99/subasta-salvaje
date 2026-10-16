import { handle, json } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { assertSameOrigin, limit } from '@/lib/api';
import { autoAwardTick, deleteGame, getHostState } from '@/lib/services/game-service';
import { kickJobsAfter } from '@/lib/services/kick';

export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const host = await requireHost();
  const ctx = await getContext();
  const awarded = await autoAwardTick(ctx, code);
  const snapshot = await getHostState(ctx, code, host.id);
  if (awarded) kickJobsAfter(ctx, snapshot.game.id);
  return json({ snapshot, runtime: getRuntimeInfo(ctx) });
});

/** Borra la partida (y sus imágenes). Sólo el anfitrión propietario; irreversible. */
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'delete-game', host.id, 20);
  await deleteGame(await getContext(), code, host.id);
  return json({ ok: true });
});
