/**
 * Pruebas contra un PostgreSQL REAL (varias conexiones simultáneas) y contra la migración de seguridad
 * de Supabase con roles simulados (anon / authenticated / service_role).
 *
 * Se omiten salvo que definas PG_TEST_URL (conexión con permisos de superusuario), p. ej.:
 *   PG_TEST_URL=postgres://postgres@localhost:5432/postgres npx vitest run tests/postgres-real.test.ts
 * Crean y borran una base de datos temporal propia: no tocan la que indiques.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoProvider } from '@/lib/ai/demo';
import type { Db } from '@/lib/db/types';
import { toDomainError } from '@/lib/domain/errors';
import { createGame, getHostState, performAction } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { createMemoryStorage } from '@/lib/storage/local';

const URL_ = process.env.PG_TEST_URL;
const mig = (f: string) => readFileSync(path.join(process.cwd(), 'supabase', 'migrations', f), 'utf8');

describe.skipIf(!URL_)('PostgreSQL real', () => {
  const dbName = `ss_test_${randomUUID().slice(0, 8)}`;
  let admin: pg.Client;
  let pool: pg.Pool;
  let ctx: { db: Db; storage: ReturnType<typeof createMemoryStorage>; publisher: { publish(): Promise<void> }; provider: ReturnType<typeof createDemoProvider> };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_ });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(URL_!);
    u.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: u.toString(), max: 16 });
    pool.on('error', () => {}); // conexiones cerradas al borrar la BD temporal
    // Simula lo que Supabase ya trae: roles y esquemas auth/storage.
    await pool.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create schema auth; create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      grant usage on schema public to anon, authenticated;`);
    await pool.query(mig('20260101000000_core.sql'));
    await pool.query(mig('20260101000200_initial_all.sql'));
    await pool.query(mig('20260101000100_security.sql'));
    await pool.query(mig('20260101000300_security_initial_all.sql'));
    await pool.query(mig('20260101000400_mobile_players.sql'));
    await pool.query(mig('20260101000500_security_mobile_players.sql'));
    await pool.query(mig('20260101000600_mobile_hardening.sql'));
    await pool.query(mig('20260101000700_security_mobile_hardening.sql'));
    await pool.query(mig('20260101000800_join_policy_quota.sql'));
    await pool.query(mig('20260101000900_security_join_policy_quota.sql'));
    await pool.query(mig('20260101001000_auto_award.sql'));
    await pool.query(mig('20260101001100_security_auto_award.sql'));
    await pool.query(mig('20260101001200_image_mode.sql'));
    await pool.query(mig('20260101001300_security_image_mode.sql'));
    await pool.query(mig('20260101001400_delete_games.sql'));
    await pool.query(mig('20260101001500_security_delete_games.sql'));
    const db: Db = {
      async rpc<T>(fn: string, params: Record<string, unknown>) {
        try {
          const r = await pool.query(`select ${fn}($1::jsonb) as r`, [JSON.stringify(params)]);
          return r.rows[0].r as T;
        } catch (e) {
          throw toDomainError(e);
        }
      },
    };
    ctx = { db, storage: createMemoryStorage(), publisher: { async publish() {} }, provider: createDemoProvider() };
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  async function game(host: string, n = 4) {
    const { room_code } = await createGame(ctx, host, { name: 'PG', players: Array.from({ length: n }, (_, i) => ({ name: `J${i + 1}` })) });
    await performAction(ctx, room_code, host, { type: 'game.start' });
    return { room: room_code, snap: await getHostState(ctx, room_code, host) };
  }

  describe('migración de seguridad con roles reales', () => {
    const asRole = async (role: string, sql: string) => {
      const c = await pool.connect();
      try {
        await c.query(`set role ${role}`);
        return await c.query(sql);
      } finally {
        await c.query('reset role').catch(() => {});
        c.release();
      }
    };

    it('anon y authenticated no pueden leer tablas ni ejecutar funciones ss_*', async () => {
      for (const role of ['anon', 'authenticated']) {
        await expect(asRole(role, 'select * from games')).rejects.toThrow(/permission denied/);
        await expect(asRole(role, 'select * from players')).rejects.toThrow(/permission denied/);
        await expect(asRole(role, `select ss_get_state('{"room_code":"AAAAAA"}')`)).rejects.toThrow(/permission denied/);
        await expect(asRole(role, `select ss_list_games('{}')`)).rejects.toThrow(/permission denied/);
        await expect(asRole(role, `insert into games (room_code, host_id, name) values ('ZZZZZZ', gen_random_uuid(), 'x')`)).rejects.toThrow(/permission denied/);
      }
    });

    it('service_role sí puede ejecutar las funciones', async () => {
      const r = await asRole('service_role', `select ss_list_games('{"host_id":"${randomUUID()}"}') as r`);
      expect(r.rows[0].r).toEqual([]);
    });

    it('las funciones creadas DESPUÉS tampoco quedan abiertas a anon (privilegios por defecto)', async () => {
      await pool.query('create function ss_futura() returns int language sql as $$ select 1 $$');
      const r = await pool.query(`select has_function_privilege('anon', 'ss_futura()', 'execute') as a, has_function_privilege('authenticated', 'ss_futura()', 'execute') as b`);
      expect(r.rows[0]).toEqual({ a: false, b: false });
      await pool.query('drop function ss_futura()');
    });

    it('NINGUNA función del esquema public es ejecutable por anon/authenticated y todas lo son por service_role', async () => {
      const r = await pool.query(`
        select p.oid::regprocedure::text as sig,
               has_function_privilege('anon', p.oid, 'execute') as anon,
               has_function_privilege('authenticated', p.oid, 'execute') as auth,
               has_function_privilege('service_role', p.oid, 'execute') as svc
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'ss\\_%'`);
      expect(r.rows.length).toBeGreaterThan(30);
      expect(r.rows.filter((x) => x.anon || x.auth)).toEqual([]);
      expect(r.rows.filter((x) => !x.svc)).toEqual([]);
    });

    it('el bucket de imágenes es público de lectura con límites de tamaño y tipo', async () => {
      const r = await pool.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'game-images'`);
      expect(r.rows[0]).toMatchObject({ public: true, file_size_limit: '10485760' });
      expect(r.rows[0].allowed_mime_types).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
    });
  });

  describe('concurrencia entre conexiones', () => {
    it('16 adjudicaciones simultáneas con claves distintas: una compra, un cobro', async () => {
      const host = randomUUID();
      const { room, snap } = await game(host);
      const a = await performAction(ctx, room, host, { type: 'auction.announce', item_id: snap.items[0]!.id });
      const auctionId = a.snapshot.auction!.id;
      const p = snap.players[0]!.id;
      await performAction(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: p, amount_cents: 700, idempotency_key: randomUUID() });
      const results = await Promise.allSettled(
        Array.from({ length: 16 }, () => performAction(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: p, expected_price_cents: 700, idempotency_key: randomUUID() })),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const after = await getHostState(ctx, room, host);
      expect(after.players[0]!.balance_cents).toBe(1300);
      expect(after.stats.purchases_count).toBe(1);
      expect(after.jobs.filter((j) => j.kind === 'edit')).toHaveLength(1);
    });

    it('pujas simultáneas de varios jugadores: el estado final es coherente (puja máxima = última válida)', async () => {
      const host = randomUUID();
      const { room, snap } = await game(host);
      const a = await performAction(ctx, room, host, { type: 'auction.announce', item_id: snap.items[0]!.id });
      const auctionId = a.snapshot.auction!.id;
      const amounts = [200, 300, 400, 500, 600, 700, 800, 900];
      await Promise.allSettled(
        amounts.map((amount, i) => performAction(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: snap.players[i % 4]!.id, amount_cents: amount, idempotency_key: randomUUID() })),
      );
      const s = await getHostState(ctx, room, host);
      const bids = s.auction!.bids;
      expect(s.auction!.current_bid_cents).toBe(Math.max(...bids.map((b) => b.amount_cents)));
      expect(s.auction!.current_bid_cents).toBe(900);
      // Las pujas aceptadas son estrictamente crecientes en el orden real de inserción (created_at)
      const asc = [...bids].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((b) => b.amount_cents);
      expect(asc).toEqual([...asc].sort((x, y) => x - y));
      expect(bids.map((b) => b.amount_cents)).toEqual([...bids.map((b) => b.amount_cents)].sort((x, y) => y - x));
    });

    it('el mismo reintento de puja en paralelo (misma clave) se registra una sola vez', async () => {
      const host = randomUUID();
      const { room, snap } = await game(host);
      const a = await performAction(ctx, room, host, { type: 'auction.announce', item_id: snap.items[0]!.id });
      const k = randomUUID();
      await Promise.all(Array.from({ length: 10 }, () => performAction(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: snap.players[0]!.id, amount_cents: 300, idempotency_key: k })));
      expect((await getHostState(ctx, room, host)).auction!.bids).toHaveLength(1);
    });

    it('varios workers en paralelo sobre muchas partidas: cada trabajo se procesa una vez y no hay deadlocks', async () => {
      const games = await Promise.all(
        Array.from({ length: 6 }, async () => {
          const host = randomUUID();
          const { room, snap } = await game(host, 2);
          // imágenes iniciales ya generadas por el flujo normal antes de comprar
          for (const pl of snap.players) await performAction(ctx, room, host, { type: 'image.request_initial', player_id: pl.id }).catch(() => null);
          return { host, room, snap };
        }),
      );
      // Las partidas ya empezaron; las iniciales fallan con game_already_started, así que sembramos una base a mano.
      for (const g of games) {
        for (const pl of g.snap.players) {
          const v = await pool.query(`insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, is_approved)
            select game_id, id, 'games/base-' || id || '.svg', 'initial', 'demo', 'image/svg+xml', true from players where id = $1 returning id, storage_path`, [pl.id]);
          await pool.query('update players set current_image_version_id = $1, initial_image_version_id = $1 where id = $2', [v.rows[0].id, pl.id]);
          await ctx.storage.put(v.rows[0].storage_path, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><g id="stickers"></g></svg>'), 'image/svg+xml');
        }
        for (let i = 0; i < 2; i++) {
          const s = await getHostState(ctx, g.room, g.host);
          const item = s.items.find((x) => x.status === 'available')!;
          const a = await performAction(ctx, g.room, g.host, { type: 'auction.announce', item_id: item.id });
          const player = s.players[i % 2]!;
          await performAction(ctx, g.room, g.host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: player.id, amount_cents: 200, idempotency_key: randomUUID() });
          await performAction(ctx, g.room, g.host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: player.id, expected_price_cents: 200, idempotency_key: randomUUID() });
        }
      }
      const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => processImageJobs(ctx, { workerId: `pg-w${i}`, maxJobs: 20 })));
      expect(runs.reduce((n, r) => n + r.succeeded, 0)).toBe(12);
      for (const g of games) {
        const s = await getHostState(ctx, g.room, g.host);
        expect(s.jobs.every((j) => j.status === 'completed')).toBe(true);
        expect(s.versions.filter((v) => v.origin === 'edit')).toHaveLength(2);
        expect(s.players.reduce((n, p) => n + p.balance_cents, 0)).toBe(2 * 2000 - 400);
      }
    });
  });
});
