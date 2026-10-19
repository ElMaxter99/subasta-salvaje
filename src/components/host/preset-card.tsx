'use client';

import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PRESETS, planPreset, presetContextFromSnapshot, type PresetId } from '@/lib/domain/presets';
import { Card, Notice } from './bits';
import type { HostCtx } from './host-context';

/**
 * «Aplicar preset»: rellena de una vez presupuesto, puja mínima, rondas, pujas enteras, adjudicación/subasta automática,
 * sorpresas y máximo de jugadores. Antes de aplicar muestra qué cambia. Sirve también con la partida en marcha, solo para lo que
 * SQL permite (sin presupuesto; rondas nunca por debajo de las jugadas; sin puja mínima con una subasta abierta).
 */
export function PresetCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const [sel, setSel] = useState<PresetId | null>(null);
  const finished = snapshot.game.status === 'finished';
  const plan = sel ? planPreset(sel, presetContextFromSnapshot(snapshot)) : null;

  return (
    <Card title="Preset de partida" icon={<Wand2 className="size-5 text-gold" aria-hidden />} className="border-gold/30">
      <p className="mb-3 text-sm text-white/70">Un preset ajusta de golpe el dinero, las rondas y el ritmo. Después puedes cambiar cualquier valor por separado en las tarjetas de abajo.</p>
      <div className="grid gap-2 sm:grid-cols-2" data-testid="preset-list">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={finished || busy !== null}
            onClick={() => setSel(p.id)}
            data-testid={`preset-${p.id}`}
            className="rounded-2xl border-2 border-white/10 bg-night-700 p-3 text-left transition hover:bg-night-600 disabled:opacity-60"
          >
            <b className="block">{p.emoji} {p.label}</b>
            <span className="text-sm text-white/65">{p.desc}</span>
          </button>
        ))}
      </div>
      <ConfirmDialog
        open={plan !== null}
        title={plan ? `Aplicar «${plan.preset.label}»` : ''}
        confirmLabel={plan && plan.changes.length === 0 ? 'Cerrar' : 'Aplicar'}
        variant="primary"
        loading={busy === 'preset'}
        onCancel={() => setSel(null)}
        onConfirm={async () => {
          if (!plan || !sel) return;
          if (plan.changes.length === 0) return setSel(null);
          const r = await run('preset', { type: 'game.apply_preset', preset_id: sel }, `Preset «${plan.preset.label}» aplicado`);
          if (r) setSel(null);
        }}
      >
        {plan ? <PresetChanges plan={plan} lobby={snapshot.game.status === 'lobby'} /> : null}
      </ConfirmDialog>
    </Card>
  );
}

export function PresetChanges({ plan, lobby }: { plan: ReturnType<typeof planPreset>; lobby: boolean }) {
  return (
    <div className="space-y-3" data-testid="preset-changes">
      {plan.changes.length === 0 ? (
        <p>Ya está todo como en este preset: no hay nada que cambiar.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {plan.changes.map((c) => (
            <li key={c.key} className="flex flex-wrap justify-between gap-x-3 rounded-xl bg-night-900 px-3 py-2">
              <span>{c.label}</span>
              <span className="font-bold"><span className="text-white/55 line-through">{c.from}</span> → <span className="text-gold">{c.to}</span></span>
            </li>
          ))}
        </ul>
      )}
      {plan.changes.some((c) => c.key === 'initial_budget_cents') && lobby ? <p className="text-sm text-white/70">El presupuesto se aplica a todos los jugadores (también sustituye los presupuestos individuales que hayas puesto).</p> : null}
      {plan.notes.map((n) => <Notice key={n} tone="info">{n}</Notice>)}
      {plan.skipped.length > 0 ? (
        <Notice tone="warn">
          No se pueden cambiar ahora: {plan.skipped.map((s) => `${s.label} (${s.reason})`).join('; ')}.
        </Notice>
      ) : null}
      <p className="text-xs text-white/55">No enciende ni apaga la subasta automática: solo ajusta sus tiempos.</p>
    </div>
  );
}
