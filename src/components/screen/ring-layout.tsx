'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Player } from '@/lib/domain/types';

/**
 * Reparto de jugadores alrededor del centro («anillo»): izquierda, derecha y, si no caben, fila inferior.
 * Hasta 3 por lado (1 si son pocos), el resto abajo. Los primeros van a la izquierda, luego a la derecha y el resto abajo.
 *   2 → 1|1 · 3 → 1|1+1 abajo · 4 → 2|2 · 5 → 2|2+1 · 6 → 2|2+2 · 8 → 3|3+2 · 10 → 3|3+4
 */
export function ringSplit(n: number): { perSide: number; left: number; right: number; bottom: number } {
  if (n <= 0) return { perSide: 0, left: 0, right: 0, bottom: 0 };
  if (n === 1) return { perSide: 1, left: 1, right: 0, bottom: 0 };
  const perSide = n <= 3 ? 1 : n <= 6 ? 2 : 3;
  return { perSide, left: perSide, right: perSide, bottom: n - 2 * perSide };
}

/** Columnas de la vista «jugadores en primer plano» (entre subastas): la que da tarjetas más grandes en una pantalla 16:9. */
export function spotlightGrid(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  let best = { cols: 1, rows: n, side: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const side = Math.min(2.2 / cols, 1 / rows); // pantalla ≈ 2,2 de ancho por 1 de alto
    if (side > best.side + 1e-9) best = { cols, rows, side };
  }
  return { cols: best.cols, rows: best.rows };
}

/**
 * Subasta en el centro y los jugadores rodeándola (izquierda, derecha y abajo): escala de 2 a 10 jugadores sin cambiar el diseño.
 * `renderCard` pinta la tarjeta de un jugador; aquí solo se reparte el espacio.
 */
export function RingLayout({ players, center, renderCard }: { players: Player[]; center: ReactNode; renderCard: (p: Player, side: 'left' | 'right' | 'bottom') => ReactNode }) {
  const { left, right } = ringSplit(players.length);
  const L = players.slice(0, left);
  const R = players.slice(left, left + right);
  const B = players.slice(left + right);
  const sideW = players.length <= 2 ? '26%' : players.length <= 4 ? '23%' : '21%';
  const col = (list: Player[], side: 'left' | 'right') => (
    <div className="flex min-h-0 flex-col gap-[1rem]" style={{ gridColumn: side === 'left' ? 1 : 3, gridRow: 1 }} data-testid={`ring-${side}`}>
      {list.map((p) => (
        <div key={p.id} className="flex min-h-0 flex-1 items-center justify-center">
          <div className="aspect-square max-h-full w-full">{renderCard(p, side)}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div
      className="grid h-full min-h-0 gap-x-[1.5rem] gap-y-[1rem]"
      style={{
        gridTemplateColumns: `${L.length ? sideW : '0px'} minmax(0, 1fr) ${R.length ? sideW : '0px'}`,
        gridTemplateRows: B.length ? 'minmax(0, 1fr) 27%' : 'minmax(0, 1fr)',
      }}
    >
      {L.length ? col(L, 'left') : <div style={{ gridColumn: 1, gridRow: 1 }} />}
      <div className="min-h-0 min-w-0" style={{ gridColumn: 2, gridRow: 1 }}>{center}</div>
      {R.length ? col(R, 'right') : <div style={{ gridColumn: 3, gridRow: 1 }} />}
      {B.length ? (
        <div className="flex min-h-0 justify-center gap-[1rem]" style={{ gridColumn: '1 / -1', gridRow: 2 }} data-testid="ring-bottom">
          {B.map((p) => (
            <div key={p.id} className="min-h-0 min-w-0 flex-1" style={{ maxWidth: '24rem' }}>{renderCard(p, 'bottom')}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Jugadores en primer plano (entre subastas): tarjetas grandes y casi cuadradas que llenan EXACTAMENTE el espacio disponible.
 * El lado de cada tarjeta se calcula midiendo el contenedor real (ResizeObserver), no con estimaciones de pantalla: así nunca se
 * sale ni tapa el banner, sea cual sea el tamaño de la ventana, la cabecera o los controles.
 */
export function SpotlightGrid({ players, renderCard }: { players: Player[]; renderCard: (p: Player, dense: boolean) => ReactNode }) {
  const { cols, rows } = spotlightGrid(players.length);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e?.contentRect;
      if (r) setBox({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gap = 16;
  const side = box ? Math.max(0, Math.floor(Math.min((box.w - gap * (cols - 1)) / cols, (box.h - gap * (rows - 1)) / rows))) : 0;
  return (
    <div ref={ref} className="flex h-full min-h-0 w-full flex-wrap content-center items-center justify-center overflow-hidden" style={{ gap }} data-testid="spotlight-grid">
      {box && side > 0
        ? players.map((p) => (
            <div key={p.id} style={{ width: side, height: side }} className="min-h-0 min-w-0">{renderCard(p, cols >= 4)}</div>
          ))
        : null}
    </div>
  );
}
