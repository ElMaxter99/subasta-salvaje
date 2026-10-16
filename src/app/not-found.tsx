import Link from 'next/link';
import { EmptyState } from '@/components/mascot/mascot';

export const metadata = { title: 'No encontrado' };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6">
      <EmptyState
        variant="expr-sorprendido"
        title="Aquí no hay nada"
        action={
          <Link href="/" className="rounded-xl bg-gold px-6 py-3 text-lg font-bold text-night-950">
            Ir al inicio
          </Link>
        }
      >
        La página que buscas no existe o ya no está disponible.
      </EmptyState>
    </main>
  );
}
