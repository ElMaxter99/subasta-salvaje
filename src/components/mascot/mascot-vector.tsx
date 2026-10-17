import Image from 'next/image';
import inventory from '../../../public/assets/mascot-vector/inventory.json';
import type { MascotMotion, MascotSize } from './mascot';

/**
 * Colección VECTORIAL de la mascota con transparencia real (`public/assets/mascot-vector/`, ver docs/MASCOTA.md): poses y
 * expresiones independientes que sirven sobre cualquier fondo (sin `tile`). No son renders 3D. Se regenera con
 * `npm run assets:build && npm run mascot:vector`.
 */
export const VECTOR_MASCOTS = inventory.assets;
export type VectorMascotId = (typeof inventory.assets)[number]['id'];

const SIZES: Record<MascotSize, string> = { xs: '[--mh:4.4rem]', sm: '[--mh:8rem]', md: '[--mh:12rem]', lg: '[--mh:20rem]', xl: '[--mh:30rem]' };
const MOTION: Record<MascotMotion, string> = { none: '', bob: 'ss-mascot-bob', pop: 'ss-mascot-pop', wiggle: 'ss-mascot-wiggle ss-hover-wiggle' };

/** Pose o expresión vectorial. Decorativa por defecto (`alt` vacío y `aria-hidden`). */
export function MascotVector({ id, size = 'md', motion = 'none', alt, className = '' }: { id: VectorMascotId; size?: MascotSize; motion?: MascotMotion; alt?: string; className?: string }) {
  const a = VECTOR_MASCOTS.find((x) => x.id === id);
  if (!a) return null;
  return (
    <span className={`ss-mascot inline-block h-[var(--mh)] shrink-0 ${SIZES[size]} ${MOTION[motion]} ${className}`} style={{ aspectRatio: `${a.width} / ${a.height}` }} data-mascot-vector={id}>
      <Image src={`/assets/mascot-vector/${a.file}`} alt={alt ?? ''} aria-hidden={alt ? undefined : true} width={a.width} height={a.height} unoptimized className="size-full object-contain" draggable={false} />
    </span>
  );
}
