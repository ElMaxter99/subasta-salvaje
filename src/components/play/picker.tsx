'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, Lock, Tv, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError, joinGameRequest } from '@/lib/client/api';
import type { PublicSnapshot } from '@/lib/domain/types';

/** Paso 1: el móvil aún no sabe quién es. */
export function Picker({
  roomCode,
  snapshot,
  notice,
  onJoined,
  onStale,
}: {
  roomCode: string;
  snapshot: PublicSnapshot;
  notice: string | null;
  onJoined: (playerId: string, snapshot: PublicSnapshot) => void;
  onStale: () => void;
}) {
  const toast = useToast();
  const { game, players } = snapshot;
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [showName, setShowName] = useState(false);

  async function join(body: { player_id: string } | { name: string }) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await joinGameRequest(roomCode, body);
      onJoined(r.player_id, r.snapshot);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo conectar. Revisa tu conexión.');
      if (e instanceof ApiError && e.code === 'player_taken') onStale();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (game.status === 'finished') {
    return (
      <div className="space-y-4 rounded-3xl border border-white/10 bg-night-800 p-6 text-center">
        <h2 className="font-display text-2xl">La partida ha terminado</h2>
        <Link href={`/game/${roomCode}/results`} className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-gold px-6 text-lg font-bold text-night-950">
          Ver resultados
        </Link>
      </div>
    );
  }

  if (game.play_mode !== 'mobile') {
    return (
      <div className="space-y-4 rounded-3xl border border-white/10 bg-night-800 p-6 text-center" role="status">
        <Tv className="mx-auto size-10 text-violet-soft" aria-hidden />
        <h2 className="font-display text-xl">Esta partida la lleva el anfitrión</h2>
        <p className="text-base text-white/75">No se puede pujar desde el móvil. Sigue la subasta en la pantalla de TV.</p>
        <Link href={`/game/${roomCode}/screen`} className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-night-700 px-6 text-lg font-bold">
          Ir a la pantalla de TV
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="alert" className="rounded-2xl bg-rose px-4 py-3 text-base font-bold text-night-950">
          {notice}
        </p>
      ) : null}
      <h2 className="font-display text-3xl">¿Quién eres?</h2>
      <ul className="space-y-3">
        {players.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={p.claimed || busy}
              onClick={() => setPending({ id: p.id, name: p.name })}
              className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-white/10 bg-night-800 px-4 text-left text-xl font-bold transition enabled:active:scale-[0.98] enabled:hover:bg-night-700 disabled:opacity-55"
            >
              <span aria-hidden className="size-9 shrink-0 rounded-full border-2 border-white/30" style={{ background: p.color }} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.claimed ? (
                <span className="flex items-center gap-1 text-sm font-semibold text-white/70">
                  <Lock className="size-4" aria-hidden /> Ya conectado
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {game.join_policy === 'closed' ? (
        <p role="status" className="rounded-2xl bg-night-800 px-4 py-3 text-base text-white/80">La sala está cerrada: el anfitrión no admite más jugadores. Si eres uno de los jugadores, pídele que te libere la casilla.</p>
      ) : null}

      {game.status === 'lobby' && game.join_policy === 'open' ? (
        showName ? (
          <form
            className="space-y-3 rounded-2xl border border-white/10 bg-night-800 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (n) void join({ name: n });
            }}
          >
            <label htmlFor="new-name" className="block text-base font-bold">
              Tu nombre
            </label>
            <input
              id="new-name"
              value={name}
              maxLength={40}
              autoFocus
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
              className="min-h-14 w-full rounded-xl border border-white/20 bg-night-950 px-4 text-lg text-white placeholder:text-white/55"
              placeholder="Escribe tu nombre"
            />
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!name.trim()}>
              <Check className="size-5" aria-hidden /> Entrar
            </Button>
          </form>
        ) : (
          <Button variant="secondary" size="lg" className="w-full" onClick={() => setShowName(true)}>
            <UserPlus className="size-5" aria-hidden /> Mi nombre no está en la lista
          </Button>
        )
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `Entrar como ${pending.name}` : ''}
        confirmLabel="Sí, soy yo"
        loading={busy}
        onConfirm={() => pending && void join({ player_id: pending.id })}
        onCancel={() => setPending(null)}
      >
        Pujarás con el saldo de este jugador.
      </ConfirmDialog>
    </div>
  );
}
