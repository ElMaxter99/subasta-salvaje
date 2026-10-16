import Link from 'next/link';
import { Trash2 } from 'lucide-react';

/** Se muestra cuando la partida ya no existe: borrada por el anfitrión o por inactividad. */
export function GameGone({ roomCode }: { roomCode: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <Trash2 className="size-14 text-white/50" aria-hidden />
      <h1 className="font-display text-3xl">Esta partida ya no existe</h1>
      <p className="max-w-md text-white/70">
        La sala <b>{roomCode}</b> fue borrada por el anfitrión o se eliminó automáticamente tras un periodo sin actividad.
      </p>
      <Link href="/" className="rounded-xl bg-gold px-6 py-3 text-lg font-bold text-night-950">
        Ir al inicio
      </Link>
    </main>
  );
}
