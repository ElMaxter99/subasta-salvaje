'use client';

import { MAX_PLAYERS } from '@/lib/domain/limits';
import { useState } from 'react';
import Link from 'next/link';
import { Clapperboard, Flag, History, RotateCcw, Minus, Plus, Smartphone, Trophy, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseOhrosToCents } from '@/lib/domain/money';
import type { ImageMode, JoinPolicy, PlayMode, RankingRule } from '@/lib/domain/types';
import { TemplateExportCard } from './template-export-card';
import { DeleteGameCard } from './delete-game-card';
import { ExportGameCard } from './export-game-card';
import { FinishGameDialog } from './finish-dialog';
import { ResetGameDialog } from './reset-dialog';
import { Card, Dot, Notice, inputCls } from './bits';
import type { HostCtx } from './host-context';
import { Ohros } from '@/components/ui/ohros';

const RULES: { id: RankingRule; label: string; hint: string }[] = [
  { id: 'none', label: 'Ninguna', hint: 'Sin clasificación: solo se muestran los resultados.' },
  { id: 'balance', label: 'Más dinero', hint: 'Gana quien conserve más saldo.' },
  { id: 'items', label: 'Más elementos', hint: 'Gana quien compre más elementos.' },
  { id: 'votes', label: 'Votación del público', hint: 'Gana quien reciba más votos del público (los apuntas tú).' },
];

const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: 'host', label: 'Pujas del anfitrión', hint: 'Los jugadores pujan en voz alta y tú registras cada puja desde tu panel. No necesitan móvil ni cuenta.' },
  { id: 'mobile', label: 'Cada jugador desde su móvil', hint: 'Los jugadores se unen con el código de sala (o un QR), eligen su nombre y pujan ellos mismos. Tú sigues anunciando, cerrando y adjudicando.' },
];

const POLICIES: { id: JoinPolicy; label: string; hint: string }[] = [
  { id: 'open', label: 'Abierta', hint: 'Se puede reclamar una casilla libre o entrar con un nombre nuevo (solo en la sala de espera).' },
  { id: 'slots', label: 'Solo mis jugadores', hint: 'Solo se pueden reclamar las casillas que ya creaste; no se admiten nombres nuevos.' },
  { id: 'closed', label: 'Cerrada', hint: 'Nadie nuevo puede unirse (ni casillas libres). Los móviles ya conectados siguen jugando.' },
];

const IMAGE_MODES: { id: ImageMode; label: string; hint: string }[] = [
  { id: 'stickers', label: '🎨 Pegatinas con emojis', hint: 'Sin IA, gratis e instantáneo: cada compra añade el emoji del elemento a la casa.' },
  { id: 'ai', label: '✨ Con inteligencia artificial', hint: 'La IA genera y edita las casas. Con límites de generaciones por partida y por día.' },
];

