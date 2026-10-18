'use client';

import { useEffect, useRef } from 'react';
import { Keyboard } from 'lucide-react';

export type ShortcutKey = 'a' | 'r' | 'c' | 'd' | 'x';
export type ShortcutHandlers = Partial<Record<ShortcutKey, () => void>>;

/** ¿El foco está en algo donde se escribe (o hay un diálogo abierto)? Entonces las teclas no deben disparar acciones. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Atajos de teclado del panel del anfitrión (una sola letra, sin Ctrl/Alt/Meta): A anunciar el siguiente, R anunciar uno al azar,
 * C cerrar la puja, D adjudicar y X cancelar. Adjudicar y cancelar solo ABREN su diálogo de confirmación (el dinero nunca se mueve
 * con una tecla suelta). Solo pasan los handlers que aplican al estado actual; con un diálogo abierto o escribiendo no hacen nada.
 */
export function useHostShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => { ref.current = handlers; });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.defaultPrevented) return;
      if (typing(e.target) || document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase() as ShortcutKey;
      const fn = ref.current[k];
      if (!fn) return;
      e.preventDefault();
      fn();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const LABELS: Record<ShortcutKey, string> = { a: 'Anunciar el siguiente', r: 'Anunciar uno al azar', c: 'Cerrar la puja', d: 'Adjudicar', x: 'Cancelar la subasta' };

/** Chuleta de atajos: solo muestra los que aplican ahora mismo. */
export function ShortcutsHint({ active }: { active: ShortcutKey[] }) {
  if (active.length === 0) return null;
  return (
    <p className="hidden items-center gap-x-3 gap-y-1 text-xs text-white/60 md:flex md:flex-wrap" data-testid="shortcuts-hint">
      <Keyboard className="size-4" aria-hidden />
      <span className="sr-only">Atajos de teclado:</span>
      {active.map((k) => (
        <span key={k}><kbd className="rounded bg-night-700 px-1.5 py-0.5 font-mono font-bold text-white">{k.toUpperCase()}</kbd> {LABELS[k]}</span>
      ))}
    </p>
  );
}
