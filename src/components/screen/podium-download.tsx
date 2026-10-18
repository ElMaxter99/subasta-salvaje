import { Download } from 'lucide-react';

/**
 * Botón «Descargar imagen del podio»: PNG público de la partida terminada, listo para compartir.
 * El principal es vertical (1080×1350, pensado para el móvil); debajo, los otros dos formatos.
 */
export function PodiumDownload({ roomCode }: { roomCode: string }) {
  const href = (format: string) => `/api/public/games/${roomCode}/podium?format=${format}&download=1`;
  const alt = 'inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-violet-soft underline-offset-4 hover:underline';
  return (
    <div className="flex flex-col items-center gap-1">
      <a
        href={href('story')}
        download={`podio-${roomCode}.png`}
        data-testid="podium-download"
        className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gold px-6 text-lg font-bold text-night-950 hover:brightness-110"
      >
        <Download className="size-5" aria-hidden /> Descargar imagen del podio
      </a>
      <p className="flex flex-wrap items-center justify-center text-sm text-white/70">
        Otros formatos:
        <a href={href('square')} download={`podio-${roomCode}-square.png`} data-testid="podium-download-square" className={alt}>Cuadrada</a>
        <a href={href('landscape')} download={`podio-${roomCode}-landscape.png`} data-testid="podium-download-landscape" className={alt}>Horizontal</a>
      </p>
    </div>
  );
}
