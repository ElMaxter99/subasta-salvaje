/**
 * Taxonomía de la biblioteca de medios (módulo sin dependencias de servidor: lo usan también los componentes cliente).
 *
 * Modelo de etiquetado de cada imagen:
 *  - `roles`: para qué sirve en una partida. Es un CONJUNTO (una imagen puede servir para varias cosas; vacío = sin rol, no se ofrece a los anfitriones).
 *      · `start`   → foto de inicio de partida (la imagen base / escena inicial de los jugadores).
 *      · `product` → producto de catálogo (la foto de un elemento que se subasta).
 *    Añadir un rol nuevo = ampliar `LIBRARY_ROLES` aquí y el `check` de la tabla en una migración nueva.
 *  - `category`: temática (Halloween, Paisajes…) para buscar y medir la cobertura. Texto libre con sugerencias (`LIBRARY_CATEGORIES`).
 *  - `tags`: etiquetas libres de búsqueda (ya existían).
 *  - `collection`: carpeta física en el repositorio de fotos (ya existía); no es lo mismo que la categoría.
 */
export const LIBRARY_ROLES = [
  { id: 'start', label: 'Foto de inicio de partida', short: 'Inicio', hint: 'La imagen o escena con la que empiezan los jugadores' },
  { id: 'product', label: 'Producto de catálogo', short: 'Producto', hint: 'La foto de un elemento que se subasta' },
] as const;

export type LibraryRole = (typeof LIBRARY_ROLES)[number]['id'];
export const LIBRARY_ROLE_IDS: readonly LibraryRole[] = LIBRARY_ROLES.map((r) => r.id);
export const roleLabel = (id: string): string => LIBRARY_ROLES.find((r) => r.id === id)?.short ?? id;

export const isLibraryRole = (v: unknown): v is LibraryRole => typeof v === 'string' && (LIBRARY_ROLE_IDS as readonly string[]).includes(v);

/** Filtra, normaliza y ordena una lista de roles (descarta lo desconocido y los repetidos). Acepta «start|product», «start;product» o «start, product». */
export function parseRoles(input: unknown): LibraryRole[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[|;,\s]+/) : [];
  const set = new Set<LibraryRole>();
  for (const x of list) {
    const v = String(x).trim().toLowerCase();
    if (isLibraryRole(v)) set.add(v);
  }
  return LIBRARY_ROLE_IDS.filter((r) => set.has(r));
}

/** Rol por defecto según el tipo de imagen al subirla: una escena (1536×1024) es una foto de inicio; un objeto (768 px) un producto. */
export const defaultRolesForKind = (kind: 'item' | 'scene'): LibraryRole[] => (kind === 'scene' ? ['start'] : ['product']);

/**
 * Categorías sugeridas con el OBJETIVO de volumen por rol (primera tanda, ver docs/PLAN-RELLENAR-BIBLIOTECA.md).
 * Los objetivos son orientativos y se editan aquí; el panel de cobertura los compara con lo publicado.
 */
export interface CategoryTarget { name: string; start: number; product: number }
export const LIBRARY_CATEGORIES: readonly CategoryTarget[] = [
  { name: 'Paisajes', start: 60, product: 0 },
  { name: 'Playa y verano', start: 20, product: 30 },
  { name: 'Halloween', start: 15, product: 40 },
  { name: 'Navidad', start: 15, product: 40 },
  { name: 'Objetos del hogar', start: 0, product: 40 },
  { name: 'Comida y bebida', start: 0, product: 40 },
  { name: 'Frutas y verduras', start: 0, product: 30 },
  { name: 'Dulces y chocolates', start: 0, product: 40 },
  { name: 'Animales', start: 0, product: 40 },
  { name: 'Mascotas disfrazadas', start: 0, product: 30 },
  { name: 'Deportes', start: 0, product: 40 },
  { name: 'Instrumentos musicales', start: 0, product: 40 },
  { name: 'Transportes', start: 0, product: 40 },
  { name: 'Disfraces y sombreros', start: 0, product: 40 },
  { name: 'Herramientas', start: 0, product: 40 },
  { name: 'Juguetes', start: 0, product: 40 },
  { name: 'Plantas y flores', start: 0, product: 40 },
];

/** Normaliza una categoría o etiqueta para comparar (minúsculas, sin acentos ni espacios repetidos). */
export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Distancia de Hamming entre dos huellas perceptuales de 16 caracteres hexadecimales (0 = idénticas; ≤ 6 = muy parecidas). */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Umbral por debajo del cual dos imágenes se consideran «posibles parecidas» (de 64 bits). */
export const NEAR_DUPLICATE_DISTANCE = 6;
