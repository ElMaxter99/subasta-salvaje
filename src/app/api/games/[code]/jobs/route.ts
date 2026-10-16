import { after } from 'next/server';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { getHostState } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { redactSecrets } from '@/lib/security/redact';

export const maxDuration = 300;

/** El anfitrión empuja la cola de su partida (útil si el cron no es frecuente). Responde enseguida. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'jobs-kick', host.id, 30);
  const ctx = await getContext();
  if (!ctx.provider && !ctx.stickers) throw new DomainError('provider_not_configured');
  const snap = await getHostState(ctx, code, host.id); // comprueba permisos
  const gameId = snap.game.id;
  after(async () => {
    try {
      await processImageJobs(ctx, { gameId, deadlineMs: (maxDuration - 30) * 1000, maxJobs: 6 });
    } catch (e) {
      console.error('[jobs] kick falló', redactSecrets(String(e)));
    }
  });
  return json({ ok: true, accepted: true }, { status: 202 });
});
