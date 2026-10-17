import { notFound, redirect } from 'next/navigation';
import { MfaPanel } from '@/components/admin/mfa-panel';
import { Logo } from '@/components/ui/logo';
import { resolveHost } from '@/lib/auth/host';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verificación en dos pasos', robots: { index: false, follow: false } };

/**
 * Segundo factor (TOTP) del superadmin. Solo existe para un correo de SUPERADMIN_EMAILS al que le falta el factor
 * (con SUPERADMIN_REQUIRE_MFA=true); para cualquier otra persona es un 404.
 */
export default async function AdminMfaPage() {
  if (getRuntimeMode() !== 'supabase') notFound();
  const { mfa, email, identity } = await resolveHost();
  if (!mfa) {
    if (identity?.superadmin) redirect('/admin');
    notFound();
  }
  const cfg = getSupabaseConfig();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-10">
      <Logo size="lg" className="mx-auto !block w-fit" priority />
      <div className="space-y-4 rounded-3xl border border-white/10 bg-night-800/80 p-6">
        <h1 className="font-display text-2xl">Verificación en dos pasos</h1>
        <p className="text-sm text-white/70">Cuenta: {email}. El panel de superadmin exige un código de tu app de autenticación (Google Authenticator, Aegis, 1Password…).</p>
        <MfaPanel mode={mfa} supabaseUrl={cfg.url} supabaseAnonKey={cfg.anonKey} />
      </div>
    </main>
  );
}
