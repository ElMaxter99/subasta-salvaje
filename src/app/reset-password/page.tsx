import { redirect } from 'next/navigation';
import { ResetPasswordForm } from '@/components/landing/reset-password-form';
import { MascotTitle } from '@/components/mascot/mascot';
import { Logo } from '@/components/ui/logo';
import { resolveHost } from '@/lib/auth/host';
import { getRuntimeMode } from '@/lib/config/env';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Nueva contraseña' };

export default async function ResetPasswordPage() {
  if (getRuntimeMode() !== 'supabase') redirect('/login');
  const { email, identity, denial } = await resolveHost();
  // Sin sesión de recuperación (enlace caducado o abierto a mano) no hay nada que cambiar.
  if (!identity && !denial && !email) redirect('/login?link=invalid');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-10">
      <Logo size="lg" className="mx-auto !block w-fit" priority />
      <div className="space-y-5 rounded-3xl border border-white/10 bg-night-800/80 p-6">
        <MascotTitle variant="expr-pensativo" say="¡Casi listo!" subtitle={email ? `Cuenta: ${email}` : undefined}>Elige tu nueva contraseña</MascotTitle>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
