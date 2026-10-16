'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatBytes } from '@/lib/domain/format';
import { adminPost } from '@/lib/client/admin-api';
import type { AdminGame } from '@/lib/services/admin-service';
import { Section, Table, fmtDate } from './widgets';

const STATUS: Record<string, string> = { lobby: 'Sala de espera', active: 'En curso', paused: 'Pausada', finished: 'Finalizada' };

export function GamesPanel({ games, ttlHours }: { games: AdminGame[]; ttlHours: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [del, setDel] = useState<AdminGame | null>(null);
  const [q, setQ] = useState('');

  async function run(key: string, body: unknown, ok: (r: Record<string, unknown>) => string) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await adminPost('games', body);
      setMsg({ ok: true, text: ok(r) });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const rows = games.filter((g) => !q.trim() || `${g.name} ${g.room_code} ${g.host_email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const total = games.reduce((n, g) => n + g.bytes, 0);

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}
      <Section
        title={`Partidas (${games.length})`}
        hint={`Peso registrado: ${formatBytes(total)}. Una partida se borra sola tras ${Math.round((ttlHours / 24) * 10) / 10} días sin actividad (configurable en Ajustes).`}
        action={<Button variant="secondary" loading={busy === 'purge'} disabled={busy !== null} onClick={() => run('purge', { op: 'purge' }, (r) => `Partidas caducadas borradas: ${String(r.deleted ?? 0)}`)}>Purgar caducadas ahora</Button>}
      >
        <label htmlFor="games-q" className="sr-only">Buscar partida</label>
        <input id="games-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, código o anfitrión…" className="mb-3 w-full max-w-md rounded-xl border border-white/15 bg-night-900 px-4 py-2" />
        <Table head={['Partida', 'Anfitrión', 'Estado', 'Jugadores', 'IA usada', 'Peso', 'Última actividad', '']} empty={rows.length === 0 ? 'No hay partidas.' : undefined}>
          {rows.map((g) => (
            <tr key={g.id}>
              <td className="px-2 py-2"><p className="font-semibold">{g.name}</p><p className="font-mono text-xs text-white/50">{g.room_code} · {g.image_mode === 'ai' ? 'IA' : 'pegatinas'} · {g.play_mode === 'mobile' ? 'móviles' : 'anfitrión'}</p></td>
              <td className="px-2 py-2">{g.host_email ?? <span className="font-mono text-xs text-white/50">{g.host_id.slice(0, 8)}</span>}</td>
              <td className="px-2 py-2">{STATUS[g.status] ?? g.status}</td>
              <td className="px-2 py-2 tabular-nums">{g.players}</td>
              <td className="px-2 py-2 tabular-nums">{g.ai_used}</td>
              <td className="px-2 py-2 tabular-nums">{formatBytes(g.bytes)} <span className="text-white/45">({g.versions})</span></td>
              <td className="px-2 py-2">{fmtDate(g.updated_at)}</td>
              <td className="px-2 py-2 text-right"><Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setDel(g)}>Borrar</Button></td>
            </tr>
          ))}
        </Table>
      </Section>
      <ConfirmDialog
        open={!!del}
        title="Borrar partida"
        confirmLabel="Borrar partida"
        variant="danger"
        loading={busy === 'delete'}
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          if (del && (await run('delete', { op: 'delete', room_code: del.room_code }, () => `Partida ${del.room_code} borrada`))) setDel(null);
        }}
      >
        {del ? <p>Se borrará «{del.name}» ({del.room_code}) con sus jugadores, pujas e imágenes ({formatBytes(del.bytes)}). <b>No se puede deshacer.</b></p> : null}
      </ConfirmDialog>
    </div>
  );
}
