import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminAudit } from '@/lib/services/admin-service';
import { Section, Table, fmtDate } from '@/components/admin/widgets';

export const metadata = { title: 'Superadmin · Auditoría' };

const LABEL: Record<string, string> = {
  setting_changed: 'Ajuste cambiado',
  user_updated: 'Usuario modificado',
  user_deleted: 'Usuario borrado',
  game_deleted: 'Partida borrada',
  games_purged: 'Purga de partidas caducadas',
  invite_add: 'Invitación creada',
  invite_remove: 'Invitación eliminada',
};

export default async function AuditPage() {
  await requireSuperadmin();
  const log = await adminAudit(await getContext());
  return (
    <Section title="Auditoría" hint="Todas las acciones del superadmin, de la más reciente a la más antigua (últimas 300). No se puede editar ni borrar desde la app.">
      <Table head={['Cuándo', 'Quién', 'Acción', 'Objetivo', 'Detalle']} empty={log.length === 0 ? 'Todavía no hay acciones registradas.' : undefined}>
        {log.map((e) => (
          <tr key={e.id} className="align-top">
            <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(e.created_at)}</td>
            <td className="px-2 py-1.5">{e.actor}</td>
            <td className="px-2 py-1.5 font-semibold">{LABEL[e.action] ?? e.action}</td>
            <td className="px-2 py-1.5 font-mono text-xs">{e.target_type ? `${e.target_type}:${e.target_id ?? ''}` : '—'}</td>
            <td className="px-2 py-1.5 font-mono text-xs text-white/65">{Object.keys(e.payload).length ? JSON.stringify(e.payload) : ''}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
