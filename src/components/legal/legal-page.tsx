import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/landing/site-footer';
import { Logo } from '@/components/ui/logo';
import { getLegalHolder, HOLDER_PENDING, LEGAL_DISCLAIMER, LEGAL_UPDATED, LEGAL_UPDATED_LABEL } from '@/lib/legal/site';

/** Estructura común de las páginas legales: logo, título, última actualización, aviso de plantilla y «Volver al inicio». */
export function LegalPage({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-5 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Logo size="md" />
        <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold">
          <ArrowLeft className="size-4" aria-hidden /> Volver al inicio
        </Link>
      </header>
      <div className="space-y-2">
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
        <p className="text-sm text-white/70">Última actualización: <time dateTime={LEGAL_UPDATED}>{LEGAL_UPDATED_LABEL}</time></p>
        {intro ? <p className="text-white/80">{intro}</p> : null}
      </div>
      <p role="note" className="rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold-soft">{LEGAL_DISCLAIMER}</p>
      <div className="space-y-6 text-white/85 [&_a]:font-bold [&_a]:text-gold [&_a]:underline [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_section]:space-y-2 [&_td]:align-top">
        {children}
      </div>
      <SiteFooter />
    </main>
  );
}

/** Datos del titular tal como están configurados; si faltan, aviso visible en vez de datos inventados. */
export function HolderBlock() {
  const h = getLegalHolder();
  return (
    <div className="space-y-1 rounded-2xl border border-white/15 bg-night-800/70 p-4 text-sm" data-testid="holder-block">
      {h.incomplete ? (
        <p role="alert" className="rounded-lg bg-warning/20 px-3 py-2 font-bold text-warning" data-testid="holder-pending">{HOLDER_PENDING}</p>
      ) : null}
      <ul className="space-y-1">
        {h.name ? <li><strong>Titular:</strong> {h.name}</li> : null}
        {h.nif ? <li><strong>NIF/CIF:</strong> {h.nif}</li> : null}
        {h.address ? <li><strong>Domicilio:</strong> {h.address}</li> : null}
        {h.email ? <li><strong>Contacto:</strong> <a href={`mailto:${h.email}`}>{h.email}</a></li> : null}
      </ul>
    </div>
  );
}
