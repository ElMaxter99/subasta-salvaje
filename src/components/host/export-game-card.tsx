import { Archive } from 'lucide-react';
import { Card } from './bits';
import type { HostCtx } from './host-context';

/** Copia completa de la partida (ZIP) para el anfitrión: datos en JSON e imágenes de cada jugador. */
export function ExportGameCard({ ctx }: { ctx: HostCtx }) {
  return (
    <Card title="Exportar partida">
      <p className="mb-3 text-sm text-white/70">Descarga un ZIP con todos los datos de la partida (ajustes, jugadores y saldos finales, pujas, compras, eventos y resultados), las imágenes guardadas de cada jugador y un LEEME. Las fotos alojadas por enlace no se descargan: se listan en el archivo.</p>
      <a
        href={`/api/games/${encodeURIComponent(ctx.roomCode)}/export`}
        download
        data-testid="game-export"
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-night-700 px-5 py-3.5 text-lg font-bold text-white transition hover:bg-night-600"
      >
        <Archive className="size-5" aria-hidden /> Exportar partida (ZIP)
      </a>
    </Card>
  );
}
