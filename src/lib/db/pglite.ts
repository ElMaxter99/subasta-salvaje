import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { toDomainError } from '@/lib/domain/errors';
import { assertFnName, type Db } from './types';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

/** Migraciones portables (se omiten las específicas de Supabase: RLS/Storage). */
export function portableMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('_security'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
}

export interface PgliteDb extends Db {
  pg: PGlite;
  close(): Promise<void>;
}

/** Ejecuta las MISMAS funciones SQL que producción sobre Postgres WASM (modo demo y tests). */
export async function createPgliteDb(dataDir?: string): Promise<PgliteDb> {
  if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  const applied = await pg.query<{ exists: boolean }>("select to_regclass('public.games') is not null as exists");
  if (!applied.rows[0]?.exists) {
    for (const m of portableMigrations()) await pg.exec(m.sql);
  }
  return {
    pg,
    async rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
      assertFnName(fn);
      try {
        const res = await pg.query<{ r: T }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(params)]);
        return res.rows[0]?.r as T;
      } catch (err) {
        throw toDomainError(err);
      }
    },
    close: () => pg.close(),
  };
}
