import type { AdminStats } from '@/lib/services/admin-stats-service';
import { MiniBars, Section, Stat, Table, fmtDate } from './widgets';

const STATUS_LABEL: Record<string, string> = { lobby: 'En sala de espera', active: 'En marcha', paused: 'En pausa', finished: 'Terminadas' };
const JOB_LABEL: Record<string, string> = { queued: 'En cola', running: 'En curso', completed: 'Completados', failed: 'Fallidos' };
const pct = (ok: number, failed: number) => (ok + failed === 0 ? '—' : `${Math.round((ok / (ok + failed)) * 100)} %`);
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Barras apiladas «correctas / fallidas» por día (SVG propio). La tabla de debajo da los mismos datos. */
function OkFailBars({ data, label }: { data: { day: string; ok: number; failed: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.ok + d.failed));
  const w = 28;
  return (
    <figure>
      <svg viewBox={`0 0 ${data.length * w} 90`} className="h-28 w-full" role="img" aria-label={label}>
        {data.map((d, i) => {
          const okH = Math.round((d.ok / max) * 60);
          const failH = Math.round((d.failed / max) * 60);
          return (
            <g key={d.day}>
              <rect x={i * w + 4} y={70 - okH} width={w - 8} height={okH} className="fill-teal" />
              <rect x={i * w + 4} y={70 - okH - failH} width={w - 8} height={failH} className="fill-rose" />
              <text x={i * w + w / 2} y={84} textAnchor="middle" className="fill-white/50" fontSize="8">{dayLabel(d.day)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex gap-4 text-xs text-white/65">
        <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-sm bg-teal" />Correctas</span>
        <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-sm bg-rose" />Fallidas</span>
      </figcaption>
    </figure>
  );
}

/** Estadísticas del superadmin: solo lectura. Cada gráfico lleva su tabla equivalente. */
export function StatsView({ stats }: { stats: AdminStats }) {
  const { games, templates, ai } = stats;
  const aiDays = [...new Set(ai.perDay.map((r) => r.day))].sort();
  const aiTotals = aiDays.map((day) => ({ day, ok: ai.perDay.filter((r) => r.day === day).reduce((n, r) => n + r.ok, 0), failed: ai.perDay.filter((r) => r.day === day).reduce((n, r) => n + r.failed, 0) }));
  const last30Total = games.perDay.reduce((n, d) => n + d.count, 0);
  return (
    <div className="space-y-5">
      <Section title="Partidas creadas por día" hint={`Últimos 30 días (UTC). Solo cuentan las partidas que aún existen: las caducadas se borran automáticamente. Generado ${fmtDate(stats.generatedAt)}.`}>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Partidas existentes" value={games.total} />
          <Stat label="Creadas en 30 días" value={last30Total} />
        </div>
        <MiniBars data={games.perDay} label={`Partidas creadas por día durante los últimos 30 días: ${last30Total} en total`} />
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-violet-soft">Ver como tabla (últimos 30 días)</summary>
          <Table head={['Día', 'Partidas']}>
            {[...games.perDay].reverse().map((d) => (<tr key={d.day}><td className="px-2 py-1">{d.day}</td><td className="px-2 py-1 tabular-nums">{d.count}</td></tr>))}
          </Table>
        </details>
      </Section>

      <Section title="Partidas por estado">
        <Table head={['Estado', 'Partidas']} empty={Object.keys(games.byStatus).length === 0 ? 'Todavía no hay partidas.' : undefined}>
          {Object.entries(games.byStatus).map(([s, n]) => (<tr key={s} data-testid="stats-status-row"><td className="px-2 py-1.5">{STATUS_LABEL[s] ?? s}</td><td className="px-2 py-1.5 tabular-nums">{n}</td></tr>))}
        </Table>
      </Section>

      <Section title="Plantillas del sistema más jugadas" hint="Partidas creadas desde «Partidas del sistema» (se anota al crear la partida; las anteriores a esta función no cuentan).">
        <Table head={['Plantilla', 'Partidas', 'Última vez']} empty={templates.length === 0 ? 'Todavía no se ha creado ninguna partida desde una plantilla del sistema.' : undefined}>
          {templates.map((t) => (<tr key={t.slug} data-testid="stats-template-row"><td className="px-2 py-1.5"><p className="font-semibold">{t.title}</p><p className="font-mono text-xs text-white/45">{t.slug}</p></td><td className="px-2 py-1.5 tabular-nums">{t.games}</td><td className="px-2 py-1.5">{fmtDate(t.last_at)}</td></tr>))}
        </Table>
      </Section>

      <Section title="IA: éxito y fallo de las imágenes" hint="Últimos 14 días (UTC), sobre las versiones de imagen generadas (modo pegatinas incluido, como «demo»; las fotos subidas a mano no cuentan). Un fallo no bloquea la subasta: se conserva la última imagen válida.">
        {aiTotals.length === 0 ? <p className="text-sm text-white/70">Sin generaciones en este periodo.</p> : (
          <OkFailBars data={aiTotals} label={`Imágenes correctas y fallidas por día: ${aiTotals.reduce((n, d) => n + d.ok, 0)} correctas, ${aiTotals.reduce((n, d) => n + d.failed, 0)} fallidas`} />
        )}
        <h3 className="mb-1 mt-4 text-sm font-bold">Por proveedor</h3>
        <Table head={['Proveedor', 'Correctas', 'Fallidas', 'Tasa de éxito']} empty={ai.byProvider.length === 0 ? 'Sin datos.' : undefined}>
          {ai.byProvider.map((p) => (<tr key={p.provider} data-testid="stats-ai-provider-row"><td className="px-2 py-1.5 font-semibold">{p.provider}</td><td className="px-2 py-1.5 tabular-nums">{p.ok}</td><td className="px-2 py-1.5 tabular-nums">{p.failed}</td><td className="px-2 py-1.5 tabular-nums">{pct(p.ok, p.failed)}</td></tr>))}
        </Table>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-violet-soft">Ver por proveedor y día</summary>
          <Table head={['Día', 'Proveedor', 'Correctas', 'Fallidas', 'Tasa de éxito']} empty={ai.perDay.length === 0 ? 'Sin datos.' : undefined}>
            {[...ai.perDay].reverse().map((r) => (<tr key={r.day + r.provider}><td className="px-2 py-1">{r.day}</td><td className="px-2 py-1">{r.provider}</td><td className="px-2 py-1 tabular-nums">{r.ok}</td><td className="px-2 py-1 tabular-nums">{r.failed}</td><td className="px-2 py-1 tabular-nums">{pct(r.ok, r.failed)}</td></tr>))}
          </Table>
        </details>
        <h3 className="mb-1 mt-4 text-sm font-bold">Trabajos de imagen (cola)</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {['queued', 'running', 'completed', 'failed'].map((k) => <Stat key={k} label={JOB_LABEL[k]!} value={ai.jobs[k] ?? 0} />)}
        </div>
      </Section>

      <Section title="Cuota de IA de hoy" hint="Reservas de generaciones reales hechas hoy (UTC) frente al tope diario de Ajustes.">
        <UsageCount used={ai.usageTodayTotal} limit={ai.dayLimit} />
        <Table head={['Proveedor', 'Usos hoy']} empty={Object.keys(ai.usageToday).length === 0 ? 'Hoy no se ha usado ningún proveedor.' : undefined}>
          {Object.entries(ai.usageToday).map(([p, n]) => (<tr key={p}><td className="px-2 py-1.5">{p}</td><td className="px-2 py-1.5 tabular-nums">{n}</td></tr>))}
        </Table>
      </Section>
    </div>
  );
}

function UsageCount({ used, limit }: { used: number; limit: number }) {
  const p = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = p >= 90 ? 'bg-rose' : p >= 70 ? 'bg-gold' : 'bg-teal';
  return (
    <div className="mb-3">
      <p className="text-sm font-bold">Hoy: <span className="tabular-nums" data-testid="stats-quota-today">{used} / {limit}</span></p>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-night-950" role="meter" aria-label="Uso de la cuota diaria de IA" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
        <div className={`h-full ${tone}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
