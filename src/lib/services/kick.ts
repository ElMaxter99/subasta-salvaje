import { after } from 'next/server';
import type { AppContext } from './context';
import { processImageJobs } from './jobs-service';

/** Procesa la cola de imágenes de una partida DESPUÉS de responder (compatible con Vercel). La cola es persistente. */
export function kickJobsAfter(ctx: AppContext, gameId: string, maxDurationSeconds = 300): void {
  if (!ctx.provider) return;
  after(async () => {
    try {
      await processImageJobs(ctx, { gameId, deadlineMs: (maxDurationSeconds - 30) * 1000, maxJobs: 6 });
    } catch (e) {
      console.error('[jobs] after() falló', e);
    }
  });
}
