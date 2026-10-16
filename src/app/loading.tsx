import { Loader } from '@/components/ui/loader';

export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <Loader label="Preparando la subasta…" detail="Cargando la pantalla." />
    </main>
  );
}
