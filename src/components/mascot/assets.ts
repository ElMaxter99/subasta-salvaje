import inventory from '../../../public/assets/mascot/inventory.json';
import brand from '../../../public/assets/brand/inventory.json';

/**
 * Mascota oficial (`public/assets/brand/`, ver `docs/MARCA.md`): UN solo personaje (casco blanco con visor, corona y martillo)
 * recortado del logo con transparencia real. Los ids antiguos (`expr-*`, `pose-*`, `mascot-main`) se conservan para no tocar
 * cada pantalla, pero todos resuelven al mismo dibujo: el «gesto» lo da el componente con movimiento y color (`mood`), no una
 * imagen distinta. Los objetos (`item-*`: corona, martillo, megáfono…) siguen siendo recortes de `public/assets/mascot/`.
 */
export const MASCOT_IDS = [
  'mascot-main',
  'expr-feliz', 'expr-sorprendido', 'expr-guino', 'expr-pensativo', 'expr-triste', 'expr-enfadado', 'expr-celebrando', 'expr-hype',
  'pose-presenta', 'pose-anuncia', 'pose-cuenta-atras', 'pose-adjudica', 'pose-celebra',
  'item-corona', 'item-martillo', 'item-megafono', 'item-temporizador', 'item-logo', 'item-bocadillo', 'item-moneda', 'item-brillo',
] as const;
export type MascotId = (typeof MASCOT_IDS)[number];
export type MascotGroup = 'mascot' | 'expression' | 'pose' | 'item';

export interface MascotAsset {
  id: MascotId;
  group: MascotGroup;
  src: string;
  width: number;
  height: number;
  transparency: 'real' | 'difuminado';
}

const BASE = '/assets/mascot';
const BRAND = '/assets/brand';

const items = Object.fromEntries(
  inventory.assets.map((a) => [a.id, { id: a.id as MascotId, group: a.group as MascotGroup, src: `${BASE}/${a.file}`, width: a.width, height: a.height, transparency: a.transparency as MascotAsset['transparency'] }]),
) as Partial<Record<MascotId, MascotAsset>>;

/** La mascota completa (busto con martillo) y su cabeza (para tamaños pequeños). */
export const MASCOT_FULL = { src: `${BRAND}/mascot.webp`, width: brand.assets.mascot.width, height: brand.assets.mascot.height };
export const MASCOT_HEAD = { src: `${BRAND}/head.webp`, width: brand.assets.head.width, height: brand.assets.head.height };

export const MASCOT_ASSETS = Object.fromEntries(
  MASCOT_IDS.map((id) => [
    id,
    items[id] ?? { id, group: id === 'mascot-main' ? 'mascot' : id.startsWith('expr-') ? 'expression' : 'pose', ...MASCOT_FULL, transparency: 'real' },
  ]),
) as Record<MascotId, MascotAsset>;

/** Gesto de cada id antiguo: se expresa con movimiento/color en CSS (ver `.ss-mood-*` en globals.css). */
export type MascotMood = 'happy' | 'cheer' | 'wow' | 'sad' | 'angry' | 'think' | 'wink';
export const MASCOT_MOOD: Partial<Record<MascotId, MascotMood>> = {
  'expr-feliz': 'happy', 'mascot-main': 'happy', 'pose-presenta': 'happy', 'pose-anuncia': 'wow',
  'expr-sorprendido': 'wow', 'expr-hype': 'cheer', 'expr-celebrando': 'cheer', 'pose-celebra': 'cheer', 'pose-adjudica': 'cheer',
  'expr-triste': 'sad', 'expr-enfadado': 'angry', 'expr-pensativo': 'think', 'expr-guino': 'wink', 'pose-cuenta-atras': 'wow',
};
