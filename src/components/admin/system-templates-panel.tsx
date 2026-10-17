'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { adminPost } from '@/lib/client/admin-api';
import type { ImageCheck, SystemTemplateSummary } from '@/lib/services/system-template-service';
import { Section, Table, fmtDate } from './widgets';

export function SystemTemplatesPanel({ templates, cdnHosts }: { templates: SystemTemplateSummary[]; cdnHosts: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checks, setChecks] = useState<{ title: string; list: ImageCheck[] } | null>(null);
  const [del, setDel] = useState<SystemTemplateSummary | null>(null);

  async function run<T>(key: string, body: unknown, ok: string | ((r: T) => string)): Promise<T | null> {
    setBusy(key);
    setMsg(null);
    try {
      const r = await adminPost<T>('system-templates', body);
      setMsg({ ok: true, text: typeof ok === 'function' ? ok(r) : ok });
      router.refresh();
      return r;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}

      <Section
        title="Partidas del sistema"
        hint={
          <>
            Plantillas que los anfitriones ven en «Nueva partida → Partidas del sistema». Los <b>borradores</b> solo los ves tú. Las fotos van en un servicio externo (CDN) y se <b>copian a cada partida</b> al crearla.{' '}
            {cdnHosts.length ? <>Servidores de fotos permitidos: <code>{cdnHosts.join(', ')}</code>.</> : <b className="text-gold-soft">ASSET_CDN_HOSTS no está definida: se acepta cualquier servidor https. Defínela en Vercel para restringirlo.</b>}
          </>
        }
        action={<Link href="/admin/plantillas/editor" className="inline-flex min-h-11 items-center rounded-xl bg-gold px-4 py-2 text-sm font-bold text-night-950 hover:bg-gold-soft">Nueva plantilla</Link>}
      >
        <Table head={['Plantilla', 'Estado', 'Contenido', 'Actualizada', 'Acciones']} empty={templates.length === 0 ? 'Todavía no hay plantillas del sistema.' : undefined}>
          {templates.map((t) => (
            <tr key={t.id} className="align-top" data-testid="system-template-row">
              <td className="px-2 py-2">
                <p className="font-semibold">{t.title}</p>
                <p className="font-mono text-xs text-white/45">{t.slug}</p>
              </td>
              <td className="px-2 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t.status === 'published' ? 'bg-teal/20 text-teal' : 'bg-white/10 text-white/80'}`}>{t.status === 'published' ? 'Publicada' : 'Borrador'}</span>
              </td>
              <td className="px-2 py-2 text-sm">{t.items} elementos · {t.players} jugadores{t.has_initial_image ? ' · casa inicial' : ''}</td>
              <td className="px-2 py-2">{fmtDate(t.updated_at)}</td>
              <td className="px-2 py-2">
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" disabled={busy !== null} loading={busy === `get-${t.id}`} onClick={() => router.push(`/admin/plantillas/editor?id=${t.id}`)}>Editar</Button>
                  <Button size="sm" variant="secondary" disabled={busy !== null} loading={busy === `check-${t.id}`} onClick={async () => { const r = await run<{ checks: ImageCheck[] }>(`check-${t.id}`, { op: 'check', id: t.id }, (x) => `Imágenes comprobadas: ${x.checks.filter((c) => c.ok).length} de ${x.checks.length} correctas`); if (r) setChecks({ title: t.title, list: r.checks }); }}>Comprobar imágenes</Button>
                  <Button size="sm" variant={t.status === 'published' ? 'ghost' : 'primary'} disabled={busy !== null} loading={busy === `st-${t.id}`} onClick={async () => { const r = await run<{ checks: ImageCheck[] }>(`st-${t.id}`, { op: 'status', id: t.id, status: t.status === 'published' ? 'draft' : 'published' }, t.status === 'published' ? 'Plantilla retirada (vuelve a ser borrador)' : 'Plantilla publicada'); if (r && r.checks.length) setChecks({ title: t.title, list: r.checks }); }}>
                    {t.status === 'published' ? 'Retirar' : 'Publicar'}
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setDel(t)}>Borrar</Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      {checks ? (
        <Section title={`Informe de imágenes · ${checks.title}`} hint="«Formato interno»: WebP dentro del tamaño y peso de su tipo. Una foto que no lo cumple se acepta y se reduce al copiarla, pero conviene prepararla con npm run assets:normalize." action={<Button size="sm" variant="ghost" onClick={() => setChecks(null)}>Cerrar</Button>}>
          <Table head={['Imagen', 'Estado', 'Formato', 'Tamaño', 'Peso', 'Nota']} empty={checks.list.length === 0 ? 'Esta plantilla no lleva imágenes.' : undefined}>
            {checks.list.map((c) => (
              <tr key={c.label + c.url} className="align-top">
                <td className="px-2 py-1.5"><p className="font-semibold">{c.label}</p><p className="max-w-xs truncate font-mono text-xs text-white/45">{c.url}</p></td>
                <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${!c.ok ? 'bg-rose/20 text-rose' : c.internal ? 'bg-teal/20 text-teal' : 'bg-gold/20 text-gold-soft'}`}>{!c.ok ? 'Error' : c.internal ? 'Formato interno' : 'Se reducirá'}</span></td>
                <td className="px-2 py-1.5">{c.format ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{c.width && c.height ? `${c.width}×${c.height}` : '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">{c.bytes ? `${Math.round(c.bytes / 1024)} KB` : '—'}</td>
                <td className="px-2 py-1.5 text-xs text-white/70">{c.note ?? ''}</td>
              </tr>
            ))}
          </Table>
        </Section>
      ) : null}

      <ConfirmDialog
        open={!!del}
        title="Borrar plantilla del sistema"
        confirmLabel="Borrar"
        variant="danger"
        loading={busy === 'delete'}
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          if (await run('delete', { op: 'delete', id: del.id }, `Plantilla «${del.title}» borrada`)) setDel(null);
        }}
      >
        {del ? <p>Se borrará <b>{del.title}</b>. Las partidas ya creadas con ella no cambian. No se puede deshacer.</p> : null}
      </ConfirmDialog>
    </div>
  );
}
