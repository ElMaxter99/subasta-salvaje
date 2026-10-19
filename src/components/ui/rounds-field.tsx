'use client';

import { Button } from './button';

/**
 * Máximo de rondas con su contexto: «X de N productos» y atajos «Todas / Mitad / 8». El tope es el catálogo (N) y el suelo las
 * rondas ya jugadas (`min`); la regla de verdad la hace cumplir SQL (`rounds_above_catalog`, `rounds_below_played`).
 * `value` vacío = todos los elementos.
 */
export function RoundsField({
  id,
  value,
  onChange,
  total,
  min = 1,
  inputClassName,
  disabled,
  testId = 'rounds',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Elementos del catálogo (tope). */
  total: number;
  min?: number;
  inputClassName: string;
  disabled?: boolean;
  testId?: string;
}) {
  const n = value.trim() === '' ? total : Number(value);
  const valid = Number.isInteger(n) && n >= Math.max(1, min) && n <= total;
  const clamp = (v: number) => Math.max(Math.max(1, min), Math.min(total, v));
  const shortcuts: { label: string; v: number }[] = [
    { label: 'Todas', v: total },
    { label: 'Mitad', v: Math.ceil(total / 2) },
    { label: '8', v: 8 },
  ].map((s) => ({ ...s, v: clamp(s.v) }));
  const unplayed = Math.max(total - n, 0);
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          className={`${inputClassName} !w-24`}
          inputMode="numeric"
          disabled={disabled}
          value={value}
          placeholder={String(total)}
          aria-invalid={!valid || undefined}
          aria-describedby={`${id}-count`}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
        />
        <span id={`${id}-count`} className="text-base font-bold" aria-live="polite" data-testid={`${testId}-count`}>
          {valid ? n : '—'} de {total} {total === 1 ? 'producto' : 'productos'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Atajos de rondas">
        {shortcuts.map((s) => (
          <Button key={s.label} type="button" size="sm" variant={valid && n === s.v ? 'primary' : 'secondary'} disabled={disabled} onClick={() => onChange(String(s.v))} aria-label={`${s.label}: ${s.v} rondas`}>
            {s.label}{s.label === '8' ? '' : ` (${s.v})`}
          </Button>
        ))}
      </div>
      <p className={`text-xs ${valid ? 'text-white/55' : 'font-semibold text-rose'}`}>
        {valid
          ? unplayed > 0
            ? `Se jugarán ${n} y ${unplayed} ${unplayed === 1 ? 'producto quedará' : 'productos quedarán'} sin subastar.`
            : 'Se subastarán todos los productos del catálogo.'
          : `Debe estar entre ${Math.max(1, min)} y ${total}${min > 1 ? ' (no puede bajar de las rondas ya jugadas)' : ''}.`}
      </p>
    </div>
  );
}
