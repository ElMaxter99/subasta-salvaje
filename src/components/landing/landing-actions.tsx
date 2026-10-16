'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, FlaskConical, LogOut, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { demoLogin, seedDemo } from '@/lib/client/api';

export function JoinScreenForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().toUpperCase();
        if (c) router.push(`/game/${c}/screen`);
      }}
    >
      <label className="sr-only" htmlFor="room-code">
        Código de sala
      </label>
      <input
        id="room-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
        placeholder="CÓDIGO"
        autoComplete="off"
        className="min-w-0 flex-1 rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-center font-display text-xl tracking-[0.3em] placeholder:tracking-widest placeholder:text-white/30"
      />
      <Button type="submit" variant="secondary" size="lg" disabled={code.length < 4}>
        <Tv className="size-5" aria-hidden /> Ver pantalla
      </Button>
    </form>
  );
}

export function DemoSeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="md"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { room_code } = await seedDemo('midgame');
            router.push(`/game/${room_code}/host`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <FlaskConical className="size-4" aria-hidden /> Cargar partida de ejemplo (demo)
      </Button>
      {error ? <p className="text-sm text-rose">{error}</p> : null}
    </div>
  );
}

export function SignOutButton({ demo, supabaseUrl, supabaseAnonKey }: { demo: boolean; supabaseUrl?: string; supabaseAnonKey?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (demo) {
          await fetch('/api/auth/demo', { method: 'DELETE' });
        } else if (supabaseUrl && supabaseAnonKey) {
          const { createBrowserClient } = await import('@supabase/ssr');
          await createBrowserClient(supabaseUrl, supabaseAnonKey).auth.signOut();
        }
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden /> Cerrar sesión
    </Button>
  );
}

export function DemoLoginButton({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="xl"
      className="w-full"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await demoLogin();
        router.push(next);
        router.refresh();
      }}
    >
      Entrar como anfitrión (demo) <ArrowRight className="size-5" aria-hidden />
    </Button>
  );
}
