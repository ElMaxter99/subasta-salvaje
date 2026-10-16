import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminOverview, adminSettings, planLimits } from '@/lib/services/admin-service';
import { effectiveQuota, effectiveTtlHours } from '@/lib/services/settings';
import { getImageProviderId, getRuntimeMode } from '@/lib/config/env';
import { formatBytes } from '@/lib/domain/format';
import { MiniBars, Section, Stat, Table, UsageBar } from '@/components/admin/widgets';

export default async function AdminHome() {
  await requireSuperadmin();
  const ctx = await getContext();
  const [o, settings] = await Promise.all([adminOverview(ctx), adminSettings(ctx)]);
  const limits = planLimits();
  const quota = effectiveQuota(settings);
  const supabase = getRuntimeMode() === 'supabase';
  const storageUsed = o.storage.bucket_bytes ?? o.storage.tracked_bytes;
  const provider = getImageProviderId();

  return (
    <div className="space-y-5">
      <Section
        title="Peso: base de datos y almacenamiento"
        hint={<>Medido en el propio servidor. Los topes son los del plan gratuito de Supabase y se pueden cambiar con <code>SUPABASE_PLAN_DB_MB</code> / <code>SUPABASE_PLAN_STORAGE_MB</code> (cambian con el tiempo: contrástalos con la página de precios). {supabase ? '' : 'Modo demo: valores de la base local, no de Supabase.'}</>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <UsageBar label="Base de datos" used={o.db_bytes} limit={limits.dbBytes} note="Tamaño total de la base (pg_database_size), incluye índices y tablas del sistema de Supabase." />
          <UsageBar
            label="Almacenamiento (imágenes)"
            used={storageUsed}
            limit={limits.storageBytes}
            note={o.storage.bucket_bytes !== null ? `Bucket real: ${o.storage.bucket_objects} archivos. Registrados en partidas: ${o.storage.tracked_files} archivos (${formatBytes(o.storage.tracked_bytes)}).` : `Sin acceso al bucket en este modo: se muestra lo registrado en partidas (${o.storage.tracked_files} archivos distintos).`}
          />
        </div>
        <p className="mt-3 text-xs text-white/55">No medible desde aquí: tráfico de salida (egress) y mensajes de Realtime. Consúltalos en el panel de Supabase (Project Settings → Usage).</p>
      </Section>

      <Section title="Cuota de IA">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Hoy (UTC)" value={`${o.ai.today} / ${quota.perDay}`} sub="generaciones reales / tope diario" />
          <Stat label="Este mes" value={o.ai.month} />
          <Stat label="Total histórico" value={o.ai.total} />
          <Stat label="Estado" value={settings.ai_enabled ? 'Activada' : 'Apagada'} sub={provider ? `Proveedor: ${provider}` : 'Sin proveedor configurado'} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-bold text-white/80">Últimos 14 días</h3>
            <MiniBars data={o.ai.per_day} label="Generaciones de IA por día" />
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="mb-1 text-sm font-bold text-white/80">Por proveedor</h3>
              <ul className="text-sm text-white/80">
                {o.ai.by_provider.length === 0 ? <li className="text-white/55">Sin uso todavía.</li> : o.ai.by_provider.map((p) => <li key={p.provider}>{p.provider}: <b>{p.count}</b></li>)}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-bold text-white/80">Quién más usa la IA</h3>
              <ul className="text-sm text-white/80">
                {o.ai.top_hosts.length === 0 ? <li className="text-white/55">Sin uso todavía.</li> : o.ai.top_hosts.map((t) => <li key={t.host_id ?? 'x'}>{t.email ?? t.host_id?.slice(0, 8) ?? 'desconocido'}: <b>{t.count}</b></li>)}
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-white/55">Tope por partida: {quota.perGame}. Borrar una partida no devuelve cuota ni borra este historial.</p>
      </Section>

      <Section title="Contenido guardado">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Anfitriones" value={o.counts.hosts} sub={`${o.counts.blocked_hosts} bloqueados`} />
          <Stat label="Partidas" value={o.counts.games} sub={`${o.counts.games_active} en curso`} />
          <Stat label="Jugadores" value={o.counts.players} />
          <Stat label="Versiones de imagen" value={o.counts.image_versions} />
          <Stat label="Trabajos de imagen" value={o.counts.jobs_pending} sub={`${o.counts.jobs_failed} fallidos`} />
          <Stat label="Eventos registrados" value={o.counts.events} />
          <Stat label="Borrado automático" value={`${Math.round((effectiveTtlHours(settings) / 24) * 10) / 10} días`} sub="sin actividad" />
          <Stat label="Registro" value={settings.signups_open ? 'Abierto' : 'Cerrado'} sub="cámbialo en Ajustes" />
        </div>
        <h3 className="mb-1 mt-5 text-sm font-bold text-white/80">Peso por tabla</h3>
        <Table head={['Tabla', 'Tamaño', 'Filas (aprox.)']}>
          {o.tables.slice(0, 12).map((t) => (
            <tr key={t.name}>
              <td className="px-2 py-1.5 font-mono">{t.name}</td>
              <td className="px-2 py-1.5 tabular-nums">{formatBytes(t.bytes)}</td>
              <td className="px-2 py-1.5 tabular-nums">{t.rows}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
