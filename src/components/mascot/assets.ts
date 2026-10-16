import inventory from '../../../public/assets/mascot/inventory.json';

/**
 * Recursos de la mascota recortados de la lámina de referencia (`public/assets/mascot/`, ver `docs/MASCOTA.md`).
 * Las dimensiones salen de `inventory.json`, que genera `npm run mascot:extract`.
 *  · `difuminado`: conservan el fondo azul oscuro de la lámina con los bordes a transparente (úsalos con `tile`).
 *  · `real`: fondo quitado de verdad (corona, martillo, megáfono, temporizador, logo, moneda, brillo).
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

export const MASCOT_ASSETS: Record<MascotId, MascotAsset> = Object.fromEntries(
  inventory.assets.map((a) => [a.id, { id: a.id as MascotId, group: a.group as MascotGroup, src: `${BASE}/${a.file}`, width: a.width, height: a.height, transparency: a.transparency as MascotAsset['transparency'] }]),
) as Record<MascotId, MascotAsset>;

/** Color medio del fondo de la lámina en los bordes de los recortes `difuminado` (para que el recuadro se funda). */
export const MASCOT_BG = '#0a0f2e';
