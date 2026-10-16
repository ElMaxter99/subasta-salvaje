/** Acceso a datos: toda la lógica vive en funciones SQL `ss_*` invocadas por RPC. */
export interface Db {
  rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T>;
}

const FN_NAME = /^ss_[a-z_]+$/;
export function assertFnName(fn: string): void {
  if (!FN_NAME.test(fn)) throw new Error(`Nombre de función no válido: ${fn}`);
}
