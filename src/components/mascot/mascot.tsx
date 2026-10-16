import Image from 'next/image';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { MASCOT_ASSETS, MASCOT_HEAD, MASCOT_MOOD, type MascotId } from './assets';

/** Altura del recurso (rem). Se puede sustituir con clases responsive, p. ej. `className="[--mh:12rem] md:[--mh:22rem]"`. */
const SIZES = {
  xs: '[--mh:4.4rem]',
  sm: '[--mh:8rem]',
  md: '[--mh:12rem]',
  lg: '[--mh:20rem]',
  xl: '[--mh:30rem]',
} as const;
export type MascotSize = keyof typeof SIZES;
export type MascotMotion = 'none' | 'bob' | 'pop' | 'wiggle';

/**
 * Mascota oficial de la marca (un solo personaje, transparencia real). Decorativa por defecto (`alt` vacío y `aria-hidden`).
 *  · En `xs` y `sm` se usa solo la cabeza (el busto con martillo no se lee a menos de 8 rem de alto).
 *  · El gesto (`variant`: expr-triste, pose-adjudica…) se expresa con movimiento y color, no con otra imagen.
 *  · `tile` (heredado) ya no pinta fondo: el dibujo es transparente.
 *  · `motion`: `bob`, `pop` o `wiggle`. Con `prefers-reduced-motion` no se anima.
 */
export function Mascot({ variant, size = 'md', motion = 'none', alt, className = '', priority }: { variant: MascotId; size?: MascotSize; tile?: boolean; motion?: MascotMotion; alt?: string; className?: string; priority?: boolean }) {
  const a = MASCOT_ASSETS[variant];
  const isItem = variant.startsWith('item-');
  const art = !isItem && (size === 'xs' || size === 'sm') ? { ...a, ...MASCOT_HEAD } : a;
  const mood = isItem ? undefined : MASCOT_MOOD[variant];
  const style = { aspectRatio: `${art.width} / ${art.height}` } as CSSProperties;
  return (
    <span
      className={`ss-mascot inline-block h-[var(--mh)] max-w-full shrink-0 ${SIZES[size]} ${mood ? `ss-mood-${mood}` : ''} ${motion === 'bob' ? 'ss-mascot-bob' : motion === 'pop' ? 'ss-mascot-pop' : motion === 'wiggle' ? 'ss-mascot-wiggle ss-hover-wiggle' : ''} ${className}`}
      style={style}
      data-mascot={variant}
    >
      <Image src={art.src} alt={alt ?? ''} aria-hidden={alt ? undefined : true} width={art.width} height={art.height} unoptimized priority={priority} className={`size-full object-contain ${art === a && !isItem ? 'ss-bust-fade' : ''}`} draggable={false} />
    </span>
  );
}

/** Estado vacío / de error con la mascota. */
export function EmptyState({ variant, title, children, size = 'md', className = '', action }: { variant: MascotId; title: string; children?: ReactNode; size?: MascotSize; className?: string; action?: ReactNode }) {
  return (
    <div className={`flex flex-col items-center gap-4 text-center ${className}`}>
      <Mascot variant={variant} size={size} motion="pop" />
      <h2 className="font-display text-2xl">{title}</h2>
      {children ? <div className="max-w-md text-white/70">{children}</div> : null}
      {action}
    </div>
  );
}

/**
 * Título de página con la mascota al lado (entra con un «pop» y se mueve al pasar el ratón).
 * `as` es el nivel del encabezado; `say` añade un bocadillo CSS con una frase corta.
 */
export function MascotTitle({ variant, children, as: Tag = 'h1', size = 'sm', subtitle, say, className = '', titleClassName = 'font-display text-2xl leading-tight', motion = 'wiggle' }: { variant: MascotId; children: ReactNode; as?: ElementType; size?: MascotSize; subtitle?: ReactNode; say?: string; className?: string; titleClassName?: string; motion?: MascotMotion }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <Mascot variant={variant} size={size} motion={motion} />
      <div className="relative min-w-0">
        {say ? <Bubble>{say}</Bubble> : null}
        <Tag className={`animate-float-in ${titleClassName}`}>{children}</Tag>
        {subtitle ? <p className="mt-1 text-sm text-white/65">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/** Bocadillo de la mascota (CSS puro, sin imagen): corto y decorativo. */
export function Bubble({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`ss-bubble-in mb-1.5 inline-block rounded-2xl rounded-bl-sm border border-gold/40 bg-night-800 px-3 py-1 text-xs font-bold text-gold ${className}`} aria-hidden>
      {children}
    </span>
  );
}

/**
 * Icono de objeto de la mascota con transparencia real (corona, martillo, megáfono, temporizador, logo, moneda, brillo).
 * Tamaño en `em`: hereda el del texto, así que sirve para poner un icono dentro de un título.
 */
export function ItemIcon({ variant, className = '', motion = 'none', style }: { variant: Extract<MascotId, `item-${string}`>; className?: string; motion?: 'none' | 'bob' | 'twinkle' | 'spin' | 'drop'; style?: CSSProperties }) {
  const a = MASCOT_ASSETS[variant];
  const m = motion === 'bob' ? 'ss-mascot-bob' : motion === 'twinkle' ? 'ss-twinkle' : motion === 'spin' ? 'ss-coin-spin' : motion === 'drop' ? 'ss-crown-drop' : '';
  return (
    <Image
      src={a.src}
      alt=""
      aria-hidden
      width={a.width}
      height={a.height}
      unoptimized
      draggable={false}
      data-mascot={variant}
      className={`inline-block h-[1.15em] w-auto shrink-0 align-[-0.2em] ${m} ${className}`}
      style={style}
    />
  );
}

/** Destellos decorativos que parpadean alrededor de un elemento (posiciones fijas, sin aleatoriedad en el render). */
export function Sparkles({ className = '' }: { className?: string }) {
  const spots = [
    { l: '4%', t: '12%', s: '1.6rem', d: '0s' },
    { l: '90%', t: '22%', s: '1.2rem', d: '0.9s' },
    { l: '8%', t: '70%', s: '1.1rem', d: '1.7s' },
    { l: '88%', t: '78%', s: '1.5rem', d: '0.4s' },
  ];
  return (
    <span className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden>
      {spots.map((p, i) => (
        <ItemIcon key={i} variant="item-brillo" motion="twinkle" className="absolute !h-auto" style={{ left: p.l, top: p.t, width: p.s, animationDelay: p.d }} />
      ))}
    </span>
  );
}
