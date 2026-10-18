import { errorResponse, limit } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { DomainError } from '@/lib/domain/errors';
import { parsePodiumFormat, renderPodiumImage } from '@/lib/seo/podium-image';
import { getContext } from '@/lib/services/context';
import { getPublicState } from '@/lib/services/game-service';

export const maxDuration = 60;

/**
 * Imagen PNG del podio final para compartir (solo datos públicos: nombres, puntuación en Ohros y casas finales).
 * `?format=landscape|square|story` (1200×630 por defecto, 1080×1080, 1080×1350) y `?download=1` la sirve como descarga. Solo cuando la partida ha terminado; quien nunca entró no sale.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  try {
    const { code } = await params;
    limit(req, 'podium-img', `${clientIp(req.headers)}:${code.toUpperCase()}`, 30);
    const url = new URL(req.url);
    const format = parsePodiumFormat(url.searchParams.get('format')); // lista cerrada: landscape (por defecto) | square | story
    if (!format) throw new DomainError('invalid_input', 'Formato no válido. Usa landscape, square o story.');
    const ctx = await getContext();
    const snapshot = await getPublicState(ctx, code);
    if (snapshot.game.status !== 'finished') throw new DomainError('invalid_game_state', 'La imagen del podio solo está disponible cuando la partida ha terminado.');
    return await renderPodiumImage(snapshot, ctx.storage, url.searchParams.get('download') === '1', format);
  } catch (e) {
    return errorResponse(e);
  }
}
