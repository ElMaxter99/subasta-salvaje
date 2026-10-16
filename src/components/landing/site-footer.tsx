import Link from 'next/link';
import { APP_NAME, APP_VERSION, LEGAL_LINKS, REPO_URL } from '@/lib/legal/site';

const LINK = 'rounded-md px-1 py-1 text-white/75 underline-offset-4 hover:text-gold hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold';

/** Pie de la página de inicio y de las páginas legales. NO se monta en /game/* (la TV no lo muestra). */
export function SiteFooter() {
  return (
    <footer className="mt-4 w-full border-t border-white/10 pt-6 text-sm" data-testid="site-footer">
      <div className="flex flex-col items-center gap-4 text-center md:flex-row md:items-start md:justify-between md:text-left">
        <p className="text-white/70">
          <span className="font-display text-base text-white">{APP_NAME}</span>{' '}
          <span data-testid="app-version" className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold text-white/80">v{APP_VERSION}</span>
        </p>
        <nav aria-label="Información legal y del proyecto">
          <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 md:justify-end">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={LINK}>{l.label}</Link>
              </li>
            ))}
            <li>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                Repositorio<span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
