import { CLOUDFLARE_FREE_NEURONS, suggestDailyCalls, type DayPoint } from '@/lib/ai/audit';
import type { AiAudit } from '@/lib/services/ai-audit-service';
import { Section, Stat, Table } from './widgets';

const n = (v: number, d = 0) => v.toLocaleString('es-ES', { maximumFractionDigits: d });

function Bars({ data, unit }: { data: DayPoint[]; unit: string }) {
  if (data.length === 0) return <p className="text-sm text-white/55">Sin datos en el periodo.</p>;
  const max = Math.max(...data.map((d) => d.amount), 1e-9);
  return (
    <ul className="space-y-1" aria-label={`Uso diario (${unit})`}>
      {data.map((d) => (
        <li key={d.date} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 tabular-nums text-white/60">{d.date.slice(5)}</span>
          <span className="h-3 flex-1 overflow-hidden rounded bg-night-900"><span className="block h-full rounded bg-violet-soft" style={{ width: `${Math.max(2, (d.amount / max) * 100)}%` }} /></span>
          <span className="w-40 shrink-0 text-right tabular-nums text-white/75">{n(d.amount, d.amount < 10 ? 4 : 0)} {unit} · {d.requests} llam.</span>
        </li>
      ))}
    </ul>
  );
}

function Errors({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return (
    <ul role="alert" className="mb-3 space-y-1">
      {list.map((e) => (
        <li key={e} className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{e}</li>
      ))}
    </ul>
  );
}

export function AiAuditView({ audit }: { audit: AiAudit }) {
  const { pollinations: pol, cloudflare: cf, local } = audit;
  const suggested = suggestDailyCalls(cf?.neuronsPerCall ?? null);
  return (
    <div className="space-y-5">
      <Section title="Resumen de la app" hint="Lo que cuenta la propia app, no el proveedor. El tope global (duro) y los topes por proveedor (blandos) se cambian en Ajustes.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Cadena activa" value={audit.configured.length ? audit.configured.join(' → ') : 'sin IA'} sub="orden fijado por IMAGE_PROVIDERS" />
          <Stat label="Tope global/día" value={local.perDay} sub={`por partida: ${local.perGame}`} />
          <Stat label="Usos hoy (app)" value={Object.entries(local.today).filter(([k]) => k !== 'demo').map(([k, v]) => `${k}: ${v}`).join(' · ') || '0'} sub="llamadas reservadas, UTC" />
          <Stat label="Apagados" value={local.providersOff.length ? local.providersOff.join(', ') : 'ninguno'} sub={Object.keys(local.providerLimits).length ? `topes: ${Object.entries(local.providerLimits).map(([k, v]) => `${k} ${v}`).join(', ')}` : 'sin topes por proveedor'} />
        </div>
      </Section>

      <Section title="Cloudflare Workers AI" hint={`Neuronas medidas por Cloudflare (GraphQL Analytics). Gratis: ${n(CLOUDFLARE_FREE_NEURONS)} neuronas/día, reinicio a las 00:00 UTC. Consulta sin verificar contra la documentación oficial; necesita el permiso «Account Analytics: Read» en el token.`}>
        {!cf ? (
          <p className="text-sm text-white/65">No hay credenciales de Cloudflare configuradas (CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN).</p>
        ) : (
          <>
            <Errors list={cf.errors} />
            {cf.today ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Neuronas hoy" value={`${n(cf.today.neurons)} / ${n(CLOUDFLARE_FREE_NEURONS)}`} sub={`quedan ≈ ${n(cf.remainingToday ?? 0)}`} />
                  <Stat label="Llamadas hoy" value={cf.today.calls} sub="medidas por Cloudflare" />
                  <Stat label="Neuronas / llamada" value={cf.neuronsPerCall ?? '—'} sub="media de hoy" />
                  <Stat label="Últimos 7 días" value={n(cf.last7d?.neurons ?? 0)} sub={`${cf.last7d?.calls ?? 0} llamadas`} />
                </div>
                <p className="mt-3 rounded-2xl bg-night-900 p-3 text-sm text-white/80">
                  {suggested !== null ? (
                    <>Con ≈ {cf.neuronsPerCall} neuronas por llamada caben unas <strong>{n(suggested)}</strong> llamadas al día dentro de la capa gratuita (con 10 % de margen). Tope actual de la app: {local.perDay}. {suggested < local.perDay ? 'Conviene bajar IMAGE_QUOTA_PER_DAY o el tope diario de Cloudflare.' : 'El tope actual es compatible.'}</>
                  ) : (
                    <>Aún no hay llamadas hoy para estimar el coste por llamada; vuelve tras generar alguna imagen.</>
                  )}
                </p>
                <h3 className="mb-1 mt-4 text-sm font-bold uppercase text-white/60">Neuronas por día (UTC)</h3>
                <Bars data={cf.byDay ?? []} unit="neur." />
                <h3 className="mb-1 mt-4 text-sm font-bold uppercase text-white/60">Por modelo (7 días)</h3>
                <Table head={['Modelo', 'Llamadas', 'Neuronas']} empty={(cf.byModel ?? []).length === 0 ? 'Sin uso.' : undefined}>
                  {(cf.byModel ?? []).map((m) => (
                    <tr key={m.model}><td className="px-2 py-1.5 font-mono text-xs">{m.model}</td><td className="px-2 py-1.5 tabular-nums">{m.requests}</td><td className="px-2 py-1.5 tabular-nums">{n(m.amount)}</td></tr>
                  ))}
                </Table>
              </>
            ) : null}
            <p className="mt-3 text-xs text-white/55">Si Cloudflare responde «cuota diaria agotada» (error 4006) mientras aquí o en su panel se ve 0 de 10 000, es una incidencia que otros usuarios han reportado en su comunidad; no es un fallo de la app.</p>
          </>
        )}
      </Section>

      <Section title="Pollinations" hint="Estado de la clave, saldo de pollen y uso de los últimos 30 días, leído de su API (/account/key, /account/balance, /account/key/usage). El coste se muestra en USD según Pollinations; el saldo, en pollen.">
        {!pol ? (
          <p className="text-sm text-white/65">No hay clave de Pollinations configurada (POLLINATIONS_API_KEY).</p>
        ) : (
          <>
            <Errors list={pol.errors} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Clave" value={pol.key ? (pol.key.valid ? 'Válida' : 'No válida') : '—'} sub={pol.key ? `${pol.key.type ?? '?'} · ${pol.key.name ?? 'sin nombre'}` : undefined} />
              <Stat label="Presupuesto de la clave" value={pol.key ? (pol.key.pollenBudget === null ? 'ilimitado' : `${n(pol.key.pollenBudget, 4)} pollen`) : '—'} sub={pol.key?.expiresAt ? `caduca ${pol.key.expiresAt.slice(0, 10)}` : 'sin caducidad'} />
              <Stat label="Saldo restante" value={pol.balance ? `${n(pol.balance.remaining, 4)} pollen` : '—'} sub={pol.balance?.total !== null && pol.balance?.total !== undefined ? `cuenta ${n(pol.balance.total, 2)} (de pago ${n(pol.balance.paid ?? 0, 2)})` : 'saldo de la clave'} />
              <Stat label="Imágenes estimadas" value={pol.estimatedImagesLeft ?? '—'} sub="saldo ÷ coste medio (orientativo)" />
            </div>
            {pol.usage ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Peticiones 24 h" value={pol.usage.requests24h} sub={`${n(pol.usage.costUsd24h, 4)} USD`} />
                  <Stat label="Peticiones 7 d" value={pol.usage.requests7d} sub={`${n(pol.usage.costUsd7d, 4)} USD`} />
                  <Stat label="Peticiones 30 d" value={pol.usage.requests30d} sub={`${n(pol.usage.costUsd30d, 4)} USD${pol.usage.truncated ? ' (mínimo: lista cortada)' : ''}`} />
                  <Stat label="Coste medio" value={pol.usage.avgCostUsd !== null ? `${n(pol.usage.avgCostUsd, 5)} USD` : '—'} sub="por petición" />
                </div>
                <h3 className="mb-1 mt-4 text-sm font-bold uppercase text-white/60">Coste por día (USD)</h3>
                <Bars data={pol.usage.byDay} unit="USD" />
                <h3 className="mb-1 mt-4 text-sm font-bold uppercase text-white/60">Por modelo (30 días)</h3>
                <Table head={['Modelo', 'Peticiones', 'Coste USD']} empty={pol.usage.byModel.length === 0 ? 'Sin uso.' : undefined}>
                  {pol.usage.byModel.map((m) => (
                    <tr key={m.model}><td className="px-2 py-1.5 font-mono text-xs">{m.model}</td><td className="px-2 py-1.5 tabular-nums">{m.requests}</td><td className="px-2 py-1.5 tabular-nums">{n(m.amount, 4)}</td></tr>
                  ))}
                </Table>
              </>
            ) : null}
            <p className="mt-3 text-xs text-white/55">El presupuesto se cambia en la propia clave (enter.pollinations.ai → editar clave); recargar la cartera no lo aumenta. Esta app no añade ningún pago.</p>
          </>
        )}
      </Section>
    </div>
  );
}
