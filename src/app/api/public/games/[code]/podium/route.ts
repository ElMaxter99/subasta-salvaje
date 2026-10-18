import { errorResponse, limit } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { DomainError } from '@/lib/domain/errors';
import { renderPodiumImage } from '@/lib/seo/podium-image';
import { getContext } from '@/lib/services/context';
import { getPublicState } from '@/lib/services/game-service';

export const maxDuration = 60;

/**
 * Imagen PNG del podio final para compartir (solo datos públicos: nombres, puntuación en Ohros y casas finales).
 * `?download=1` la sirve como descarga. Solo cuando la partida ha terminado; quien nunca entró no sale.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  try {
    const { code } = await params;
    limit(req, 'podium-img', `${clientIp(req.headers)}:${code.toUpperCase()}`, 30);
    const ctx = await getContext();
    const snapshot = await getPublicState(ctx, code);
    if (snapshot.game.status !== 'finished') throw new DomainError('invalid_game_state', 'La imagen del podio solo está disponible cuando la partida ha terminado.');
    return await renderPodiumImage(snapshot, ctx.storage, new URL(req.url).searchParams.get('download') === '1');
  } catch (e) {
    return errorResponse(e);
  }
}
