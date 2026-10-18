import type { ReactNode } from 'react';
import { ImageIcon } from 'lucide-react';

export function Card({ title, icon, children, className = '', action }: { title?: string; icon?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-night-800/80 p-4 sm:p-5 ${className}`}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg uppercase tracking-tight text-white">
            {icon}
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Dot({ color, className = 'size-4' }: { color: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ring-2 ring-white/30 ${className}`} style={{ background: color }} aria-hidden />;
}

export function Thumb({ url, alt, className = 'size-16' }: { url?: string | null; alt: string; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className={`${className} shrink-0 rounded-xl bg-night-950 object-cover`} />
  ) : (
    <span className={`${className} flex shrink-0 items-center justify-center rounded-xl border border-dashed border-white/20 bg-night-950 text-white/55`} role="img" aria-label={`${alt}: sin imagen`}>
      <ImageIcon className="size-1/3" aria-hidden />
    </span>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'gold' | 'teal' | 'rose' | 'violet'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-white/10 text-white/80',
    gold: 'bg-gold/20 text-gold',
    teal: 'bg-teal/20 text-teal',
    rose: 'bg-rose/20 text-rose',
    violet: 'bg-violet/25 text-violet-soft',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const tones = { info: 'border-violet/40 bg-violet/10 text-violet-soft', warn: 'border-gold/50 bg-gold/10 text-gold-soft', ok: 'border-teal/40 bg-teal/10 text-teal' };
  return <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${tones[tone]}`}>{children}</div>;
}

export const inputCls = 'min-h-11 w-full rounded-xl border border-white/15 bg-night-950 px-3 py-2 text-base text-white placeholder:text-white/55';

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const STATUS_LABEL = { lobby: 'Sala de espera', active: 'En curso', paused: 'Pausada', finished: 'Finalizada' } as const;
