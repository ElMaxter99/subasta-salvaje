import { timingSafeEqual } from 'node:crypto';
import { handle, json } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { processImageJobs } from '@/lib/services/jobs-service';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Worker invocable por HTTP: Vercel Cron (envía `Authorization: Bearer $CRON_SECRET`), GitHub Actions,
 * cron-job.org, etc. Procesa la cola global de trabajos de imagen.
 */
async function run(req: Request) {
  if (!authorized(req)) throw new DomainError('unauthenticated', 'Falta o es incorrecto CRON_SECRET.');
  const ctx = await getContext();
  const result = await processImageJobs(ctx, { deadlineMs: (maxDuration - 30) * 1000, maxJobs: 20, workerId: 'cron' });
  return json(result);
}

export const GET = handle(run);
export const POST = handle(run);
