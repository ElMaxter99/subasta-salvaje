'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
/* eslint-disable @next/next/no-img-element -- miniaturas de la biblioteca (enlaces externos, tamaño fijo) */
import { Button } from '@/components/ui/button';
import { adminPost } from '@/lib/client/admin-api';
import type { Candidate } from '@/lib/library/match';
import type { ApplyResult, Proposal } from '@/lib/services/library-match-service';
import { Section } from './widgets';

const BADGE: Record<string, string> = { alta: 'bg-teal/20 text-teal', media: 'bg-gold/20 text-gold-soft', baja: 'bg-white/10 text-white/70' };

/**
 * «Sugerir fotos de la biblioteca»: muestra el casamiento (título + etiquetas) de una plantilla en BORRADOR con miniatura y confianza.
 * Se acepta una a una o todas las de confianza alta; la aplicación pasa por el servidor (`match_apply`), que revalida todo y guarda
 * la plantilla como borrador con enlaces (no copia imágenes, no publica, no usa IA).
 */
export function SystemTemplateMatch({ id, title, draft, onClose }: { id: string; title: string; draft: boolean; onClose: () => void }) {
  const router = useRouter();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>('load');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    adminPost<Proposal>('system-templates', { op: 'match_propose', id })
      .then((p) => alive && setProposal(p))
      .catch((e) => alive && setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }))
      .finally(() => alive && setBusy(null));
    return () => { alive = false; };
  }, [id]);

  async function accept(picks: { index: number; image_id: string }[], key: string) {
    if (!picks.length) return;
    setBusy(key);
    setMsg(null);
    try {
      const r = await adminPost<ApplyResult>('system-templates', { op: 'match_apply', id, picks });
      setDone((d) => new Set([...d, ...r.applied.map((a) => a.index)]));
      setMsg({ ok: true, text: `${r.applied.length} ${r.applied.length === 1 ? 'foto aplicada' : 'fotos aplicadas'} (la plantilla sigue en borrador)${r.skipped.length ? `; ${r.skipped.length} omitidas: ${r.skipped[0]!.reason}` : ''}.` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setBusy(null);
    }
  }

  const pending = proposal?.items.filter((i) => !i.hasPhoto && !done.has(i.index)) ?? [];
  const high = pending.filter((i) => i.best?.confidence === 'alta');
  const alternatives = (i: (typeof pending)[number]): Candidate[] => i.candidates.filter((c) => c.image.id !== i.best?.image.id && c.usedBy === undefined).slice(0, 3);

  return (
    <Section
      title={`Fotos sugeridas · ${title}`}
      hint={<>Casamiento por título y etiquetas con las fotos de <b>producto revisadas</b> de la biblioteca (sin IA). Se guardan por enlace, no se copian; la plantilla sigue en borrador. {proposal ? <>{proposal.library} fotos candidatas · {proposal.coverage.matched} de {proposal.coverage.total} elementos con propuesta ({proposal.coverage.pct} %).</> : null}</>}
      action={
        <div className="flex gap-2">
          <Button size="sm" disabled={!draft || busy !== null || high.length === 0} loading={busy === 'all'} data-testid="match-accept-high" onClick={() => accept(high.map((i) => ({ index: i.index, image_id: i.best!.image.id })), 'all')}>Aceptar las de confianza alta ({high.length})</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      }
    >
      {msg ? <p role="status" className={`mb-3 rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}
      {!draft ? <p className="mb-3 text-sm text-gold-soft">Esta plantilla está publicada: retírala a borrador para aplicarle fotos.</p> : null}
      {busy === 'load' ? <p className="text-sm text-white/60">Calculando propuestas…</p> : null}
      {proposal && proposal.library === 0 ? <p className="mb-3 text-sm text-white/70" data-testid="match-empty">La biblioteca aún no tiene fotos de producto revisadas, así que no hay propuestas. Sube y revisa fotos en Biblioteca.</p> : null}
      {proposal ? (
        <ul className="divide-y divide-white/10" data-testid="match-list">
          {proposal.items.map((i) => {
            const applied = done.has(i.index);
            return (
              <li key={i.index} className="flex flex-wrap items-start gap-3 py-2" data-testid="match-row">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-semibold">{i.index + 1}. {i.item.emoji ? `${i.item.emoji} ` : ''}{i.item.title}</p>
                  <p className="text-xs text-white/55">{(i.item.tags ?? []).join(' · ') || 'sin etiquetas'}</p>
                </div>
                {i.hasPhoto || applied ? (
                  <p className="text-sm text-teal">{applied ? 'Foto aplicada' : 'Ya tiene foto'}</p>
                ) : i.best ? (
                  <>
                    <img src={i.best.image.url} alt={i.best.image.title} width={56} height={56} loading="lazy" className="h-14 w-14 rounded-xl bg-night-900 object-cover" />
                    <div className="min-w-0 flex-1 basis-48 text-sm">
                      <p className="truncate font-semibold">{i.best.image.title}</p>
                      <p className="text-xs text-white/60"><span className={`rounded-full px-2 py-0.5 font-bold ${BADGE[i.best.confidence]}`}>{i.best.confidence}</span> {Math.round(i.best.score * 100)} % · {i.best.reasons.join(' · ')}</p>
                      {alternatives(i).length ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-white/55">Otras:
                          {alternatives(i).map((c) => (
                            <button key={c.image.id} type="button" disabled={!draft || busy !== null} title={`${c.image.title} · ${Math.round(c.score * 100)} %`} aria-label={`Usar «${c.image.title}»`} onClick={() => accept([{ index: i.index, image_id: c.image.id }], `a-${i.index}`)}>
                              <img src={c.image.url} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 rounded-lg object-cover" />
                            </button>
                          ))}
                        </p>
                      ) : null}
                    </div>
                    <Button size="sm" variant="secondary" disabled={!draft || busy !== null} loading={busy === `a-${i.index}`} onClick={() => accept([{ index: i.index, image_id: i.best!.image.id }], `a-${i.index}`)}>Aceptar</Button>
                  </>
                ) : (
                  <p className="text-sm text-white/55">Sin candidata{i.missing.length ? ` · falta: ${i.missing.slice(0, 5).join(', ')}` : ''}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}
