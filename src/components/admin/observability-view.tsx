import Link from 'next/link';
import type { ObsError, ObsFamily, ObsOverview } from '@/lib/services/observability-service';
import { BulkButtons, ErrorStatusButtons, ObsSettingsControls } from './observability-controls';
import { MiniBars, Section, Stat, Table, fmtDate } from './widgets';

const SOURCE: Record<string, string> = { server: 'Servidor', client: 'Navegador', job: 'Trabajo', cron: 'Cron' };
const STATUS: Record<string, string> = { new: 'Nuevo', seen: 'Visto', resolved: 'Resuelto' };
const STATUS_TONE: Record<string, string> = { new: 'bg-rose/20 text-rose', seen: 'bg-gold/20 text-gold', resolved: 'bg-teal/20 text-teal' };
const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.001 ? 2 : 1).replace('.', ',')} %`;
const ms = (v: number | null) => (v === null ? '—' : v > 5000 ? '> 5 s' : v >= 1000 ? `≤ ${v / 1000} s` : `≤ ${v} ms`);

/** Métricas de uso diarias: nombre en español. El orden es el de las gráficas. */
export const USAGE_METRICS: { metric: string; label: string }[] = [
  { metric: 'game.created', label: 'Partidas creadas' },
  { metric: 'game.started', label: 'Partidas empezadas' },
  { metric: 'game.finished', label: 'Partidas terminadas' },
  { metric: 'player.joined', label: 'Jugadores unidos por móvil' },
  { metric: 'auction.announced', label: 'Subastas anunciadas' },
  { metric: 'auction.awarded', label: 'Subastas adjudicadas' },
  { metric: 'auction.cancelled', label: 'Subastas canceladas' },
  { metric: 'auction.unsold', label: 'Subastas perdidas (sin pujas)' },
  { metric: 'bid.placed', label: 'Pujas' },
  { metric: 'bid.yielded', label: 'Cesiones de puja' },
  { metric: 'reaction.sent', label: 'Reacciones' },
];

function last30(series: ObsOverview['series'], metric: string): { day: string; count: number }[] {
  const byDay = new Map(series.filter((s) => s.metric === metric).map((s) => [s.day, s.value]));
  const out: { day: string; count: number }[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    out.push({ day: d, count: Number(byDay.get(d) ?? 0) });
  }
  return out;
}

function Alerts({ alerts }: { alerts: ObsOverview['alerts'] }) {
  if (alerts.length === 0) return <p data-testid="obs-ok" className="rounded-2xl bg-teal/15 px-4 py-3 text-sm font-semibold text-teal">Sin alertas: no hay picos de errores ni errores graves nuevos en las últimas 24 horas.</p>;
  return (
    <div role="alert" data-testid="obs-alerts" className="space-y-2 rounded-2xl border border-rose/50 bg-rose/15 px-4 py-3">
      {alerts.map((a, i) => (
        <p key={i} className="text-sm font-bold text-rose">
          {a.kind === 'spike'
            ? `Pico de errores: ${String(a.errors_last_hour)} en la última hora (lo habitual: ${String(a.avg_per_hour)} por hora).`
            : `${(a.errors as unknown[]).length} error(es) grave(s) nuevo(s) o reabierto(s) en las últimas 24 h: ${(a.errors as { code: string; route: string }[]).slice(0, 3).map((e) => `${e.code} en ${e.route || '—'}`).join(' · ')}.`}
        </p>
      ))}
    </div>
  );
}

function Families({ rows }: { rows: ObsFamily[] }) {
  return (
    <Table head={['Familia de rutas', 'Peticiones', '2xx', '4xx', '429', '5xx', 'p50', 'p95']} empty={rows.length === 0 ? 'Todavía no hay peticiones registradas (se anotan en cuanto la app recibe tráfico).' : undefined}>
      {rows.map((f) => (
        <tr key={f.family} data-testid="obs-family-row">
          <td className="px-2 py-1.5 font-mono text-xs font-semibold">/api/{f.family}</td>
          <td className="px-2 py-1.5 tabular-nums">{f.total}</td>
          <td className="px-2 py-1.5 tabular-nums">{f.s2xx}</td>
          <td className="px-2 py-1.5 tabular-nums">{f.s4xx}</td>
          <td className="px-2 py-1.5 tabular-nums">{f.s429}</td>
          <td className={`px-2 py-1.5 tabular-nums ${f.s5xx > 0 ? 'font-bold text-rose' : ''}`}>{f.s5xx}</td>
          <td className="px-2 py-1.5 tabular-nums">{ms(f.p50)}</td>
          <td className="px-2 py-1.5 tabular-nums">{ms(f.p95)}</td>
        </tr>
      ))}
    </Table>
  );
}

export interface ObsViewProps {
  overview: ObsOverview;
  errors: ObsError[];
  filter: { status: string; source: string; severity: string; q: string };
  mail: { configured: boolean; recipients: number };
  ai: { provider: string; ok: number; failed: number }[];
}

export function ObservabilityView({ overview: ov, errors, filter, mail, ai }: ObsViewProps) {
  const csvQuery = new URLSearchParams(Object.entries({ kind: 'errors', status: filter.status, source: filter.source }).filter(([, v]) => v)).toString();
  const input = 'rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-sm';
  return (
    <div className="space-y-5">
      <Alerts alerts={ov.alerts} />

      <Section title="Salud" hint="Errores guardados por la propia app (sin servicios externos) y peticiones de los últimos 7 días (UTC). Las métricas de peticiones se vuelcan por lotes y son aproximadas; no cuentan las páginas, solo /api.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Errores (24 h)" value={<span data-testid="obs-errors-24h">{ov.errors_24h}</span>} sub={`${ov.errors_7d} en 7 días`} />
          <Stat label="Grupos abiertos" value={ov.groups_open} sub={`${ov.groups_new} nuevos sin ver`} />
          <Stat label="Tasa de 5xx (7 d)" value={pct(ov.rate_5xx)} sub={`${ov.status_5xx_7d} de ${ov.requests_7d} peticiones`} />
          <Stat label="429 (7 d)" value={ov.status_429_7d} sub="Peticiones limitadas por tasa" />
        </div>
        <h3 className="mb-1 mt-4 text-sm font-bold">Por familia de rutas (latencia aproximada por cubos: cota superior)</h3>
        <Families rows={ov.families} />
        {ov.domain_errors.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-violet-soft">Errores de dominio esperados (400/409/429…), solo recuento</summary>
            <Table head={['Código', 'Veces (7 d)']}>{ov.domain_errors.map((d) => (<tr key={d.code}><td className="px-2 py-1 font-mono text-xs">{d.code}</td><td className="px-2 py-1 tabular-nums">{d.n}</td></tr>))}</Table>
          </details>
        ) : null}
      </Section>

      <Section
        title="Errores agrupados"
        hint="Un grupo por huella (origen + ruta + código + mensaje sin números ni identificadores). Un error resuelto que vuelve a ocurrir se reabre solo."
        action={<a href={`/api/admin/observability/export?${csvQuery}`} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/15" data-testid="obs-export-errors">Exportar CSV</a>}
      >
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Filtros de errores">
          <label className="text-xs font-bold uppercase text-white/60">Estado
            <select name="status" defaultValue={filter.status} className={`${input} mt-1 block`}><option value="">Todos</option><option value="open">Abiertos</option><option value="new">Nuevos</option><option value="seen">Vistos</option><option value="resolved">Resueltos</option></select>
          </label>
          <label className="text-xs font-bold uppercase text-white/60">Origen
            <select name="source" defaultValue={filter.source} className={`${input} mt-1 block`}><option value="">Todos</option><option value="server">Servidor</option><option value="client">Navegador</option><option value="cron">Cron</option><option value="job">Trabajo</option></select>
          </label>
          <label className="text-xs font-bold uppercase text-white/60">Gravedad
            <select name="severity" defaultValue={filter.severity} className={`${input} mt-1 block`}><option value="">Todas</option><option value="high">Alta</option><option value="low">Baja</option></select>
          </label>
          <label className="text-xs font-bold uppercase text-white/60">Buscar
            <input name="q" defaultValue={filter.q} maxLength={100} className={`${input} mt-1 block`} placeholder="ruta, código o texto" />
          </label>
          <button type="submit" className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-night-950">Filtrar</button>
          <Link href="/admin/observabilidad" className="px-2 py-2 text-sm font-semibold text-violet-soft">Limpiar</Link>
        </form>
        <div className="mb-3"><BulkButtons /></div>
        <Table head={['Estado', 'Error', 'Ruta', 'Veces', 'Primera / última vez', 'Acciones']} empty={errors.length === 0 ? 'No hay errores con estos filtros.' : undefined}>
          {errors.map((e) => (
            <tr key={e.fingerprint} className="align-top" data-testid="obs-error-row">
              <td className="px-2 py-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[e.status]}`}>{STATUS[e.status]}</span>
                <p className="mt-1 text-xs text-white/55">{SOURCE[e.source] ?? e.source}{e.severity === 'high' ? ' · grave' : ''}</p>
              </td>
              <td className="max-w-md px-2 py-1.5">
                <p className="font-mono text-xs font-bold">{e.code}</p>
                <p className="break-words text-white/80">{e.message || '—'}</p>
                {e.stack ? (
                  <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-violet-soft">Pila</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-night-950 p-2 text-[11px] text-white/70">{e.stack}</pre></details>
                ) : null}
                <p className="mt-1 font-mono text-[10px] text-white/40">{e.fingerprint}{e.release ? ` · ${e.release}` : ''}{e.env ? ` · ${e.env}` : ''}</p>
              </td>
              <td className="px-2 py-1.5 font-mono text-xs">{e.route || '—'}{e.room_code ? <span className="block text-white/50">sala {e.room_code}</span> : null}</td>
              <td className="px-2 py-1.5 tabular-nums"><span className="font-bold">{e.total}</span><span className="block text-xs text-white/55">{e.count_24h} en 24 h · {e.count_7d} en 7 d</span></td>
              <td className="px-2 py-1.5 text-xs">{fmtDate(e.first_at)}<br />{fmtDate(e.last_at)}</td>
              <td className="px-2 py-1.5"><ErrorStatusButtons fingerprint={e.fingerprint} status={e.status} /></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Uso diario"
        hint="Contadores agregados de los últimos 30 días (UTC), sin datos personales. Salen de lo que la partida ya registra, por lo que las partidas caducadas conservan su contador. Cada gráfica tiene su tabla."
        action={<a href="/api/admin/observability/export?kind=usage" className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/15" data-testid="obs-export-usage">Exportar CSV</a>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {USAGE_METRICS.slice(0, 10).filter((m) => ['game.created', 'player.joined', 'auction.announced', 'auction.awarded', 'bid.placed', 'reaction.sent'].includes(m.metric)).map((m) => {
            const data = last30(ov.series, m.metric);
            const total = data.reduce((n, d) => n + d.count, 0);
            return (
              <div key={m.metric} className="rounded-2xl bg-night-900 p-3" data-testid="obs-usage-chart">
                <h3 className="text-sm font-bold">{m.label} <span className="font-normal text-white/55">· {total} en 30 días</span></h3>
                <MiniBars data={data} label={`${m.label} por día durante los últimos 30 días: ${total} en total`} />
              </div>
            );
          })}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-violet-soft">Ver todas las métricas como tabla (últimos 14 días)</summary>
          <Table head={['Métrica', 'Total 14 d', 'Hoy']}>
            {USAGE_METRICS.map((m) => {
              const d = last30(ov.series, m.metric);
              return (<tr key={m.metric}><td className="px-2 py-1">{m.label}</td><td className="px-2 py-1 tabular-nums">{d.slice(-14).reduce((n, x) => n + x.count, 0)}</td><td className="px-2 py-1 tabular-nums">{d[d.length - 1]?.count ?? 0}</td></tr>);
            })}
          </Table>
        </details>
        <h3 className="mb-1 mt-4 text-sm font-bold">Imágenes por proveedor (últimos 14 días, de la auditoría de IA)</h3>
        <Table head={['Proveedor', 'Correctas', 'Fallidas']} empty={ai.length === 0 ? 'Sin generaciones en este periodo.' : undefined}>
          {ai.map((p) => (<tr key={p.provider}><td className="px-2 py-1.5 font-semibold">{p.provider}</td><td className="px-2 py-1.5 tabular-nums">{p.ok}</td><td className="px-2 py-1.5 tabular-nums">{p.failed}</td></tr>))}
        </Table>
        <p className="mt-1 text-xs text-white/55">Detalle por día en <Link href="/admin/estadisticas" className="font-semibold text-violet-soft">Estadísticas</Link>.</p>
      </Section>

      <Section title="Alertas y retención" hint={`Los errores se conservan ${ov.config.retention_days} días (máximo ${ov.config.max_groups} grupos; al llegar al tope se descartan antes los resueltos y los más antiguos). La purga corre con el cron diario.`}>
        <ObsSettingsControls alertEmail={ov.config.alert_email} retentionDays={ov.config.retention_days} mailConfigured={mail.configured} recipients={mail.recipients} />
      </Section>
    </div>
  );
}
