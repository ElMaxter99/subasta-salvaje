import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSuperadmin, resolveHost } from '@/lib/auth/host';
import { getRuntimeInfo } from '@/lib/services/context';
import { DemoBanner } from '@/components/ui/status';
import { Mascot } from '@/components/mascot/mascot';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Superadmin', robots: { index: false, follow: false } };

const NAV = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/usuarios', label: 'Usuarios' },
  { href: '/admin/partidas', label: 'Partidas' },
  { href: '/admin/plantillas', label: 'Plantillas' },
  { href: '/admin/biblioteca', label: 'Biblioteca' },
  { href: '/admin/ia', label: 'IA' },
  { href: '/admin/ajustes', label: 'Ajustes' },
  { href: '/admin/auditoria', label: 'Auditoría' },
];

/** Solo superadmin: cualquier otra persona (o sin sesión) ve un 404, como si el panel no existiera. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSuperadmin().catch(() => null);
  if (!admin) {
    // Superadmin por correo al que solo le falta el segundo factor: se le lleva a configurarlo/verificarlo.
    if ((await resolveHost()).mfa) redirect('/seguridad-admin');
    notFound();
  }
  return (
    <>
      <DemoBanner runtime={getRuntimeInfo()} />
      <div className="mx-auto min-h-screen max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Mascot variant="expr-pensativo" size="xs" tile motion="wiggle" />
            <div>
              <p className="font-display text-2xl tracking-tight"><span className="text-gold">Superadmin</span> · Subasta Salvaje</p>
              <p className="text-sm text-white/60">{admin.email ?? 'Anfitrión demo'}</p>
            </div>
          </div>
          <nav aria-label="Secciones del panel de superadmin" className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-xl px-3 py-2 text-sm font-bold text-white/80 hover:bg-white/10">
                {n.label}
              </Link>
            ))}
            <Link href="/" className="rounded-xl px-3 py-2 text-sm font-bold text-violet-soft hover:bg-white/10">← Volver a la app</Link>
          </nav>
        </header>
        {children}
      </div>
    </>
  );
}
