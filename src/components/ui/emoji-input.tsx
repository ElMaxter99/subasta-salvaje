'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { EMOJI_CATEGORIES, searchEmojis } from '@/lib/domain/emoji-list';

/**
 * Campo de emoji con selector desplegable (como el teclado de emojis del móvil): categorías, buscador en español y un clic para elegir.
 * También se puede escribir o pegar a mano (p. ej. con el teclado de emojis del sistema). Sin dependencias externas.
 */
export function EmojiInput({ value, onChange, ariaLabel, className = '', placeholder = '🎁', id, maxLength = 8 }: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  id?: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0]!.id);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  function toggle() {
    if (!open && wrap.current) {
      const r = wrap.current.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 16);
      const h = 340;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
      setPos({ top, left });
      setQ('');
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => { if (!wrap.current?.contains(ev.target as Node) && !panel.current?.contains(ev.target as Node)) setOpen(false); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const list = q.trim() ? searchEmojis(q) : (EMOJI_CATEGORIES.find((c) => c.id === cat)?.items ?? []).map(([em]) => em);
  const pick = (em: string) => { onChange(em); setOpen(false); };

  return (
    <div ref={wrap} className="relative">
      <input id={id} aria-label={ariaLabel} className={`${className} pr-9`} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <button
        type="button"
        onClick={toggle}
        aria-label="Selector de emojis"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <Smile className="size-5" aria-hidden />
      </button>
      {open && pos ? (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Elegir emoji"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.min(320, window.innerWidth - 16), height: 340, zIndex: 100 }}
          className="flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-night-800 text-white shadow-2xl"
        >
          <div className="border-b border-white/10 p-2">
            <input autoFocus aria-label="Buscar emoji" placeholder="Buscar: gato, pizza, barco…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full rounded-lg border border-white/15 bg-night-900 px-3 py-1.5 text-sm" />
          </div>
          {!q.trim() ? (
            <div role="tablist" aria-label="Categorías de emojis" className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-1">
              {EMOJI_CATEGORIES.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} aria-label={c.label} title={c.label} onClick={() => setCat(c.id)} className={`grid size-9 shrink-0 place-items-center rounded-lg text-xl ${cat === c.id ? 'bg-gold/25' : 'hover:bg-white/10'}`}>{c.icon}</button>
              ))}
            </div>
          ) : null}
          <div className="grid min-h-0 flex-1 grid-cols-7 content-start gap-0.5 overflow-y-auto overscroll-contain p-2" data-testid="emoji-grid">
            {list.length === 0 ? <p className="col-span-7 p-2 text-sm text-white/65">Sin resultados. Prueba otra palabra o escribe el emoji.</p> : list.map((em) => (
              <button key={em} type="button" onClick={() => pick(em)} aria-label={`Emoji ${em}`} className="grid aspect-square place-items-center rounded-lg text-2xl hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60">{em}</button>
            ))}
          </div>
          {value ? <button type="button" onClick={() => pick('')} className="border-t border-white/10 px-3 py-2 text-left text-sm text-white/70 hover:bg-white/10">Quitar emoji</button> : null}
        </div>
      ) : null}
    </div>
  );
}
