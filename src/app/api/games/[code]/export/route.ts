import { handle, limit, noStore } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { zipStream } from '@/lib/domain/zip-write';
import { getContext } from '@/lib/services/context';
import { exportGame } from '@/lib/services/export-service';

export const maxDuration = 120;

/**
 * Exporta la partida completa en un ZIP (partida.json + imágenes por jugador + LEEME.txt). Solo el anfitrión propietario.
 * Es de solo lectura (GET, sin cambios de estado), por eso no exige `assertSameOrigin`; la cookie de sesión es SameSite y
 * la respuesta no se puede leer desde otro origen. Límite de tasa bajo porque lee Storage.
 */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'export-game', host.id, 6, 10 * 60_000);
  const out = await exportGame(await getContext(), code, host.id);
  return new Response(zipStream(out.entries), {
    headers: { ...noStore, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${out.filename}"`, 'X-Content-Type-Options': 'nosniff' },
  });
});
