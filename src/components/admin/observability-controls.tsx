'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { adminPost } from '@/lib/client/admin-api';

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function act(id: string, body: unknown, ok: string) {
    setBusy(id);
    setMsg(null);
    try {
      await adminPost('observability', body);
      setMsg({ ok: true, text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setBusy(null);
    }
  }
  return { busy, msg, act };
}

const Msg = ({ msg }: { msg: { ok: boolean; text: string } | null }) => (msg ? <p role="status" className={`mt-2 rounded-2xl px-3 py-1.5 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null);

/** Botones «Visto» / «Resuelto» / «Reabrir» de un grupo de errores (acción auditada en el servidor). */
export function ErrorStatusButtons({ fingerprint, status }: { fingerprint: string; status: 'new' | 'seen' | 'resolved' }) {
  const { busy, msg, act } = useAct();
  return (
    <div className="flex flex-wrap gap-1.5">
      {status === 'new' ? <Button variant="secondary" loading={busy === 'seen'} disabled={busy !== null} onClick={() => act('seen', { op: 'status', fingerprint, status: 'seen' }, 'Marcado como visto')}>Visto</Button> : null}
      {status !== 'resolved' ? <Button variant="primary" loading={busy === 'resolved'} disabled={busy !== null} onClick={() => act('resolved', { op: 'status', fingerprint, status: 'resolved' }, 'Marcado como resuelto')}>Resuelto</Button> : <Button variant="secondary" loading={busy === 'new'} disabled={busy !== null} onClick={() => act('new', { op: 'status', fingerprint, status: 'new' }, 'Reabierto')}>Reabrir</Button>}
      <Msg msg={msg} />
    </div>
  );
}

/** Marca todos los grupos abiertos como vistos / resueltos. */
export function BulkButtons() {
  const { busy, msg, act } = useAct();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" loading={busy === 'seen'} disabled={busy !== null} onClick={() => act('seen', { op: 'status', fingerprint: '*', status: 'seen' }, 'Todos los abiertos marcados como vistos')}>Marcar todo como visto</Button>
      <Button variant="secondary" loading={busy === 'resolved'} disabled={busy !== null} onClick={() => act('resolved', { op: 'status', fingerprint: '*', status: 'resolved' }, 'Todos los abiertos marcados como resueltos')}>Marcar todo como resuelto</Button>
      <Msg msg={msg} />
    </div>
  );
}

/** Interruptor del correo-resumen (desactivado por defecto), retención y purga manual. */
export function ObsSettingsControls({ alertEmail, retentionDays, mailConfigured, recipients }: { alertEmail: boolean; retentionDays: number; mailConfigured: boolean; recipients: number }) {
  const { busy, msg, act } = useAct();
  const [days, setDays] = useState(String(retentionDays));
  const input = 'w-24 rounded-xl border border-white/15 bg-night-900 px-3 py-2';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${alertEmail ? 'bg-teal/20 text-teal' : 'bg-white/10 text-white/70'}`}>{alertEmail ? 'Correo-resumen activado' : 'Correo-resumen desactivado'}</span>
        <Button variant={alertEmail ? 'secondary' : 'primary'} loading={busy === 'mail'} disabled={busy !== null} onClick={() => act('mail', { op: 'setting', key: 'obs_alert_email', value: !alertEmail }, alertEmail ? 'Correo-resumen desactivado' : 'Correo-resumen activado')}>
          {alertEmail ? 'Desactivar' : 'Activar'}
        </Button>
      </div>
      <p className="text-xs text-white/60">
        {mailConfigured && recipients > 0
          ? `Resend está configurado y hay ${recipients} correo(s) en SUPERADMIN_EMAILS: con el interruptor activo se enviará, como mucho, un correo cada 6 horas ante un pico de errores o un error grave nuevo (solo recuentos, ruta y código).`
          : 'No se enviará nada: falta configurar Resend (RESEND_API_KEY y MAIL_FROM) o SUPERADMIN_EMAILS. Sin Resend la app no envía correos propios; las alertas solo se ven en este panel.'}
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act('days', { op: 'setting', key: 'obs_retention_days', value: Number(days) }, 'Retención actualizada'); }}>
        <label className="text-sm font-semibold">Retención de errores (días)
          <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${input} mt-1 block`} />
        </label>
        <Button type="submit" variant="secondary" loading={busy === 'days'} disabled={busy !== null}>Guardar</Button>
        <Button type="button" variant="secondary" loading={busy === 'purge'} disabled={busy !== null} onClick={() => act('purge', { op: 'purge' }, 'Purga hecha')}>Purgar ahora</Button>
      </form>
      <Msg msg={msg} />
    </div>
  );
}
