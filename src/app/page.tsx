import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Gavel, Sparkles, Tv, Wand2 } from 'lucide-react';
import { DemoSeedButton, JoinScreenForm, SignOutButton } from '@/components/landing/landing-actions';
import { DemoBanner } from '@/components/ui/status';
import { getHostIdentity } from '@/lib/auth/host';
import { getRuntimeMode } from '@/lib/config/env';
import { themeLabel } from '@/lib/domain/themes';
import type { GameSummary } from '@/lib/domain/types';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { listGames } from '@/lib/services/game-service';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { lobby: 'Sala de espera', active: 'En curso', paused: 'Pausada', finished: 'Finalizada' };

export default async function Home() {
  const mode = getRuntimeMode();
  if (mode === 'unconfigured') redirect('/setup');
  const [identity, ctx] = await Promise.all([getHostIdentity(), getContext()]);
  const runtime = getRuntimeInfo(ctx);
  const games: GameSummary[] = identity ? await listGames(ctx, identity.id) : [];

  return (
    <>
      <DemoBanner runtime={runtime} />
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-5 py-10">
        <header className="flex items-center justify-between">
          <span className="font-display text-xl uppercase tracking-tight">
            <span className="text-gold">Subasta</span> <span className="text-violet-soft">Salvaje</span>
          </span>
          {identity ? (
            <div className="flex items-center gap-2 text-sm text-white/70">
              <span>{identity.email ?? 'Anfitrión demo'}</span>
              <SignOutButton demo={identity.demo} supabaseUrl={runtime.supabaseUrl} supabaseAnonKey={runtime.supabaseAnonKey} />
            </div>
          ) : (
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-bold text-white/80 hover:bg-white/10">
              Iniciar sesión
            </Link>
          )}
        </header>

        <section className="space-y-6 py-6 text-center">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full bg-violet/20 px-4 py-1.5 text-sm font-bold text-violet-soft">
            <Sparkles className="size-4" aria-hidden /> Subastas creativas para noches de juegos
          </p>
          <h1 className="font-display text-5xl uppercase leading-[0.95] tracking-tight sm:text-7xl">
            Puja. Construye. <span className="text-gold">Alucina.</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/75">
            Cada jugador parte de una casa vacía y un presupuesto. Tú diriges la subasta desde el móvil; la tele muestra el espectáculo y la IA va transformando cada casa con lo que se compra.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/new-game"
              className="inline-flex min-h-16 items-center gap-2 rounded-2xl bg-gold px-8 text-xl font-bold text-night-950 shadow-[0_6px_0_#b45309] transition hover:bg-gold-soft"
            >
              <Gavel className="size-6" aria-hidden /> Crear partida
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-6">
            <h2 className="flex items-center gap-2 font-display text-xl">
              <Tv className="size-5 text-teal" aria-hidden /> Abrir una pantalla de TV
            </h2>
            <p className="text-sm text-white/70">Cualquiera con el código puede ver la partida (solo lectura). Ábrelo en la televisión.</p>
            <JoinScreenForm />
          </div>
          <div className="space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-6">
            <h2 className="flex items-center gap-2 font-display text-xl">
              <Wand2 className="size-5 text-gold" aria-hidden /> Recuperar mis partidas
            </h2>
            {!identity ? (
              <p className="text-sm text-white/70">
                <Link href="/login" className="font-bold text-gold underline">
                  Inicia sesión
                </Link>{' '}
                para volver al panel de control de tus partidas.
              </p>
            ) : games.length === 0 ? (
              <p className="text-sm text-white/70">Aún no has creado ninguna partida.</p>
            ) : (
              <ul className="space-y-2">
                {games.slice(0, 6).map((g) => (
                  <li key={g.room_code}>
                    <Link
                      href={`/game/${g.room_code}/host`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-night-900 px-4 py-3 hover:border-gold"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{g.name}</span>
                        <span className="text-xs text-white/60">
                          {themeLabel(g.theme)} · {g.players} jugadores · {STATUS[g.status] ?? g.status}
                        </span>
                      </span>
                      <span className="font-display tracking-widest text-gold">{g.room_code}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {runtime.mode === 'demo' ? (
          <section className="rounded-3xl border border-dashed border-gold/50 p-6">
            <h2 className="font-display text-lg text-gold">Modo demo</h2>
            <p className="mb-3 text-sm text-white/70">
              Sin credenciales de Supabase la app funciona con una base de datos local y un proveedor de imágenes de muestra (no es IA). Configura <code>.env.local</code> para el modo real.
            </p>
            <DemoSeedButton />
          </section>
        ) : null}
      </main>
    </>
  );
}
