import Image from 'next/image';
import Link from 'next/link';
import brand from '../../../public/assets/brand/inventory.json';

const SIZES = { sm: 'h-9', md: 'h-14', lg: 'h-20', xl: 'h-28' } as const;
export type LogoSize = keyof typeof SIZES;

/**
 * Logotipo oficial (rótulo con corona, sin la mascota: esa va aparte con `Mascot`). Imagen, no texto: conserva su personalidad.
 * `variant="full"` es el logo con la mascota (solo para heros y pantallas de bienvenida).
 * La altura sale de `size`; añade `className` solo para posición (p. ej. `mx-auto`).
 */
export function Logo({ size = 'md', variant = 'compact', className = '', priority, href = '/' }: { size?: LogoSize; variant?: 'compact' | 'full'; className?: string; priority?: boolean; href?: string | null }) {
  const a = variant === 'full' ? brand.assets.full : brand.assets.compact;
  const img = (
    <Image
      src={`/assets/brand/${a.name}.webp`}
      alt="Subasta Salvaje"
      width={a.width}
      height={a.height}
      unoptimized
      priority={priority}
      draggable={false}
      className={`w-auto ${variant === 'full' ? 'h-44' : SIZES[size]}`}
    />
  );
  if (href === null) return <span className={`inline-block ${className}`}>{img}</span>;
  return (
    <Link href={href} className={`inline-block rounded-xl ${className}`} aria-label="Subasta Salvaje, inicio" data-testid="brand-logo">
      {img}
    </Link>
  );
}
