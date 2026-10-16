import { MascotTitle } from '@/components/mascot/mascot';
import { redirect } from 'next/navigation';
import { JoinPlayerForm } from '@/components/landing/landing-actions';
import { Logo } from '@/components/ui/logo';

export const metadata = { title: 'Unirme a una partida' };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = (await searchParams).code?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code && code.length >= 4) redirect(`/game/${code}/play`);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <Logo size="lg" className="mx-auto !block w-fit" priority />
      <div className="space-y-4 rounded-3xl border border-white/10 bg-night-800/80 p-6">
        <MascotTitle variant="expr-guino" say="¡A pujar!">Unirme a una partida</MascotTitle>
        <p className="text-sm text-white/70">Escribe el código que aparece en la tele o en el panel del anfitrión.</p>
        <JoinPlayerForm />
      </div>
    </main>
  );
}
