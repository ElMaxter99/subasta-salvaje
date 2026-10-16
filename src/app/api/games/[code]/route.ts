import { handle, json } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { autoAwardTick, getHostState } from '@/lib/services/game-service';
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
