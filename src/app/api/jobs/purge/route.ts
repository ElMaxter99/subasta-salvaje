import { timingSafeEqual } from 'node:crypto';
import { handle, json } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { purgeExpiredGames } from '@/lib/services/game-service';
import { runObservabilityMaintenance } from '@/lib/services/observability-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Borra las partidas sin actividad desde hace más de GAME_TTL_HOURS (12 por defecto). Pensado para Vercel Cron
 * (`Authorization: Bearer $CRON_SECRET`). Además la app hace una limpieza oportunista al crear/listar partidas.
 */
async function run(req: Request) {
  if (!authorized(req)) throw new DomainError('unauthenticated', 'Falta o es incorrecto CRON_SECRET.');
  const ctx = await getContext();
  const games = await purgeExpiredGames(ctx, { limit: 200 });
  // Observabilidad: volcado de contadores, métricas de juego del día, purga por retención/tope y correo-resumen opcional. Nunca hace fallar el cron.
  const observability = await runObservabilityMaintenance(ctx);
  return json({ ...games, observability });
}

export const GET = handle(run);
export const POST = handle(run);
