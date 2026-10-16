'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Button } from '@/components/ui/button';

export function LoginForm({ next, supabaseUrl, supabaseAnonKey }: { next: string; supabaseUrl: string; supabaseAnonKey: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
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
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage({ kind: 'error', text: error.message });
        setBusy(false);
        return;
      }
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
      </div>
      {message ? (
        <p role="alert" className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.kind === 'error' ? 'bg-rose/20 text-rose' : 'bg-teal/20 text-teal'}`}>
          {message.text}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        {mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
      </Button>
      <button type="button" className="w-full text-center text-sm text-white/70 underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta'}
      </button>
    </form>
  );
}
