import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { MASCOT_ASSETS, MASCOT_BG, type MascotId } from './assets';

/** Altura del recurso (rem). Se puede sustituir con clases responsive, p. ej. `className="[--mh:12rem] md:[--mh:22rem]"`. */
const SIZES = {
  xs: '[--mh:4.4rem]',
  sm: '[--mh:8rem]',
  md: '[--mh:12rem]',
  lg: '[--mh:20rem]',
  xl: '[--mh:30rem]',
} as const;
export type MascotSize = keyof typeof SIZES;
export type MascotMotion = 'none' | 'bob' | 'pop';

/**
 * Mascota de marca. Decorativa por defecto (`alt` vacío y `aria-hidden`); pasa `alt` si aporta información.
 *  · `tile`: pone detrás el color del fondo de la lámina con esquinas redondeadas (necesario para los recortes `difuminado`:
 *    mascota, expresiones y poses). Los recursos `item-*` tienen transparencia real y no lo necesitan.
 *  · `motion`: `bob` (flotación suave) o `pop` (entrada breve). Con `prefers-reduced-motion` no se anima.
 */
export function Mascot({ variant, size = 'md', tile, motion = 'none', alt, className = '', priority }: { variant: MascotId; size?: MascotSize; tile?: boolean; motion?: MascotMotion; alt?: string; className?: string; priority?: boolean }) {
  const a = MASCOT_ASSETS[variant];
  const style = { aspectRatio: `${a.width} / ${a.height}`, ...(tile ? { background: MASCOT_BG } : {}) } as CSSProperties;
  return (
    <span
      className={`ss-mascot inline-block h-[var(--mh)] shrink-0 ${SIZES[size]} ${tile ? 'overflow-hidden rounded-[1.1rem] ring-1 ring-white/10' : ''} ${motion === 'bob' ? 'ss-mascot-bob' : motion === 'pop' ? 'ss-mascot-pop' : ''} ${className}`}
      style={style}
      data-mascot={variant}
    >
      <Image src={a.src} alt={alt ?? ''} aria-hidden={alt ? undefined : true} width={a.width} height={a.height} unoptimized priority={priority} className="size-full object-contain" draggable={false} />
    </span>
  );
}

/** Estado vacío / de error con la mascota. */
export function EmptyState({ variant, title, children, size = 'md', className = '', action }: { variant: MascotId; title: string; children?: ReactNode; size?: MascotSize; className?: string; action?: ReactNode }) {
  return (
    <div className={`flex flex-col items-center gap-4 text-center ${className}`}>
      <Mascot variant={variant} size={size} tile motion="pop" />
      <h2 className="font-display text-2xl">{title}</h2>
      {children ? <div className="max-w-md text-white/70">{children}</div> : null}
      {action}
    </div>
  );
}
