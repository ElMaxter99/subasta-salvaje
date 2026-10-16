'use client';

import { useId, useState } from 'react';
import { Card, fmtDateTime } from './bits';
import type { ImageVersion } from '@/lib/domain/types';

export function versionLabel(v: ImageVersion): string {
  if (v.origin === 'initial') return 'Inicial';
  if (v.origin === 'uploaded') return 'Subida';
  return `Edición${v.item_name ? ` + ${v.item_name}` : ''}`;
}

function Side({ tag, v }: { tag: string; v: ImageVersion }) {
  return (
    <figure className="min-w-0">
      {v.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.url} alt={`Versión ${tag}: ${versionLabel(v)}`} className="aspect-square w-full rounded-2xl bg-night-950 object-cover" />
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-white/20 text-sm text-white/50">Sin imagen</div>
      )}
      <figcaption className="mt-1 text-sm text-white/75">
        <b className="text-gold">{tag}</b> · {versionLabel(v)} · {fmtDateTime(v.created_at)}
      </figcaption>
    </figure>
  );
}

/** Comparación lado a lado + slider antes/después (input range: accesible con teclado). */
export function ImageCompare({ a, b }: { a: ImageVersion; b: ImageVersion }) {
  const [pos, setPos] = useState(50);
  const id = useId();
  return (
    <Card title="Comparación">
      <div className="grid grid-cols-2 gap-3">
        <Side tag="A" v={a} />
        <Side tag="B" v={b} />
      </div>
      {a.url && b.url ? (
        <div className="mt-4">
          <label htmlFor={id} className="mb-2 block text-sm font-semibold text-white/80">
            Antes / después (A a la izquierda, B a la derecha) · desliza o usa las flechas
          </label>
          <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-night-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.url} alt="" className="absolute inset-0 size-full object-cover" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt="" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
            <div className="pointer-events-none absolute inset-y-0 w-1 -translate-x-1/2 bg-gold shadow-[0_0_12px_#000]" style={{ left: `${pos}%` }} />
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-bold">A</span>
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-bold">B</span>
          </div>
          <input id={id} type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="mx-auto mt-3 block h-8 w-full max-w-md accent-gold" aria-valuetext={`${pos}% de A visible`} />
        </div>
      ) : null}
    </Card>
  );
}
