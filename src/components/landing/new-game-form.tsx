'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, Plus, Rocket, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { createGameRequest } from '@/lib/client/api';
import { parseEurosToCents } from '@/lib/domain/money';
import { PLAYER_COLORS } from '@/lib/domain/schemas';
import { THEME_PRESETS } from '@/lib/domain/themes';

const CUSTOM = '__custom__';
const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-base';

export function NewGameForm() {
  const router = useRouter();
  const [name, setName] = useState('Noche de Subasta Salvaje');
  const [themeChoice, setThemeChoice] = useState('house');
  const [customTheme, setCustomTheme] = useState('');
  const [budget, setBudget] = useState('20');
  const [minBid, setMinBid] = useState('1');
  const [ranking, setRanking] = useState<'none' | 'balance' | 'items' | 'votes'>('none');
  const [players, setPlayers] = useState<string[]>(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = THEME_PRESETS.find((t) => t.id === themeChoice);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const budgetCents = parseEurosToCents(budget);
    const minBidCents = parseEurosToCents(minBid);
    if (budgetCents === null) return setError('El presupuesto no es válido (usa por ejemplo 20 o 12,50).');
    if (minBidCents === null || minBidCents < 1) return setError('La puja mínima no es válida.');
    const theme = themeChoice === CUSTOM ? customTheme.trim() : themeChoice;
    if (!theme) return setError('Escribe la temática.');
    const names = players.map((p) => p.trim()).filter(Boolean);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return setError('Hay nombres de jugador repetidos.');
    setBusy(true);
    try {
      const { room_code } = await createGameRequest({
        name: name.trim(),
        theme,
        initial_budget_cents: budgetCents,
        min_bid_cents: minBidCents,
        ranking_rule: ranking,
        players: names.map((n, i) => ({ name: n, color: PLAYER_COLORS[i % PLAYER_COLORS.length] })),
      });
      router.push(`/game/${room_code}/host`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 px-5 py-8">
      <div className="flex items-center justify-between">
        <Logo className="text-2xl" />
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Inicio
        </Link>
      </div>
      <h1 className="font-display text-3xl">Nueva partida</h1>
      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-5">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-bold">Nombre de la partida</label>
            <input id="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="theme" className="mb-1 block text-sm font-bold">Temática</label>
            <select id="theme" value={themeChoice} onChange={(e) => setThemeChoice(e.target.value)} className={field}>
              {THEME_PRESETS.map((t) => (
                <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>
              ))}
              <option value={CUSTOM}>✏️ Otra (texto libre)</option>
            </select>
            {themeChoice === CUSTOM ? (
              <input aria-label="Temática personalizada" placeholder="Ej.: base lunar, circo, submarino…" maxLength={120} value={customTheme} onChange={(e) => setCustomTheme(e.target.value)} className={`${field} mt-2`} />
            ) : (
              <p className="mt-1 text-sm text-white/60">Incluye {preset?.items.length} elementos para subastar; podrás editarlos, añadir los tuyos y generar sus imágenes.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="budget" className="mb-1 block text-sm font-bold">Presupuesto inicial (€)</label>
              <input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="minbid" className="mb-1 block text-sm font-bold">Puja mínima (€)</label>
              <input id="minbid" inputMode="decimal" value={minBid} onChange={(e) => setMinBid(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <label htmlFor="ranking" className="mb-1 block text-sm font-bold">Clasificación final (opcional)</label>
            <select id="ranking" value={ranking} onChange={(e) => setRanking(e.target.value as typeof ranking)} className={field}>
              <option value="none">Sin clasificación</option>
              <option value="balance">Gana quien conserve más dinero</option>
              <option value="items">Gana quien consiga más elementos</option>
              <option value="votes">Votación del público (la registras tú)</option>
            </select>
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-night-800/70 p-5">
          <h2 className="font-display text-xl">Jugadores</h2>
          <p className="text-sm text-white/60">Mínimo 2 para empezar. Podrás cambiarlos en el panel mientras estés en la sala de espera.</p>
          {players.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span aria-hidden className="size-6 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
              <input aria-label={`Nombre del jugador ${i + 1}`} placeholder={`Jugador ${i + 1}`} maxLength={40} value={p} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? e.target.value : x)))} className={field} />
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar jugador ${i + 1}`} onClick={() => setPlayers(players.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {players.length < 12 ? (
            <Button type="button" variant="secondary" onClick={() => setPlayers([...players, ''])}>
              <Plus className="size-4" aria-hidden /> Añadir jugador
            </Button>
          ) : null}
        </section>

        {error ? <p role="alert" className="rounded-xl bg-rose/20 px-4 py-3 font-semibold text-rose">{error}</p> : null}
        <Button type="submit" variant="primary" size="xl" className="w-full" loading={busy}>
          <Rocket className="size-6" aria-hidden /> Crear partida
        </Button>
      </form>
    </main>
  );
}
