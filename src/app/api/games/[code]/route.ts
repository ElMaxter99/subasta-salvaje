import { handle, json } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { getHostState } from '@/lib/services/game-service';

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const host = await requireHost();
  const ctx = await getContext();
  return json({ snapshot: await getHostState(ctx, code, host.id), runtime: getRuntimeInfo(ctx) });
});
