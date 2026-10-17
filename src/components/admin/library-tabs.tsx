import Link from 'next/link';

/** Las dos vistas de la biblioteca del superadmin: solo fotos / catálogo de productos. */
export function LibraryTabs({ current }: { current: 'images' | 'items' }) {
  return (
    <nav aria-label="Biblioteca" className="flex gap-2">
      {([['images', 'Imágenes', '/admin/biblioteca'], ['items', 'Productos del catálogo', '/admin/catalogo']] as const).map(([id, label, href]) => (
        <Link key={id} href={href} aria-current={current === id ? 'page' : undefined} className={`inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-sm font-bold ${current === id ? 'bg-gold text-night-950' : 'bg-white/10 hover:bg-white/15'}`}>{label}</Link>
      ))}
    </nav>
  );
}
