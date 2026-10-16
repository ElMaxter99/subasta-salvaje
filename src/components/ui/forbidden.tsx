import Link from 'next/link';
import { Mascot } from '@/components/mascot/mascot';

export function ForbiddenNotice({ roomCode }: { roomCode: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
      <Mascot variant="expr-enfadado" size="md" tile motion="pop" />
      <h1 className="font-display text-3xl">Esta partida no es tuya</h1>
      <p className="text-white/75">
        El panel de control de <b>{roomCode}</b> solo está disponible para el anfitrión que la creó. Inicia sesión con esa cuenta o abre la pantalla pública.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link className="rounded-xl bg-gold px-5 py-3 font-bold text-night-950" href={`/game/${roomCode}/screen`}>
          Ver pantalla pública
        </Link>
        <Link className="rounded-xl border border-white/20 px-5 py-3 font-bold" href="/login">
          Cambiar de cuenta
        </Link>
      </div>
    </main>
  );
}
