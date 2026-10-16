'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== again) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    const res = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message: string } } | null;
    if (!res.ok || !out?.ok) {
      setError(out?.error?.message ?? 'No se pudo cambiar la contraseña.');
      setBusy(false);
      return;
    }
    router.push('/?password=changed');
    router.refresh();
  }

  const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-base';
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
      <div>
        <label htmlFor="pw" className="mb-1 block text-sm font-bold">Nueva contraseña</label>
        <input id="pw" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor="pw2" className="mb-1 block text-sm font-bold">Repite la contraseña</label>
        <input id="pw2" type="password" required minLength={8} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={input} />
      </div>
      {error ? <p role="alert" className="rounded-xl bg-rose/20 px-4 py-3 text-sm font-semibold text-rose" data-testid="reset-error">{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Guardar contraseña</Button>
    </form>
  );
}
