'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

/** Alta (QR) y verificación de un factor TOTP con Supabase Auth MFA. Sin probar contra Supabase real. */
export function MfaPanel({ mode, supabaseUrl, supabaseAnonKey }: { mode: 'enroll' | 'verify'; supabaseUrl: string; supabaseAnonKey: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = () => createBrowserClient(supabaseUrl, supabaseAnonKey);

  async function start() {
    setBusy(true);
    setError(null);
    const supabase = client();
    // Un alta abandonada deja un factor sin verificar que bloquearía uno nuevo: se limpia antes.
    const list = await supabase.auth.mfa.listFactors();
    for (const f of list.data?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Subasta Salvaje' });
    if (e || !data) setError(e?.message ?? 'No se pudo iniciar el alta.');
    else {
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    }
    setBusy(false);
  }

  async function verify(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = client();
    let id = factorId;
    if (!id) {
      const list = await supabase.auth.mfa.listFactors();
      id = list.data?.totp?.[0]?.id ?? null;
    }
    if (!id) {
      setError('No hay ningún factor configurado.');
      setBusy(false);
      return;
    }
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
    if (e) {
      setError('Código incorrecto o caducado. Prueba con el siguiente.');
      setBusy(false);
      return;
    }
    router.push('/admin');
    router.refresh();
  }

  const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-center text-xl tracking-widest';
  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-2xl bg-rose/20 px-4 py-2 text-sm font-semibold text-rose">{error}</p> : null}
      {mode === 'enroll' && !factorId ? (
        <div className="space-y-3">
          <p className="text-sm text-white/80">Aún no tienes verificación en dos pasos. Pulsa para crear el código QR y escanéalo con tu app de autenticación.</p>
          <Button variant="primary" loading={busy} onClick={start}>Configurar verificación</Button>
        </div>
      ) : null}
      {qr ? (
        <div className="space-y-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR para tu app de autenticación" className="mx-auto h-44 w-44 rounded-xl bg-white p-2" />
          <p className="text-xs text-white/60">¿No puedes escanearlo? Clave manual: <code className="break-all">{secret}</code></p>
        </div>
      ) : null}
      {mode === 'verify' || factorId ? (
        <form onSubmit={verify} className="space-y-3">
          <label htmlFor="mfa-code" className="block text-sm font-bold">Código de 6 dígitos</label>
          <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={input} />
          <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>Verificar</Button>
        </form>
      ) : null}
    </div>
  );
}
