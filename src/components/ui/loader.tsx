'use client';

import type { ReactNode } from 'react';
import { BrandMascot } from '@/components/mascot/mascot';

/**
 * Estado de carga de marca: la mascota flota (sin movimiento con prefers-reduced-motion) y un texto dice QUÉ se está haciendo.
 * Si el proceso falla o necesita intervención, pasa `failed`: se detiene la animación, se muestra el motivo real y, si hay
 * `onRetry`, un botón para reintentar. Nunca dejes un loader indefinido sin `failed`/tiempo máximo.
 */
export function Loader({ label = 'Cargando…', detail, failed, onRetry, retryLabel = 'Reintentar', compact = false, className = '' }: { label?: string; detail?: ReactNode; failed?: boolean; onRetry?: () => void; retryLabel?: string; compact?: boolean; className?: string }) {
  return (
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} className={`flex flex-col items-center gap-3 text-center ${compact ? 'py-4' : 'py-10'} ${className}`} data-testid={failed ? 'loader-failed' : 'loader'}>
      <BrandMascot part="head" size={compact ? 'xs' : 'sm'} motion={failed ? 'none' : 'bob'} />
      <p className={`font-display ${compact ? 'text-lg' : 'text-2xl'} ${failed ? 'text-rose' : 'text-gold'}`}>{label}</p>
      {detail ? <div className="max-w-md text-sm text-white/70">{detail}</div> : null}
      {failed && onRetry ? (
        <button type="button" onClick={onRetry} className="rounded-xl bg-gold px-5 py-2.5 text-sm font-extrabold text-night-950 hover:bg-gold-soft">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
