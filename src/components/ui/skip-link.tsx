'use client';

import { usePathname } from 'next/navigation';

/** «Saltar al contenido»: primer elemento enfocable de cada página (visible solo al recibir el foco). No se muestra en la TV. */
export function SkipLink() {
  const pathname = usePathname() ?? '';
  if (/^\/game\/[^/]+\/screen\/?$/.test(pathname)) return null;
  return (
    <a
      href="#contenido"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>('main');
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus();
        main.scrollIntoView();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-xl focus:bg-gold focus:px-4 focus:py-3 focus:font-bold focus:text-night-950"
    >
      Saltar al contenido
    </a>
  );
}
