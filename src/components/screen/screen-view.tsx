'use client';

import { useEffect } from 'react';
import { Maximize2, Minimize2, Pause, Loader2 } from 'lucide-react';
import type { PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';
import { GameGone } from '@/components/ui/game-gone';
import { useLiveGame } from '@/lib/client/use-live-game';
import { ConnectionBadge } from '@/components/ui/status';
import { themeLabel } from '@/lib/domain/themes';
import { AuctionStage } from './auction-stage';
import { AwardOverlay } from './award-overlay';
import { PlayerCard } from './player-card';
import { CompactInvite } from './join-invite';
import { FinalResults } from './results-view';
import { useFullscreenControls } from './use-fullscreen';
import './screen.css';

function gridFor(n: number) {
  const cols = n <= 6 ? Math.max(n, 1) : n <= 8 ? 4 : n <= 10 ? 5 : 6;
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

function statusPill(snap: PublicSnapshot): { label: string; tone: string } {
  const { game, auction } = snap;
  if (game.status === 'paused') return { label: 'Pausada', tone: 'bg-rose text-night-950' };
  if (game.status === 'finished') return { label: 'Finalizada', tone: 'bg-violet text-white' };
  if (game.status === 'lobby') return { label: 'Sala de espera', tone: 'bg-teal text-night-950' };
  switch (auction?.status) {
    case 'open':
      return { label: 'En curso', tone: 'bg-teal text-night-950' };
    case 'closed':
      return { label: 'Puja cerrada', tone: 'bg-rose text-night-950' };
    case 'awarded':
      return { label: '¡Adjudicado!', tone: 'bg-gold text-night-950' };
    default:
      return { label: 'Preparada', tone: 'bg-white/15 text-white' };
  }
}

export function ScreenView({ roomCode, initial, runtime }: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo }) {
  const { snapshot, connection, gone } = useLiveGame({ roomCode, initial, runtime, view: 'public' });
  const fs = useFullscreenControls();

  // Escala toda la UI (rem) con la pantalla: 16px a 1920×1080.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.fontSize;
    root.style.fontSize = 'min(0.8333vw, 1.4815vh)';
    return () => {
      root.style.fontSize = prev;
    };
  }, []);

  const { game, players, auction } = snapshot;
  const finished = game.status === 'finished';
  const live = auction && auction.status !== 'cancelled' ? auction : null;
  const total = Math.max(game.total_rounds, 1);
  const round = Math.min(live ? live.round_number : game.rounds_completed + 1, total);
  const progress = Math.min(100, Math.round(((live?.status === 'awarded' ? round : round - 1) / total) * 100));
  const pill = statusPill(snapshot);
  const generating = players.some((p) => p.generating.length > 0);
  const { cols, rows } = gridFor(players.length);
  const leaderId = live && live.status !== 'awarded' ? live.current_bidder_id : null;
  const dense = rows > 1;
  const mobile = game.play_mode === 'mobile';
  const presence = mobile ? (game.status === 'lobby' ? 'lobby' : 'game') : null;
  const maxChips = cols >= 5 ? 5 : cols === 4 ? 6 : 8;

  const controls = (
    <div className={`absolute right-4 top-3 z-30 flex items-center gap-3 transition-opacity duration-500 ${fs.visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      <button
        type="button"
        onClick={fs.toggle}
        aria-label={fs.isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        className="flex items-center gap-2 rounded-xl border border-white/20 bg-night-800/90 px-4 py-2 text-[1.1rem] font-bold text-white hover:bg-night-700"
      >
        {fs.isFullscreen ? <Minimize2 className="size-5" aria-hidden /> : <Maximize2 className="size-5" aria-hidden />}
        {fs.isFullscreen ? 'Salir' : 'Pantalla completa'}
      </button>
    </div>
  );

  if (gone) return <GameGone roomCode={roomCode} />;
  if (finished) {
    return (
      <main className={`relative h-dvh w-screen overflow-hidden bg-night-950 text-white ${fs.visible ? '' : 'cursor-none'}`}>
        <FinalResults snapshot={snapshot} tv />
        {controls}
        <ConnectionBadge state={connection} runtime={runtime} className="absolute bottom-2 right-4 z-20 opacity-80" />
      </main>
    );
  }

  return (
    <main className={`relative flex h-dvh w-screen flex-col overflow-hidden bg-gradient-to-b from-night-900 via-night-950 to-night-950 text-white ${fs.visible ? '' : 'cursor-none'}`}>
      <header className="flex shrink-0 items-center gap-[1.5rem] border-b border-white/10 bg-night-950/70 px-[2rem] py-[0.6rem]">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[2.2rem] leading-tight text-white">{game.name}</h1>
          <p className="truncate text-[1rem] font-semibold text-white/60">
            {themeLabel(game.theme)} · Sala <span className="font-black tracking-widest text-gold-soft">{roomCode}</span>
          </p>
        </div>

        <div className="mx-auto flex min-w-[18rem] flex-col items-center gap-1.5" aria-label={`Ronda ${round} de ${total}`}>
          <p className="font-display text-[1.7rem] leading-none text-white">
            Ronda {round} <span className="text-white/50">de {total}</span>
          </p>
          <div className="h-[0.7rem] w-[22rem] overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(round, total)}>
            <div className="h-full rounded-full bg-gradient-to-r from-gold to-rose transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {mobile && game.status !== 'lobby' ? <CompactInvite roomCode={roomCode} /> : null}

        <div className="flex items-center gap-3" aria-live="polite">
          {generating ? (
            <span className="flex items-center gap-2 rounded-full bg-violet px-4 py-1.5 text-[1.2rem] font-black text-white">
              <Loader2 className="size-5 animate-spin" aria-hidden /> Generando imagen…
            </span>
          ) : null}
          <span className={`rounded-full px-5 py-1.5 font-display text-[1.4rem] uppercase tracking-wide ${pill.tone}`}>{pill.label}</span>
          <ConnectionBadge state={connection} runtime={runtime} className="opacity-70" />
        </div>
      </header>

      <section className="min-h-0 flex-1 px-[2rem] py-[1.2rem]">
        <AuctionStage snap={snapshot} compact={dense} />
      </section>

      <section
        className="shrink-0 px-[2rem] pb-[1.2rem]"
        style={{ height: rows === 1 ? '33%' : '46%' }}
        aria-label="Jugadores"
      >
        {players.length === 0 ? (
          <p className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/20 text-[1.6rem] text-white/60">Aún no hay jugadores en la sala.</p>
        ) : (
          <div className="mx-auto flex h-full flex-col gap-[1rem]">
            {Array.from({ length: rows }, (_, r) => players.slice(r * cols, (r + 1) * cols)).map((row, r) => (
              // Cada fila se centra por separado: la última (incompleta) queda centrada, no pegada a la izquierda.
              <div key={r} className="flex min-h-0 flex-1 justify-center gap-[1rem]">
                {row.map((p) => (
                  <div
                    key={p.id}
                    className="min-h-0"
                    style={{ width: `calc((100% - ${(cols - 1) * 1}rem) / ${cols})`, maxWidth: rows === 1 ? '28rem' : undefined }}
                  >
                    <PlayerCard player={p} leading={p.id === leaderId} maxChips={maxChips} dense={dense} presence={presence} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {game.status === 'paused' ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-night-950/85 backdrop-blur-sm" role="status">
          <Pause className="size-[7rem] text-gold" aria-hidden />
          <p className="font-display text-[5.5rem] text-white">Partida en pausa</p>
          <p className="text-[1.8rem] text-white/70">Enseguida continuamos…</p>
        </div>
      ) : null}

      <AwardOverlay award={snapshot.last_award} players={players} />
      {controls}
    </main>
  );
}
