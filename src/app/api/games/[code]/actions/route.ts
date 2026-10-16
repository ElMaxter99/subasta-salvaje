import { after } from 'next/server';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { performAction } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { redactSecrets } from '@/lib/security/redact';

/** Margen para que `after()` pueda terminar una generación de imagen (límite del plan de Vercel). */
export const maxDuration = 300;

const KICK_JOBS = new Set(['auction.award', 'game.finish', 'player.add', 'image.generate_initial_all', 'image.request_initial', 'image.request_item', 'image.retry']);

export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'action', host.id, 240);
  const ctx = await getContext();
  const body = (await req.json().catch(() => null)) as { type?: string } | null;
  const out = await performAction(ctx, code, host.id, body);

  // Dispara el procesamiento de trabajos de imagen DESPUÉS de responder. La cola es persistente:
  // si esta ejecución se corta, el cron / worker / botón del anfitrión recogerán el trabajo.
  // También si una puja provocó una adjudicación automática instantánea.
  if (((body?.type && KICK_JOBS.has(body.type)) || out.result.auto_awarded) && (ctx.provider || ctx.stickers)) {
    const gameId = out.snapshot.game.id;
    after(async () => {
      try {
        await processImageJobs(ctx, { gameId, deadlineMs: (maxDuration - 30) * 1000, maxJobs: 6 });
      } catch (e) {
        console.error('[jobs] after() falló', redactSecrets(String(e)));
      }
    });
  }
  return json(out);
});
