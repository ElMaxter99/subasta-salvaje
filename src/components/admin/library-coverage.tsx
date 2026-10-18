'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { libraryApi, type CoverageReport, type LibraryImage } from '@/lib/client/library-api';
import { Section, Stat } from './widgets';

type Pair = { distance: number; a: LibraryImage; b: LibraryImage };

const bar = (have: number, target: number) => (target > 0 ? Math.min(100, Math.round((have / target) * 100)) : 100);

/**
 * Cobertura de la biblioteca: cuántas imágenes PUBLICADAS (revisadas, las que ve un anfitrión en el selector) hay por rol y categoría
 * frente al objetivo de `LIBRARY_CATEGORIES`, con los huecos que faltan, y la lista de control de calidad. Refleja el estado de `version`.
 */
export function LibraryCoverage({ version, onFilter }: { version: number; onFilter: (f: { category: string; role: 'start' | 'product' | '' }) => void }) {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    libraryApi.coverage().then((r) => alive && (setReport(r), setError(''))).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo calcular la cobertura'));
    return () => { alive = false; };
  }, [version]);

  if (error) return <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{error}</p>;
  if (!report) return <p className="text-sm text-white/60">Calculando cobertura…</p>;
  const t = report.totals;
  const pending = t.total - t.published;
  return (
    <div className="space-y-4" data-testid="library-coverage">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Imágenes" value={t.total} sub={`${t.published} publicadas en el selector`} />
        <Stat label="Fotos de inicio" value={`${report.have.start}/${report.target.start}`} sub={report.missing.start > 0 ? `faltan ${report.missing.start}` : 'objetivo alcanzado'} />
        <Stat label="Productos" value={`${report.have.product}/${report.target.product}`} sub={report.missing.product > 0 ? `faltan ${report.missing.product}` : 'objetivo alcanzado'} />
        <Stat label="Por revisar" value={pending} sub="no las ven los anfitriones" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm" data-testid="coverage-table">
          <caption className="sr-only">Cobertura por categoría y rol</caption>
          <thead className="text-xs uppercase text-white/55">
            <tr><th scope="col" className="py-1 pr-2">Categoría</th><th scope="col" className="px-2">Inicio</th><th scope="col" className="px-2">Producto</th><th scope="col" className="px-2">Total</th><th scope="col" className="pl-2"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.name} className="border-t border-white/10" data-testid="coverage-row">
                <th scope="row" className="py-1.5 pr-2 font-semibold">{r.name}{r.planned ? '' : <span className="ml-1 text-xs font-normal text-white/50">(propia)</span>}</th>
                <td className="px-2">{r.target_start > 0 ? <Cell have={r.start} target={r.target_start} label={`${r.name}: fotos de inicio`} /> : <span className="text-white/50">{r.start || '·'}</span>}</td>
                <td className="px-2">{r.target_product > 0 ? <Cell have={r.product} target={r.target_product} label={`${r.name}: productos`} /> : <span className="text-white/50">{r.product || '·'}</span>}</td>
                <td className="px-2 tabular-nums text-white/70">{r.published}/{r.total}</td>
                <td className="pl-2"><Button size="sm" variant="ghost" onClick={() => onFilter({ category: r.name, role: '' })} aria-label={`Ver las imágenes de ${r.name}`}>Ver</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-bold">Lista de calidad (pendientes)</h3>
        <ul className="grid gap-1 text-sm sm:grid-cols-2" data-testid="quality-checklist">
          <Check ok={t.no_credit === 0} text={`Todas con crédito u origen (${t.no_credit} sin crédito)`} />
          <Check ok={pending === 0} text={`Todas revisadas (${pending} por revisar)`} />
          <Check ok={t.no_role === 0} text={`Todas con rol (${t.no_role} sin rol: no se ofrecen)`} />
          <Check ok={t.no_category === 0} text={`Todas con categoría (${t.no_category} sin categoría)`} />
          <Check ok={t.no_phash === 0} text={`Todas con huella para detectar parecidas (${t.no_phash} sin huella)`} />
        </ul>
        <p className="mt-2 text-xs text-white/55">Las cifras de «Inicio» y «Producto» cuentan solo imágenes revisadas con ese rol. Los objetivos están en <code>src/lib/library/taxonomy.ts</code> (<code>LIBRARY_CATEGORIES</code>).</p>
      </div>
    </div>
  );
}

function Cell({ have, target, label }: { have: number; target: number; label: string }) {
  const pct = bar(have, target);
  return (
    <div className="min-w-24">
      <span className="tabular-nums">{have}/{target}</span>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(have, target)} className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${pct >= 100 ? 'bg-teal' : pct >= 50 ? 'bg-gold' : 'bg-rose'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return <li className={ok ? 'text-teal' : 'text-gold-soft'}><span aria-hidden>{ok ? '✔' : '○'}</span> <span className="sr-only">{ok ? 'Hecho: ' : 'Pendiente: '}</span>{text}</li>;
}

/** Parejas de imágenes que se parecen por su CONTENIDO (huella perceptual) y botón para calcular la huella de las anteriores. */
export function LibrarySimilar({ version, onChanged, onDelete, busy }: { version: number; onChanged: () => void; onDelete: (i: LibraryImage) => void; busy: boolean }) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [info, setInfo] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let alive = true;
    libraryApi.similar().then((r) => alive && setPairs(r.pairs)).catch(() => undefined);
    return () => { alive = false; };
  }, [version]);

  const backfill = useCallback(async () => {
    setWorking(true);
    setInfo('');
    try {
      const r = await libraryApi.backfillHashes();
      setInfo(`${r.done} huellas calculadas${r.failed ? `, ${r.failed} fallidas` : ''}; quedan ${r.remaining}.`);
      onChanged();
    } catch (e) { setInfo(e instanceof Error ? e.message : 'No se pudo calcular'); } finally { setWorking(false); }
  }, [onChanged]);

  return (
    <Section
      title={`Parecidas por contenido (${pairs.length})`}
      hint="Parejas cuya huella perceptual (64 bits) difiere en 6 bits o menos: misma foto con otro tamaño, recorte leve o compresión. Es una ayuda sencilla, no una garantía: revisa antes de borrar. Se quita el registro; el archivo sigue en GitHub."
      action={<Button size="sm" variant="secondary" loading={working} onClick={() => void backfill()} data-testid="library-backfill">Calcular huellas que faltan</Button>}
    >
      {info ? <p role="status" className="mb-2 text-sm text-white/70">{info}</p> : null}
      {pairs.length === 0 ? <p className="text-sm text-white/70">No hay parejas parecidas entre las imágenes que ya tienen huella.</p> : (
        <ul className="space-y-3" data-testid="library-similar">
          {pairs.map((p) => (
            <li key={`${p.a.id}|${p.b.id}`} className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-night-900 p-3">
              {[p.a, p.b].map((i) => (
                <div key={i.id} className="overflow-hidden rounded-xl border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
                  <img src={i.url} alt={i.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-[3/2] w-full object-cover" />
                  <div className="flex items-center justify-between gap-1 p-2 text-xs">
                    <span className="min-w-0 truncate" title={i.title}>{i.title || '(sin título)'} <span className="text-white/50">· {i.collection || 'sin colección'}</span></span>
                    <Button size="sm" variant="danger" disabled={busy} aria-label={`Borrar el registro de ${i.title}`} onClick={() => onDelete(i)}>Borrar</Button>
                  </div>
                </div>
              ))}
              <p className="col-span-2 text-xs text-white/60">Distancia {p.distance} de 64 (0 = idénticas).</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
