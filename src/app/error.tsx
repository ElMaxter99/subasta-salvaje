'use client';

import { Loader } from '@/components/ui/loader';

/** Error inesperado de una pantalla: se dice qué ha pasado y se ofrece reintentar. El detalle técnico no se muestra. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <Loader failed label="¡Vaya, se ha caído el martillo!" detail={<>No se ha podido mostrar esta pantalla. Tu partida no se ha perdido: reintenta o vuelve al inicio.{error.digest ? <span className="mt-1 block text-xs text-white/40">Ref. {error.digest}</span> : null}</>} onRetry={reset} />
    </main>
  );
}
