import { MascotTitle } from '@/components/mascot/mascot';
import { redirect } from 'next/navigation';
import { DemoLoginButton } from '@/components/landing/landing-actions';
import { LoginForm } from '@/components/landing/login-form';
import { DemoBanner } from '@/components/ui/status';
import { Logo } from '@/components/ui/logo';
import { resolveHost } from '@/lib/auth/host';
import { SignOutButton } from '@/components/landing/landing-actions';
import { getRuntimeMode } from '@/lib/config/env';
import { getRuntimeInfo } from '@/lib/services/context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Acceso del anfitrión' };

/** Sólo rutas internas: evita redirecciones abiertas. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (getRuntimeMode() === 'unconfigured') redirect('/setup');
  const { identity, denial, email } = await resolveHost();
  if (identity) redirect(next);
  const runtime = getRuntimeInfo();
  return (
    <>
      <DemoBanner runtime={runtime} />
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-10">
        <Logo className="text-center text-3xl" />
        <div className="space-y-5 rounded-3xl border border-white/10 bg-night-800/80 p-6">
          <div>
            <MascotTitle variant="expr-guino" say="¡Hola, anfitrión!" subtitle="Solo el anfitrión necesita cuenta. Los jugadores no se registran.">Acceso del anfitrión</MascotTitle>
          </div>
          {denial ? (
            <div role="alert" className="space-y-3 rounded-2xl border border-rose/40 bg-rose/10 p-4 text-sm" data-testid="host-denied">
              <p className="font-bold text-rose">{denial === 'blocked' ? 'Tu cuenta está bloqueada.' : 'El registro está cerrado.'}</p>
              <p className="text-white/80">
                {denial === 'blocked' ? 'Contacta con el administrador para recuperar el acceso.' : `La cuenta ${email ?? ''} no tiene invitación. Pide al administrador que te invite con este mismo correo.`}
              </p>
              <SignOutButton demo={false} supabaseUrl={runtime.supabaseUrl} supabaseAnonKey={runtime.supabaseAnonKey} />
            </div>
          ) : null}
          {runtime.mode === 'demo' ? (
            <div className="space-y-3">
              <p className="text-sm text-white/70">Modo demo: no hace falta cuenta. Se crea una identidad local en este navegador.</p>
              <DemoLoginButton next={next} />
            </div>
          ) : (
            <LoginForm next={next} supabaseUrl={runtime.supabaseUrl!} supabaseAnonKey={runtime.supabaseAnonKey!} />
          )}
        </div>
      </main>
    </>
  );
}
