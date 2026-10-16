import { Wifi, WifiOff, RefreshCw, FlaskConical } from 'lucide-react';
import type { ConnectionState } from '@/lib/client/use-live-game';
import type { RuntimeInfo } from '@/lib/domain/types';

const LABELS: Record<ConnectionState, string> = {
  live: 'En directo',
  polling: 'Sincronizando',
  offline: 'Sin conexión · reintentando',
};

export function ConnectionBadge({ state, runtime, className = '' }: { state: ConnectionState; runtime?: RuntimeInfo; className?: string }) {
  const Icon = state === 'live' ? Wifi : state === 'offline' ? WifiOff : RefreshCw;
  const tone = state === 'live' ? 'text-teal' : state === 'offline' ? 'text-rose' : 'text-gold';
  const detail = state === 'polling' && runtime?.mode === 'demo' ? ' (sondeo local)' : '';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${tone} ${className}`} role="status">
      <Icon className={`size-4 ${state === 'polling' ? 'animate-spin-slow' : ''}`} aria-hidden />
      {LABELS[state]}
      {detail}
    </span>
  );
}

/** Aviso visible de que se ejecuta con datos locales y sin IA real. */
export function DemoBanner({ runtime }: { runtime: RuntimeInfo }) {
  if (runtime.mode !== 'demo') return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-gold px-3 py-1.5 text-center text-sm font-bold text-night-950">
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      MODO DEMO · datos locales ·{' '}
      {runtime.aiConfigured && runtime.aiProvider === 'openai'
        ? 'IA real activa (OPENAI_API_KEY)'
        : 'las imágenes son de muestra y NO están generadas por IA'}
    </div>
  );
}
