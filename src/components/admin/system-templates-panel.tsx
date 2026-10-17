'use client';

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { adminPost } from '@/lib/client/admin-api';
import { blankTemplate, parseTemplate } from '@/lib/domain/template';
import type { ImageCheck, SystemTemplate, SystemTemplateSummary } from '@/lib/services/system-template-service';
import { Section, Table, fmtDate } from './widgets';

interface Draft {
  id?: string;
  slug: string;
  title: string;
  description: string;
  sort_order: string;
  json: string;
}

function emptyDraft(): Draft {
  const t = { ...blankTemplate(), portada: 'https://cdn.tudominio.com/plantillas/mi-plantilla/portada.webp', casa_inicial: null, nombre: 'Mi partida del sistema' };
  return { slug: '', title: '', description: '', sort_order: '100', json: JSON.stringify(t, null, 2) };
}

export function SystemTemplatesPanel({ templates, cdnHosts }: { templates: SystemTemplateSummary[]; cdnHosts: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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

  async function edit(t: SystemTemplateSummary) {
    setBusy(`get-${t.id}`);
    setMsg(null);
    try {
      const full = await adminPost<SystemTemplate>('system-templates', { op: 'get', id: t.id });
      setDraft({ id: full.id, slug: full.slug, title: full.title, description: full.description, sort_order: String(full.sort_order), json: JSON.stringify(full.data, null, 2) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setBusy(null);
    }
  }

  function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    void file.text().then((text) => {
      const parsed = parseTemplate(text);
      if (!parsed.ok) return setMsg({ ok: false, text: `El archivo no es una plantilla válida: ${parsed.errors[0]}` });
      const slug = parsed.template.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      setDraft({ slug, title: parsed.template.nombre, description: '', sort_order: '100', json: JSON.stringify(parsed.template, null, 2) });
      setMsg({ ok: true, text: 'Plantilla cargada en el editor: revísala y guarda el borrador.' });
    });
  }

  const live = draft ? parseTemplate(draft.json) : null;
  const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2';

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
        action={
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/15">
              Importar JSON
              <input type="file" accept="application/json,.json" className="sr-only" aria-label="Importar plantilla JSON" onChange={onFile} />
            </label>
            <Button variant="primary" onClick={() => { setMsg(null); setDraft(emptyDraft()); }}>Nueva plantilla</Button>
          </div>
        }
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
                  <Button size="sm" variant="secondary" disabled={busy !== null} loading={busy === `get-${t.id}`} onClick={() => edit(t)}>Editar</Button>
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

      {draft ? (
        <Section title={draft.id ? 'Editar plantilla' : 'Nueva plantilla'} hint="Contenido en el formato de plantilla (JSON). La portada es la imagen de la tarjeta; casa_inicial es la imagen inicial que recibirán los jugadores. Las fotos deben ser enlaces https de tu CDN.">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!live?.ok) return;
              const r = await run('save', { op: 'save', ...(draft.id ? { id: draft.id } : {}), slug: draft.slug, title: draft.title, description: draft.description, sort_order: Number(draft.sort_order) || 100, data: live.template }, 'Borrador guardado');
              if (r) setDraft(null);
            }}
          >
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-sm font-semibold md:col-span-2">Título<input aria-label="Título" required maxLength={80} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${input} mt-1`} /></label>
              <label className="text-sm font-semibold">Identificador (slug)<input aria-label="Identificador" required maxLength={60} value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} placeholder="noche-de-playa" className={`${input} mt-1 font-mono`} /></label>
              <label className="text-sm font-semibold">Orden<input aria-label="Orden" inputMode="numeric" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value.replace(/\D/g, '') })} className={`${input} mt-1`} /></label>
            </div>
            <label className="block text-sm font-semibold">Descripción (la tarjeta, hasta 300 caracteres)<input aria-label="Descripción" maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${input} mt-1`} /></label>
            <label className="block text-sm font-semibold">
              Plantilla (JSON)
              <textarea aria-label="Plantilla JSON" spellCheck={false} rows={18} value={draft.json} onChange={(e) => setDraft({ ...draft, json: e.target.value })} className={`${input} mt-1 font-mono text-xs`} />
            </label>
            {live && !live.ok ? (
              <ul role="alert" className="space-y-1">
                {live.errors.map((er) => <li key={er} className="rounded-xl bg-rose/15 px-3 py-1.5 text-sm text-rose">{er}</li>)}
              </ul>
            ) : live?.ok ? (
              <div className="space-y-1">
                <p className="rounded-xl bg-teal/15 px-3 py-1.5 text-sm font-semibold text-teal" data-testid="template-valid">Plantilla válida · {live.template.catalogo?.length ?? 0} elementos · {live.template.jugadores.length} jugadores</p>
                {live.warnings.map((w) => <p key={w} className="rounded-xl bg-gold/10 px-3 py-1.5 text-xs text-gold-soft">{w}</p>)}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={busy === 'save'} disabled={busy !== null || !live?.ok || !draft.slug || !draft.title}>Guardar borrador</Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
            </div>
          </form>
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