export function SettingsPanel({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run, roomCode } = ctx;
  const { game, players } = snapshot;
  const finished = game.status === 'finished';
  const [name, setName] = useState(game.name);
  const [minBid, setMinBid] = useState('');
  const [rounds, setRounds] = useState(String(game.total_rounds));
  const [maxPlayers, setMaxPlayers] = useState(String(game.max_players ?? MAX_PLAYERS));
  const [finishOpen, setFinishOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const minCents = parseOhrosToCents(minBid);

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
            Puja mínima (ahora <Ohros cents={game.min_bid_cents} />)
          </label>
          <div className="flex gap-2">
            <input id="min-bid" className={inputCls} inputMode="decimal" placeholder="Nuevo importe en Ohros" value={minBid} disabled={finished} onChange={(e) => setMinBid(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={finished || !minCents || busy !== null} loading={busy === 'minbid'}>
              Guardar
            </Button>
          </div>
          <p className="text-xs text-white/55">No se puede cambiar mientras hay una subasta abierta.</p>
        </form>
      </Card>

 <Card title="Jugadores" icon={<Flag className="size-5 text-gold" aria-hidden />}>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(maxPlayers);
            if (Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS) void run('maxplayers', { type: 'game.set_rules', max_players: n }, 'Máximo de jugadores actualizado');
          }}
        >
          <label htmlFor="max-players" className="text-sm font-semibold text-white/80">
            Máximo de jugadores (ahora {game.max_players ?? MAX_PLAYERS}; hay {snapshot.players.length})
          </label>
          <div className="flex gap-2">
            <input id="max-players" className={inputCls} inputMode="numeric" value={maxPlayers} disabled={finished} onChange={(e) => setMaxPlayers(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <Button type="submit" variant="secondary" disabled={finished || !maxPlayers || Number(maxPlayers) < 1 || Number(maxPlayers) > MAX_PLAYERS || Number(maxPlayers) === (game.max_players ?? MAX_PLAYERS) || busy !== null} loading={busy === 'maxplayers'}>
              Guardar
            </Button>
          </div>
          <p className="text-xs text-white/55">Entre 1 y {MAX_PLAYERS} (límite de la aplicación). Con el máximo alcanzado nadie más puede unirse, ni siquiera con el código de la partida.</p>
        </form>
      </Card>

      <Card title="Rondas y pujas" icon={<Flag className="size-5 text-gold" aria-hidden />}>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(rounds);
            if (Number.isInteger(n) && n >= 1 && n <= snapshot.items.length) void run('rounds', { type: 'game.set_rules', max_rounds: n }, 'Máximo de rondas actualizado');
          }}
        >
          <label htmlFor="max-rounds" className="text-sm font-semibold text-white/80">
            Máximo de rondas (ahora {game.total_rounds}; jugadas {game.rounds_completed})
          </label>
          <div className="flex gap-2">
            <input id="max-rounds" className={inputCls} inputMode="numeric" value={rounds} disabled={finished} onChange={(e) => setRounds(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            <Button type="submit" variant="secondary" disabled={finished || !rounds || Number(rounds) < 1 || Number(rounds) > snapshot.items.length || Number(rounds) === game.total_rounds || busy !== null} loading={busy === 'rounds'}>
              Guardar
            </Button>
          </div>
          <p className="text-xs text-white/55">Al jugarse todas las rondas (adjudicadas o canceladas) la partida termina sola. Mínimo: las rondas ya jugadas ({game.rounds_completed}); máximo: los {snapshot.items.length} elementos del catálogo.</p>
        </form>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-night-900 p-3">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-[#fbbf24]"
            checked={game.integer_bids !== false}
            disabled={finished || busy !== null}
            onChange={(e) => run('integer', { type: 'game.set_rules', integer_bids: e.target.checked }, e.target.checked ? 'Solo se puja en Ohros enteros' : 'Ahora se pueden pujar décimas (1,50 Ohros)')}
          />
          <span>
            <b className="block">Solo pujas en Ohros enteros</b>
            <span className="text-sm text-white/65">Activado: 1, 2, 3… Ohros. Desactivado: también 1,50 Ohros, 2,25 Ohros… (se aplica a las próximas pujas).</span>
          </span>
        </label>
      </Card>

      <Card title="Modo de imágenes" icon={<Smartphone className="size-5 text-gold" aria-hidden />}>
        <div role="radiogroup" aria-label="Modo de imágenes" className="grid gap-2 sm:grid-cols-2">
          {IMAGE_MODES.map((m) => {
            const unavailable = m.id === 'ai' && !ctx.runtime.aiConfigured;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={game.image_mode === m.id}
                disabled={game.status !== 'lobby' || busy !== null || unavailable}
                onClick={() => game.image_mode !== m.id && run(`imode-${m.id}`, { type: 'game.set_image_mode', image_mode: m.id }, `Modo de imágenes: ${m.label}`)}
                className={`rounded-2xl border-2 p-3 text-left transition disabled:opacity-60 ${game.image_mode === m.id ? 'border-gold bg-gold/10' : 'border-white/10 bg-night-700 hover:bg-night-600'}`}
              >
                <b className="block">{m.label}</b>
                <span className="text-sm text-white/65">{unavailable ? 'No disponible: no hay proveedor de IA configurado (IMAGE_PROVIDER).' : m.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-white/70">Solo se puede cambiar en la sala de espera, antes de empezar. Si ya generaste imágenes iniciales, se conservan en el historial.</p>
      </Card>

      <Card title="Modalidad de juego" icon={<Smartphone className="size-5 text-gold" aria-hidden />}>
        <div role="radiogroup" aria-label="Modalidad de juego" className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={game.play_mode === m.id}
              disabled={finished || busy !== null}
              onClick={() => game.play_mode !== m.id && run(`mode-${m.id}`, { type: 'game.set_mode', play_mode: m.id }, `Modalidad: ${m.label}`)}
              className={`rounded-2xl border-2 p-3 text-left transition disabled:opacity-60 ${game.play_mode === m.id ? 'border-gold bg-gold/10' : 'border-white/10 bg-night-700 hover:bg-night-600'}`}
            >
              <b className="block">{m.label}</b>
              <span className="text-sm text-white/65">{m.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-white/70">
          Puedes cambiarla en cualquier momento. En modo móviles aparece el código/QR para unirse y puedes seguir registrando pujas a mano; al volver al modo anfitrión, los móviles ya no pueden pujar.
        </p>
      </Card>

      {game.play_mode === 'mobile' ? (
        <Card title="Quién puede unirse desde el móvil" icon={<Smartphone className="size-5 text-gold" aria-hidden />}>
          <div role="radiogroup" aria-label="Política de altas" className="grid gap-2 sm:grid-cols-3">
            {POLICIES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={game.join_policy === m.id}
                disabled={finished || busy !== null}
                onClick={() => game.join_policy !== m.id && run(`policy-${m.id}`, { type: 'game.set_join_policy', join_policy: m.id }, `Altas: ${m.label}`)}
                className={`rounded-2xl border-2 p-3 text-left transition disabled:opacity-60 ${game.join_policy === m.id ? 'border-gold bg-gold/10' : 'border-white/10 bg-night-700 hover:bg-night-600'}`}
              >
                <b className="block">{m.label}</b>
                <span className="text-sm text-white/65">{m.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-white/70">Cualquiera con el código de sala puede intentar unirse: cierra la sala cuando estén todos dentro. Si liberas una casilla, ábrela solo el tiempo necesario.</p>
        </Card>
      ) : null}

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

      <TemplateExportCard ctx={ctx} />

      <Card title="Enlaces">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <LinkBtn href={`/game/${roomCode}/results`} icon={<Trophy className="size-4" aria-hidden />}>
            Resultados
          </LinkBtn>
          <LinkBtn href={`/game/${roomCode}/history`} icon={<History className="size-4" aria-hidden />}>
            Historial de imágenes
          </LinkBtn>
          <LinkBtn href={`/game/${roomCode}/replay`} icon={<Clapperboard className="size-4" aria-hidden />}>
            Repetición de la partida
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
          <Button variant="danger" size="lg" disabled={game.status === 'lobby' || busy !== null} onClick={() => setFinishOpen(true)}>
            <Flag className="size-5" aria-hidden /> Finalizar partida
          </Button>
          {game.status === 'lobby' ? <p className="mt-2 text-xs text-white/55">Disponible cuando la partida haya empezado.</p> : null}
        </Card>
      )}

      <Card title="Reiniciar partida" className="border-rose/40">
        <p className="mb-3 text-sm text-white/75">Deja la partida como en la sala de espera, antes de empezar: borra subastas, compras, historial y las imágenes generadas, y devuelve a cada jugador su imagen inicial y su presupuesto. Útil para repetir pruebas.</p>
        <Button variant="danger" size="lg" disabled={busy !== null} onClick={() => setResetOpen(true)}>
          <RotateCcw className="size-5" aria-hidden /> Reiniciar partida
        </Button>
      </Card>

      <FinishGameDialog ctx={ctx} open={finishOpen} onClose={() => setFinishOpen(false)} />
      <ResetGameDialog ctx={ctx} open={resetOpen} onClose={() => setResetOpen(false)} />

      <ExportGameCard ctx={ctx} />
      <DeleteGameCard ctx={ctx} />
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
