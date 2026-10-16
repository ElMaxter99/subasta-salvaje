'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Button } from '@/components/ui/button';

export function LoginForm({ next, supabaseUrl, supabaseAnonKey, signupsOpen = true }: { next: string; supabaseUrl: string; supabaseAnonKey: string; signupsOpen?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    if (mode === 'forgot') {
      const res = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message: string } } | null;
      if (!res.ok || !out?.ok) setMessage({ kind: 'error', text: out?.error?.message ?? 'No se pudo enviar el correo. Inténtalo de nuevo.' });
      else setMessage({ kind: 'info', text: 'Si existe una cuenta con ese correo, te hemos enviado un enlace para elegir una contraseña nueva. Revisa también la carpeta de spam.' });
      setBusy(false);
      return;
    }
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ kind: 'error', text: error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message });
        setBusy(false);
        return;
      }
      router.push(next);
      router.refresh();
    } else {
      const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const out = (await res.json().catch(() => null)) as { ok?: boolean; session?: boolean; error?: { message: string } } | null;
      if (!res.ok || !out?.ok) {
        setMessage({ kind: 'error', text: out?.error?.message ?? 'No se pudo crear la cuenta.' });
        setBusy(false);
        return;
      }
      const data = { session: out.session };
      if (data.session) {
        router.push(next);
        router.refresh();
      } else {
        setMessage({ kind: 'info', text: 'Cuenta creada. Revisa tu correo para confirmar la dirección y vuelve a iniciar sesión.' });
        setMode('signin');
        setBusy(false);
      }
    }
  }

  const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-base';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-bold">
          Correo electrónico
        </label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      {mode !== 'forgot' ? (
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-bold">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
        {mode === 'signin' ? (
          <button type="button" className="mt-2 text-sm text-white/70 underline" data-testid="forgot-link" onClick={() => { setMode('forgot'); setMessage(null); }}>
            ¿Has olvidado tu contraseña?
          </button>
        ) : null}
      </div>
      ) : (
        <p className="text-sm text-white/70">Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.</p>
      )}
      {message ? (
        <p role="alert" className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.kind === 'error' ? 'bg-rose/20 text-rose' : 'bg-teal/20 text-teal'}`}>
          {message.text}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        {mode === 'signin' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
      </Button>
      {mode === 'forgot' ? (
        <button type="button" className="w-full text-center text-sm text-white/70 underline" onClick={() => { setMode('signin'); setMessage(null); }}>
          Volver a iniciar sesión
        </button>
      ) : signupsOpen ? (
        <button type="button" className="w-full text-center text-sm text-white/70 underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta'}
        </button>
      ) : (
        <p className="text-center text-sm text-white/70" data-testid="signups-closed">
          El registro está cerrado: solo pueden crear cuenta los correos invitados por el administrador.
        </p>
      )}
    </form>
  );
}
