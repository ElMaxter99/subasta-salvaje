/** Semilla nueva en cada llamada a un proveedor de imágenes: sin ella algunos servicios devuelven siempre el mismo resultado para la misma entrada. */
export const newSeed = (): number => Math.floor(Math.random() * 2_147_483_647);
