'use client';

import { MAX_PLAYERS } from '@/lib/domain/limits';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, History, Pencil, Plus, Smartphone, Sparkles, Trash2, Upload, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { uploadInitialImage } from '@/lib/client/api';
import { formatOhros, parseOhrosToCents } from '@/lib/domain/money';
import { PLAYER_COLORS } from '@/lib/domain/schemas';
import type { Player } from '@/lib/domain/types';
import { Card, Dot, Notice, Pill, Thumb, inputCls } from './bits';
import type { HostCtx } from './host-context';
import { InitialImageCard } from './initial-image-card';
import { JoinCard } from './join-card';
import { Ohros } from '@/components/ui/ohros';

const MAX_BYTES = 25 * 1024 * 1024; // el original puede ser grande: se reduce en el navegador antes de subirlo
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PLAYER_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`Color ${c}`} onClick={() => onChange(c)} className={`size-9 rounded-full border-2 ${value === c ? 'scale-110 border-white' : 'border-transparent'}`} style={{ background: c }} />
      ))}
    </div>
  );
}

export function PlayersPanel({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const { game, players } = snapshot;
  const maxPlayers = game.max_players ?? MAX_PLAYERS;
  const lobby = game.status === 'lobby';
  const finished = game.status === 'finished';
  const unusedColor = PLAYER_COLORS.find((c) => !players.some((p) => p.color === c)) ?? PLAYER_COLORS[0]!;
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [removing, setRemoving] = useState<Player | null>(null);
  const [releasing, setReleasing] = useState<Player | null>(null);
  const budgetCents = parseOhrosToCents(budget);
  const aiMode = game.image_mode === 'ai';

  async function add() {
    if (!name.trim()) return;
    const res = await run('player-add', { type: 'player.add', name: name.trim(), color: color ?? unusedColor }, `${name.trim()} añadido`);
    if (res) {
      setName('');
      setColor(null);
    }
  }

  function move(i: number, d: -1 | 1) {
    const ids = players.map((p) => p.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run('player-move', { type: 'player.reorder', ordered_ids: ids });
  }

  return (
    <div className="space-y-4">
      {lobby ? (
        <Card title="Presupuesto inicial" icon={<Wallet className="size-5 text-gold" aria-hidden />}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (budgetCents !== null) void run('budget', { type: 'game.update', initial_budget_cents: budgetCents }, 'Presupuesto actualizado para todos').then((r) => r && setBudget(''));
            }}
          >
            <div className="flex-1">
              <label htmlFor="budget" className="sr-only">
                Presupuesto inicial en Ohros
              </label>
              <input id="budget" className={inputCls} inputMode="decimal" placeholder={`Ahora: ${formatOhros(game.initial_budget_cents)} · nuevo importe en Ohros`} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" disabled={budgetCents === null || busy !== null} loading={busy === 'budget'}>
              Guardar
            </Button>
          </form>
          <p className="mt-2 text-sm text-white/60">Cada jugador recibe <Ohros cents={game.initial_budget_cents} />. Cambiarlo reinicia el saldo de todos (solo antes de empezar).</p>
        </Card>
      ) : null}

      {lobby && aiMode && !ctx.runtime.aiConfigured ? (
        <Notice tone="warn">IA no configurada: las imágenes iniciales quedan en cola. Puedes subir una imagen propia, elegir de la galería o cambiar al modo pegatinas en Ajustes.</Notice>
      ) : null}
      {lobby && !aiMode ? <Notice tone="info">Modo pegatinas: «Generar imagen inicial» dibuja una escena vacía local (sin IA). También puedes subir una imagen o elegir de la galería.</Notice> : null}

      <JoinCard ctx={ctx} />

      {lobby ? <InitialImageCard ctx={ctx} /> : null}

      <ul className="space-y-3">
        {players.map((p, i) => (
          <PlayerRow key={p.id} ctx={ctx} player={p} index={i} total={players.length} onMove={move} onRemove={() => setRemoving(p)} onRelease={() => setReleasing(p)} />
        ))}
      </ul>

      {lobby ? (
        <Card title="Añadir jugador" icon={<Plus className="size-5 text-gold" aria-hidden />}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div>
              <label htmlFor="new-player" className="text-sm font-semibold text-white/80">
                Nombre
              </label>
              <input id="new-player" className={inputCls} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Nombre del jugador" autoComplete="off" />
            </div>
            <ColorPicker value={color ?? unusedColor} onChange={setColor} label="Color del jugador" />
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!name.trim() || players.length >= maxPlayers || busy !== null} loading={busy === 'player-add'}>
              <Plus className="size-5" aria-hidden /> Añadir jugador
            </Button>
            {players.length >= maxPlayers ? <p className="text-sm text-white/60">Máximo {maxPlayers} jugadores en esta partida (se cambia en Ajustes).</p> : null}
          </form>
        </Card>
      ) : finished ? null : (
        <p className="text-sm text-white/60">Con la partida en marcha ya no se pueden añadir, eliminar ni reordenar jugadores.</p>
      )}

      <ConfirmDialog
        open={!!releasing}
        title="Liberar móvil"
        confirmLabel="Sí, liberar"
        variant="danger"
        loading={busy === 'player-release'}
        onCancel={() => setReleasing(null)}
        onConfirm={async () => {
          if (releasing) await run('player-release', { type: 'player.release', player_id: releasing.id }, `Casilla de ${releasing.name} liberada`);
          setReleasing(null);
        }}
      >
        <p>
          Se desvinculará el móvil de <b>{releasing?.name}</b> y la casilla quedará libre para que alguien la reclame de nuevo. Úsalo si el jugador cambió de móvil o perdió la sesión. No se pierde saldo ni compras.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removing}
        title="Eliminar jugador"
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={busy === 'player-remove'}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await run('player-remove', { type: 'player.remove', player_id: removing.id }, `${removing.name} eliminado`);
          setRemoving(null);
        }}
      >
        <p>
          Se eliminará a <b>{removing?.name}</b> y sus imágenes. Esta acción no se puede deshacer.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function PlayerRow({ ctx, player: p, index, total, onMove, onRemove, onRelease }: { ctx: HostCtx; player: Player; index: number; total: number; onMove: (i: number, d: -1 | 1) => void; onRemove: () => void; onRelease: () => void }) {
  const { snapshot, busy, run, exec, roomCode } = ctx;
  const toast = useToast();
  const lobby = snapshot.game.status === 'lobby';
  const finished = snapshot.game.status === 'finished';
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [color, setColor] = useState(p.color);
  const initialJob = p.generating.find((g) => g.kind === 'initial');

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error('Formato no válido. Usa PNG, JPEG o WebP.');
    if (file.size > MAX_BYTES) return toast.error('La imagen supera los 25 MB.');
    await exec(`upload-${p.id}`, () => uploadInitialImage(roomCode, p.id, file), `Imagen de ${p.name} subida`);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <li className="rounded-3xl border border-white/10 bg-night-800/80 p-4" style={{ borderLeftColor: p.color, borderLeftWidth: 6 }}>
      <div className="flex items-start gap-3">
        <Thumb url={p.current_image?.url} alt={`Imagen de ${p.name}`} className="size-20" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-display text-xl">
            <Dot color={p.color} />
            <span className="truncate">{p.name}</span>
          </h3>
          <p className="text-lg font-bold text-gold"><Ohros cents={p.balance_cents} /></p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {snapshot.game.play_mode === 'mobile' ? p.claimed ? <Pill tone="teal">📱 Conectado</Pill> : <Pill>Libre</Pill> : null}
            <Pill>{p.purchases.length} {p.purchases.length === 1 ? 'elemento' : 'elementos'}</Pill>
            {p.generating.length > 0 ? <Pill tone="violet">Imagen en preparación</Pill> : p.current_image ? <Pill tone="teal">Imagen lista{p.current_image.provider === 'demo' ? ' (muestra)' : p.current_image.provider === 'catalog' ? ' (galería)' : ''}</Pill> : <Pill tone="rose">Sin imagen</Pill>}
          </div>
          {p.purchases.length > 0 ? <p className="mt-1 truncate text-sm text-white/60">{p.purchases.map((x) => `${x.emoji ?? ''} ${x.name}`).join(' · ')}</p> : null}
        </div>
        {lobby ? (
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="ghost" aria-label={`Subir a ${p.name}`} disabled={index === 0 || busy !== null} onClick={() => onMove(index, -1)}>
              <ArrowUp className="size-5" aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Bajar a ${p.name}`} disabled={index === total - 1 || busy !== null} onClick={() => onMove(index, 1)}>
              <ArrowDown className="size-5" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-3 space-y-3 rounded-2xl bg-night-900 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run(`player-edit-${p.id}`, { type: 'player.update', player_id: p.id, name: name.trim(), color }, 'Jugador actualizado');
            if (res) setEditing(false);
          }}
        >
          <label htmlFor={`name-${p.id}`} className="text-sm font-semibold text-white/80">
            Nombre
          </label>
          <input id={`name-${p.id}`} className={inputCls} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <ColorPicker value={color} onChange={setColor} label={`Color de ${p.name}`} />
          <div className="flex gap-2">
            <Button type="submit" variant="success" disabled={!name.trim() || busy !== null} loading={busy === `player-edit-${p.id}`}>
              Guardar
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {!finished ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {lobby ? (
            <>
              <Button size="md" variant="secondary" disabled={busy !== null || !!initialJob} loading={busy === `gen-${p.id}`} onClick={() => run(`gen-${p.id}`, { type: 'image.request_initial', player_id: p.id }, 'Imagen inicial solicitada')}>
                <Sparkles className="size-4" aria-hidden /> {initialJob ? 'Generando…' : 'Generar imagen inicial'}
              </Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id={`file-${p.id}`} aria-label={`Imagen de ${p.name}`} tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
              <Button size="md" variant="secondary" disabled={busy !== null} loading={busy === `upload-${p.id}`} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" aria-hidden /> Subir imagen
              </Button>
            </>
          ) : null}
          {snapshot.game.play_mode === 'mobile' && p.claimed ? (
            <Button size="md" variant="ghost" disabled={busy !== null} onClick={onRelease}>
              <Smartphone className="size-4" aria-hidden /> Liberar móvil
            </Button>
          ) : null}
          <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => setEditing((v) => !v)}>
            <Pencil className="size-4" aria-hidden /> Editar
          </Button>
          {lobby ? (
            <Button size="md" variant="ghost" className="text-rose" disabled={busy !== null} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden /> Eliminar
            </Button>
          ) : null}
        </div>
      ) : null}
      <Link href={`/game/${roomCode}/history?player=${p.id}`} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-violet-soft underline-offset-4 hover:underline">
        <History className="size-4" aria-hidden /> Historial de imágenes
      </Link>
    </li>
  );
}
