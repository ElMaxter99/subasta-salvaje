import { handle, json, assertSameOrigin, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { createGame, listGames } from '@/lib/services/game-service';

export const GET = handle(async () => {
  const host = await requireHost();
  const ctx = await getContext();
  return json({ games: await listGames(ctx, host.id) });
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const host = await requireHost();
  limit(req, 'create-game', host.id, 10);
  const ctx = await getContext();
  const body = await req.json().catch(() => null);
  return json(await createGame(ctx, host.id, body), { status: 201 });
});
