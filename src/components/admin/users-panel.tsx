'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatBytes } from '@/lib/domain/format';
import { adminPost } from '@/lib/client/admin-api';
import type { AdminInvite, AdminUser } from '@/lib/services/admin-service';
import { Section, Table, fmtDate } from './widgets';

export function UsersPanel({ users, invites, signupsOpen, meId, mailReady = false }: { users: AdminUser[]; invites: AdminInvite[]; signupsOpen: boolean; meId: string; mailReady?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [del, setDel] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');

  async function run(key: string, resource: 'users' | 'invites', body: unknown, ok: string) {
    setBusy(key);
    setMsg(null);
    try {
      await adminPost(resource, body);
      setMsg({ ok: true, text: ok });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}

      <Section title="Invitaciones" hint={signupsOpen ? 'El registro está ABIERTO: las invitaciones no hacen falta, pero puedes preparar las de cuando lo cierres (Ajustes).' : 'El registro está CERRADO: solo entra quien tenga una invitación (o ya tuviera cuenta con partidas).'}>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run('invite', 'invites', { op: 'add', email }, `Invitación creada para ${email.trim().toLowerCase()}`)) setEmail('');
          }}
        >
          <label htmlFor="invite-email" className="sr-only">Correo a invitar</label>
          <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" className="min-w-64 flex-1 rounded-xl border border-white/15 bg-night-900 px-4 py-2.5" />
          <Button type="submit" variant="primary" loading={busy === 'invite'}>Invitar</Button>
        </form>
        <p className="mt-2 text-xs text-white/55">
          {mailReady ? 'Con «Enviar correo» la persona recibe un aviso con el enlace para registrarse con ese mismo correo.' : 'La invitación no envía ningún correo (falta configurar RESEND_API_KEY y MAIL_FROM): avisa tú a la persona para que se registre con ese mismo correo en la pantalla de acceso.'}
        </p>
        <Table head={['Correo', 'Invitado', 'Estado', '']} empty={invites.length === 0 ? 'Sin invitaciones.' : undefined}>
          {invites.map((i) => (
            <tr key={i.email}>
              <td className="px-2 py-1.5">{i.email}</td>
              <td className="px-2 py-1.5">{fmtDate(i.invited_at)}</td>
              <td className="px-2 py-1.5">{i.used_at ? `Usada ${fmtDate(i.used_at)}` : 'Pendiente'}</td>
              <td className="px-2 py-1.5 text-right">
                {mailReady && !i.used_at ? (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(`mail-${i.email}`, 'invites', { op: 'notify', email: i.email }, `Correo enviado a ${i.email}`)}>Enviar correo</Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(`rm-${i.email}`, 'invites', { op: 'remove', email: i.email }, 'Invitación eliminada')}>Quitar</Button>
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title={`Anfitriones (${users.length})`} hint="Bloquear impide entrar y gestionar partidas (no borra nada). Borrar elimina cuenta, partidas, jugadores, pujas, imágenes y archivos.">
        <Table head={['Usuario', 'Estado', 'Partidas', 'IA usada', 'Peso', 'Último acceso', 'Acciones']} empty={users.length === 0 ? 'Todavía no hay anfitriones.' : undefined}>
          {users.map((u) => {
            const me = u.user_id === meId;
            return (
              <tr key={u.user_id} className="align-top">
                <td className="px-2 py-2">
                  <p className="font-semibold">{u.email ?? 'sin correo conocido'}{me ? ' (tú)' : ''}</p>
                  <p className="font-mono text-xs text-white/55">{u.user_id.slice(0, 8)}{u.profile ? '' : ' · sin perfil aún'}</p>
                </td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${u.status === 'blocked' ? 'bg-rose/20 text-rose' : 'bg-teal/20 text-teal'}`}>{u.status === 'blocked' ? 'Bloqueado' : 'Activo'}</span>
                  {!u.ai_enabled ? <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold">Sin IA</span> : null}
                </td>
                <td className="px-2 py-2 tabular-nums">{u.games} <span className="text-white/50">({u.games_active} vivas)</span></td>
                <td className="px-2 py-2 tabular-nums">{u.ai_used}</td>
                <td className="px-2 py-2 tabular-nums">{formatBytes(u.bytes)}</td>
                <td className="px-2 py-2">{fmtDate(u.last_sign_in_at ?? u.last_seen_at)}</td>
                <td className="px-2 py-2">
                  {me ? <span className="text-xs text-white/55">—</span> : (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run(`b-${u.user_id}`, 'users', { op: 'set', user_id: u.user_id, email: u.email, status: u.status === 'blocked' ? 'active' : 'blocked' }, u.status === 'blocked' ? 'Usuario desbloqueado' : 'Usuario bloqueado')}>
                        {u.status === 'blocked' ? 'Desbloquear' : 'Bloquear'}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run(`a-${u.user_id}`, 'users', { op: 'set', user_id: u.user_id, email: u.email, ai_enabled: !u.ai_enabled }, u.ai_enabled ? 'IA desactivada para este usuario' : 'IA activada para este usuario')}>
                        {u.ai_enabled ? 'Quitar IA' : 'Dar IA'}
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => { setConfirm(''); setDel(u); }}>Borrar</Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <ConfirmDialog
        open={!!del}
        title="Borrar usuario y todo lo suyo"
        confirmLabel="Borrar definitivamente"
        variant="danger"
        loading={busy === 'delete'}
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          const target = del;
          if (await run('delete', 'users', { op: 'delete', user_id: target.user_id, confirm }, `Usuario ${target.email ?? target.user_id.slice(0, 8)} borrado`)) setDel(null);
        }}
      >
        {del ? (
          <div className="space-y-3">
            <p>Se borrarán <b>{del.email ?? del.user_id}</b>, sus <b>{del.games}</b> partidas, jugadores, pujas, imágenes ({formatBytes(del.bytes)}) y su cuenta de acceso. <b>No se puede deshacer.</b></p>
            <label className="block text-sm font-semibold">
              Escribe «{del.email ?? del.user_id}» para confirmar
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-xl bg-night-950 px-3 py-2" autoComplete="off" />
            </label>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
