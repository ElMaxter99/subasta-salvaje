'use client';

import { Check } from 'lucide-react';

export interface StepInfo {
  id: string;
  label: string;
}

/**
 * Indicador de pasos. En móvil: «Paso 2 de 5 · Partida» con barra de progreso. Desde `md`: círculos numerados con conectores y etiquetas.
 * Los pasos ya completados son botones para volver atrás; los futuros no se pueden saltar.
 */
export function Stepper({ steps, current, onGo }: { steps: StepInfo[]; current: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label="Pasos para crear la partida" className="space-y-3">
      {/* Móvil */}
      <div className="md:hidden">
        <p className="flex items-baseline justify-between text-sm font-bold text-white/70">
          <span>
            Paso {current + 1} de {steps.length}
          </span>
          <span className="font-display text-base text-gold">{steps[current]?.label}</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={current + 1} aria-label="Progreso">
          <div className="h-full rounded-full bg-gradient-to-r from-gold to-violet transition-all duration-500" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      {/* Escritorio / TV */}
      <ol className="hidden items-center md:flex">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.id} className="flex flex-1 items-center last:flex-none" aria-current={active ? 'step' : undefined}>
              <button
                type="button"
                disabled={!done}
                onClick={() => onGo(i)}
                className="group flex items-center gap-3 rounded-full py-1 pr-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/60 disabled:cursor-default"
                aria-label={`${s.label}${done ? ' (completado, volver)' : active ? ' (paso actual)' : ''}`}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-display text-lg transition-colors 2xl:size-12 2xl:text-xl ${
                    done ? 'border-teal bg-teal text-night-950' : active ? 'border-gold bg-gold text-night-950 shadow-[0_0_1.5rem_rgb(251_191_36/0.45)]' : 'border-white/20 bg-night-900 text-white/50'
                  }`}
                >
                  {done ? <Check className="size-5" aria-hidden /> : i + 1}
                </span>
                <span className={`text-sm font-bold 2xl:text-base ${active ? 'text-white' : done ? 'text-white/80 group-hover:text-white' : 'text-white/45'}`}>{s.label}</span>
              </button>
              {i < steps.length - 1 ? <span aria-hidden className={`mx-1 h-0.5 flex-1 rounded-full ${done ? 'bg-teal' : 'bg-white/15'}`} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
