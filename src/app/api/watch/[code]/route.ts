import { handle, json, limit, roomKey } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { DomainError } from '@/lib/domain/errors';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { autoAwardTick } from '@/lib/services/game-service';
import { kickJobsAfter } from '@/lib/services/kick';
import { getSpectatorState, spectatorKeyValid } from '@/lib/services/spectator-service';

export const maxDuration = 300;

/**
 * Instantánea de solo lectura para ESPECTADORES con clave. La clave viaja en la cabecera `x-spectator-key` (no en la URL de la API, para
 * que no quede en registros de acceso). Sin clave válida (o con el modo espectador desactivado) responde 403 `spectator_denied`.
 */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const ip = clientIp(req.headers);
  limit(req, 'watch-state', `${ip}:${roomKey(code)}`, 240);
  const key = req.headers.get('x-spectator-key');
  const ctx = await getContext();
  if (!(await spectatorKeyValid(ctx, code, key))) {
    limit(req, 'watch-denied', ip, 20); // los intentos fallidos se limitan mucho más: frena el adivinar claves
    throw new DomainError('spectator_denied');
  }
  const awarded = await autoAwardTick(ctx, code); // igual que la vista pública: la lectura puede adjudicar si la cuenta atrás venció
  const snapshot = await getSpectatorState(ctx, code, key);
  if (awarded) kickJobsAfter(ctx, snapshot.game.id);
  return json({ snapshot, runtime: getRuntimeInfo(ctx) });
});
