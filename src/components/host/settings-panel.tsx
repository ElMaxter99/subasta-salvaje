'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Flag, History, Minus, Plus, Trophy, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatEuros, parseEurosToCents } from '@/lib/domain/money';
import type { RankingRule } from '@/lib/domain/types';
import { Card, Dot, Notice, inputCls } from './bits';
import type { HostCtx } from './host-context';

const RULES: { id: RankingRule; label: string; hint: string }[] = [
  { id: 'none', label: 'Ninguna', hint: 'Sin clasificación: solo se muestran los resultados.' },
  { id: 'balance', label: 'Más dinero', hint: 'Gana quien conserve más saldo.' },
  { id: 'items', label: 'Más elementos', hint: 'Gana quien compre más elementos.' },
  { id: 'votes', label: 'Votación del público', hint: 'Gana quien reciba más votos del público (los apuntas tú).' },
];

export function SettingsPanel({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run, roomCode } = ctx;
  const { game, players } = snapshot;
  const toast = useToast();
  const finished = game.status === 'finished';
  const [name, setName] = useState(game.name);
  const [minBid, setMinBid] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const minCents = parseEurosToCents(minBid);

  return (
    <div className="space-y-4">
      <Card title="Partida">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== game.name) void run('rename', { type: 'game.update', name: name.trim() }, 'Nombre actualizado');
          }}
        >
          <label htmlFor="game-name" className="text-sm font-semibold text-white/80">
            Nombre de la partida
          </label>
          <div className="flex gap-2">
            <input id="game-name" className={inputCls} value={name} maxLength={80} disabled={finished} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={finished || !name.trim() || name.trim() === game.name || busy !== null} loading={busy === 'rename'}>
              Guardar
            </Button>
          </div>
        </form>
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (minCents !== null && minCents > 0) void run('minbid', { type: 'game.update', min_bid_cents: minCents }, 'Puja mínima actualizada').then((r) => r && setMinBid(''));
          }}
        >
          <label htmlFor="min-bid" className="text-sm font-semibold text-white/80">
            Puja mínima (ahora {formatEuros(game.min_bid_cents)})
          </label>
          <div className="flex gap-2">
            <input id="min-bid" className={inputCls} inputMode="decimal" placeholder="Nuevo importe en €" value={minBid} disabled={finished} onChange={(e) => setMinBid(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={finished || !minCents || busy !== null} loading={busy === 'minbid'}>
              Guardar
            </Button>
          </div>
          <p className="text-xs text-white/55">No se puede cambiar mientras hay una subasta abierta.</p>
        </form>
      </Card>

      <Card title="Clasificación" icon={<Trophy className="size-5 text-gold" aria-hidden />}>
        <div role="radiogroup" aria-label="Regla de clasificación" className="grid gap-2 sm:grid-cols-2">
          {RULES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={game.ranking_rule === r.id}
              disabled={finished || busy !== null}
              onClick={() => game.ranking_rule !== r.id && run(`rule-${r.id}`, { type: 'game.update', ranking_rule: r.id }, `Clasificación: ${r.label}`)}
              className={`rounded-2xl border-2 p-3 text-left transition disabled:opacity-60 ${game.ranking_rule === r.id ? 'border-gold bg-gold/10' : 'border-white/10 bg-night-700 hover:bg-night-600'}`}
            >
              <b className="block">{r.label}</b>
              <span className="text-sm text-white/65">{r.hint}</span>
            </button>
          ))}
        </div>

        {game.ranking_rule === 'votes' ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-white/70">La votación del público es una mecánica aparte: sumar o restar votos no cambia el saldo de nadie.</p>
            {game.status === 'lobby' ? <Notice tone="info">Los votos se podrán apuntar cuando empiece la partida.</Notice> : null}
            <ul className="space-y-2">
              {players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-night-900 p-2 pl-3">
                  <Dot color={p.color} />
                  <span className="flex-1 truncate font-bold">{p.name}</span>
                  <Button size="md" variant="secondary" aria-label={`Quitar un voto a ${p.name}`} disabled={finished || game.status === 'lobby' || busy !== null || p.votes <= 0} onClick={() => run(`vote-${p.id}`, { type: 'votes.adjust', player_id: p.id, delta: -1 })}>
                    <Minus className="size-5" aria-hidden />
                  </Button>
                  <span className="w-10 text-center font-display text-2xl" aria-live="polite">
                    {p.votes}
                  </span>
                  <Button size="md" variant="success" aria-label={`Sumar un voto a ${p.name}`} disabled={finished || game.status === 'lobby' || busy !== null} onClick={() => run(`vote-${p.id}`, { type: 'votes.adjust', player_id: p.id, delta: 1 })}>
                    <Plus className="size-5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card title="Enlaces">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <LinkBtn href={`/game/${roomCode}/results`} icon={<Trophy className="size-4" aria-hidden />}>
            Resultados
          </LinkBtn>
          <LinkBtn href={`/game/${roomCode}/history`} icon={<History className="size-4" aria-hidden />}>
            Historial de imágenes
          </LinkBtn>
          <LinkBtn href={`/game/${roomCode}/screen`} icon={<Tv className="size-4" aria-hidden />} newTab>
            Pantalla de TV
          </LinkBtn>
        </div>
      </Card>

      {finished ? (
        <Notice tone="ok">
          Partida finalizada. La pantalla de TV muestra los resultados. <Link className="underline" href={`/game/${roomCode}/results`}>Ver resultados</Link>
        </Notice>
      ) : (
        <Card title="Zona de peligro" className="border-rose/40">
          <p className="mb-3 text-sm text-white/75">Al finalizar, la partida se cierra para siempre: se cancela cualquier subasta en curso (sin cobrar) y la TV pasa a mostrar los resultados.</p>
          <Button variant="danger" size="lg" disabled={game.status === 'lobby' || busy !== null} onClick={() => { setTyped(''); setFinishOpen(true); }}>
            <Flag className="size-5" aria-hidden /> Finalizar partida
          </Button>
          {game.status === 'lobby' ? <p className="mt-2 text-xs text-white/55">Disponible cuando la partida haya empezado.</p> : null}
        </Card>
      )}

      <ConfirmDialog
        open={finishOpen}
        title="¿Finalizar la partida?"
        confirmLabel="Finalizar definitivamente"
        variant="danger"
        loading={busy === 'finish'}
        onCancel={() => setFinishOpen(false)}
        onConfirm={async () => {
          if (typed.trim().toUpperCase() !== 'FINALIZAR') return toast.error('Escribe FINALIZAR para confirmar.');
          const res = await run('finish', { type: 'game.finish' }, 'Partida finalizada');
          if (res) setFinishOpen(false);
        }}
      >
        <p>No se podrá reanudar. Escribe <b>FINALIZAR</b> para confirmar.</p>
        <label htmlFor="finish-confirm" className="sr-only">
          Escribe FINALIZAR
        </label>
        <input id="finish-confirm" className={`${inputCls} mt-2`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="FINALIZAR" />
      </ConfirmDialog>
    </div>
  );
}

function LinkBtn({ href, icon, children, newTab }: { href: string; icon: React.ReactNode; children: React.ReactNode; newTab?: boolean }) {
  return (
    <Link href={href} {...(newTab ? { target: '_blank', rel: 'noopener' } : {})} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-night-700 px-4 py-2 font-bold hover:bg-night-600">
      {icon}
      {children}
    </Link>
  );
}
