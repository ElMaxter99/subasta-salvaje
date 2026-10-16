import type { ReactNode } from 'react';
import { formatBytes } from '@/lib/domain/format';

export function Section({ title, hint, children, action }: { title: string; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-night-800/80 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg uppercase tracking-tight">{title}</h2>
          {hint ? <p className="mt-0.5 max-w-3xl text-sm text-white/60">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-night-900 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-white/55">{label}</p>
      <p className="font-display text-2xl tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-white/55">{sub}</p> : null}
    </div>
  );
}

/** Barra de uso. Solo informativa (sin alertas): cambia de color a partir del 70 % y 90 % como referencia visual. */
export function UsageBar({ label, used, limit, note }: { label: string; used: number | null; limit: number; note?: ReactNode }) {
  const pct = used === null ? 0 : Math.min(100, (used / limit) * 100);
  const tone = pct >= 90 ? 'bg-rose' : pct >= 70 ? 'bg-gold' : 'bg-teal';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">{label}</span>
        <span className="tabular-nums text-white/75">
          {used === null ? 'sin datos' : `${formatBytes(used)} de ${formatBytes(limit)} · ${pct.toFixed(1).replace('.', ',')} %`}
        </span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-night-950" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {note ? <p className="mt-1 text-xs text-white/55">{note}</p> : null}
    </div>
  );
}

/** Barras verticales simples (SVG propio, sin librerías). */
export function MiniBars({ data, label }: { data: { day: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const w = 28;
  return (
    <figure>
      <svg viewBox={`0 0 ${data.length * w} 90`} className="h-28 w-full" role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = Math.round((d.count / max) * 60);
          return (
            <g key={d.day}>
              <rect x={i * w + 4} y={70 - h} width={w - 8} height={Math.max(h, d.count > 0 ? 2 : 0)} rx={3} className="fill-gold" />
              <text x={i * w + w / 2} y={66 - h} textAnchor="middle" className="fill-white/80" fontSize="9">{d.count || ''}</text>
              <text x={i * w + w / 2} y={84} textAnchor="middle" className="fill-white/50" fontSize="8">{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-white/55">
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-2 font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
      {empty ? <p className="px-2 py-4 text-sm text-white/55">{empty}</p> : null}
    </div>
  );
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
