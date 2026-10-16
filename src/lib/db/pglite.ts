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

/** Marcadores para bases locales antiguas creadas antes de existir la tabla de seguimiento. */
const LEGACY_MARKERS: Record<string, string> = {
  '20260101000000_core.sql': "to_regclass('public.games') is not null",
  '20260101000200_initial_all.sql': "to_regprocedure('ss_set_initial_all(jsonb)') is not null",
  '20260101000400_mobile_players.sql': "exists (select 1 from information_schema.columns where table_name = 'games' and column_name = 'play_mode')",
};

/** Aplica las migraciones portables pendientes (con seguimiento) para que un .demo-data antiguo se actualice solo. */
async function migrate(pg: PGlite): Promise<void> {
  const tracked = await pg.query("select to_regclass('public.ss_migrations') is not null as ok");
  const fresh = !tracked.rows[0] || !(tracked.rows[0] as { ok: boolean }).ok;
  await pg.exec('create table if not exists ss_migrations (name text primary key, applied_at timestamptz not null default now())');
  const migrations = portableMigrations();
  if (fresh) {
    for (const m of migrations) {
      const marker = LEGACY_MARKERS[m.name];
      if (!marker) continue;
      const r = await pg.query(`select (${marker}) as ok`);
      if ((r.rows[0] as { ok: boolean }).ok) await pg.query('insert into ss_migrations (name) values ($1) on conflict do nothing', [m.name]);
    }
  }
  const done = new Set((await pg.query<{ name: string }>('select name from ss_migrations')).rows.map((r) => r.name));
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await pg.exec(m.sql);
    await pg.query('insert into ss_migrations (name) values ($1)', [m.name]);
  }
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
  await migrate(pg);
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
