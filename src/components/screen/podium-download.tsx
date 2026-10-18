import { Download } from 'lucide-react';

/** Botón «Descargar imagen del podio»: PNG público de la partida terminada, listo para compartir. */
export function PodiumDownload({ roomCode }: { roomCode: string }) {
  return (
    <a
      href={`/api/public/games/${roomCode}/podium?download=1`}
      download={`podio-${roomCode}.png`}
      data-testid="podium-download"
      className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gold px-6 text-lg font-bold text-night-950 hover:brightness-110"
    >
      <Download className="size-5" aria-hidden /> Descargar imagen del podio
    </a>
  );
}
