/**
 * Mini héroe: versión vectorial MUY reducida del personaje de la marca (casco blanco, visor oscuro, ojos dorados y corona).
 * Una sola fuente de verdad: la usa el componente `MiniHero`, el favicon y las variantes SVG de `public/assets/brand/`
 * (se regeneran con `npm run brand:mini`). No es un recorte del logo: es un dibujo propio, simplificado para 16–64 px.
 */
export type MiniMood = 'happy' | 'sad' | 'wow' | 'wink' | 'cheer' | 'angry';
export const MINI_MOODS: readonly MiniMood[] = ['happy', 'sad', 'wow', 'wink', 'cheer', 'angry'];

const C = { night: '#0a1022', hood: '#1b2750', helmet: '#f4f1ff', rim: '#cfc8f5', visor: '#10163a', gold: '#fbbf24', goldDark: '#c98a00', goldSoft: '#fde68a', tear: '#7dd3fc' };

const arc = (cx: number, up: boolean) => `<path d="M${cx - 5} ${up ? 38 : 34}Q${cx} ${up ? 31 : 41} ${cx + 5} ${up ? 38 : 34}" fill="none" stroke="${C.gold}" stroke-width="3.2" stroke-linecap="round"/>`;
const dot = (cx: number) => `<circle cx="${cx}" cy="36" r="4" fill="${C.gold}"/>`;
const star = (x: number, y: number, r: number) => `<path d="M${x} ${y - r}L${x + r * 0.3} ${y - r * 0.3}L${x + r} ${y}L${x + r * 0.3} ${y + r * 0.3}L${x} ${y + r}L${x - r * 0.3} ${y + r * 0.3}L${x - r} ${y}L${x - r * 0.3} ${y - r * 0.3}Z" fill="${C.goldSoft}"/>`;

function face(mood: MiniMood): string {
  switch (mood) {
    case 'sad':
      return `${arc(25, false)}${arc(39, false)}<circle cx="44.5" cy="42.5" r="1.8" fill="${C.tear}"/>`;
    case 'wow':
      return `${dot(25)}${dot(39)}<ellipse cx="32" cy="44.5" rx="2.2" ry="2.8" fill="none" stroke="${C.gold}" stroke-width="2"/>`;
    case 'wink':
      return `${arc(25, true)}<path d="M34 36H44" stroke="${C.gold}" stroke-width="3.2" stroke-linecap="round"/>`;
    case 'angry':
      return `<path d="M20 33L30 37.5M44 33L34 37.5" stroke="${C.gold}" stroke-width="3.6" stroke-linecap="round"/>`;
    case 'cheer':
      return `${arc(25, true)}${arc(39, true)}`;
    default:
      return `${arc(25, true)}${arc(39, true)}`;
  }
}

export interface MiniHeroOptions {
  /** Hombros con sudadera (solo se ve bien a partir de ~32 px). */
  body?: boolean;
  /** Fondo redondeado azul marino (para favicon e iconos). */
  tile?: boolean;
}

/** Devuelve el SVG (texto) del mini héroe con el gesto indicado. viewBox 64×64, sin ids ni degradados. */
export function miniHeroSvg(mood: MiniMood = 'happy', { body = false, tile = false }: MiniHeroOptions = {}): string {
  const sparkles = mood === 'cheer' ? `${star(7, 13, 4.5)}${star(58, 17, 3.5)}${star(55, 6, 2.5)}` : '';
  const shoulders = body ? `<path d="M9 64C9 53 19 48 32 48S55 53 55 64Z" fill="${C.hood}"/><path d="M28.5 60l1.5-4 2 2.4 2-2.4 1.5 4z" fill="${C.gold}"/>` : '';
  const background = tile ? `<rect width="64" height="64" rx="14" fill="${C.night}"/>` : '';
  const tilt = mood === 'sad' ? ' transform="rotate(-4 32 40)"' : mood === 'angry' ? ' transform="rotate(3 32 40)"' : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Subasta Salvaje">${background}${sparkles}${shoulders}` +
    `<g${tilt}>` +
    `<rect x="11" y="20" width="42" height="32" rx="15" fill="${C.helmet}" stroke="${C.rim}" stroke-width="1"/>` +
    `<rect x="15" y="24" width="34" height="24" rx="10" fill="${C.visor}"/>` +
    face(mood) +
    `<path d="M16 22L20.5 10L27 17L32 7L37 17L43.5 10L48 22Z" fill="${C.gold}" stroke="${C.goldDark}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<circle cx="20.5" cy="10" r="1.7" fill="${C.goldSoft}"/><circle cx="32" cy="7" r="1.7" fill="${C.goldSoft}"/><circle cx="43.5" cy="10" r="1.7" fill="${C.goldSoft}"/>` +
    `</g></svg>`
  );
}
