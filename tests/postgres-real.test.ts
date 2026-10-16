/**
 * Pruebas contra un PostgreSQL REAL (varias conexiones simultáneas) y contra la migración de seguridad
 * de Supabase con roles simulados (anon / authenticated / service_role).
 *
 * Se omiten salvo que definas PG_TEST_URL (conexión con permisos de superusuario), p. ej.:
 *   PG_TEST_URL=postgres://postgres@localhost:5432/postgres npx vitest run tests/postgres-real.test.ts
 * Crean y borran una base de datos temporal propia: no tocan la que indiques.
 */
import { readFileSync, readdirSync } from 'node:fs';
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
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
      grant usage on schema public to anon, authenticated;`);
    // Todas las migraciones, en orden de nombre (las `_security_` incluidas, como hace `supabase db push`).
    for (const f of readdirSync(path.join(process.cwd(), 'supabase', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(mig(f));
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
    const { room_code } = await createGame(ctx, host, { name: 'PG', integer_bids: false, players: Array.from({ length: n }, (_, i) => ({ name: `J${i + 1}` })) });
    await performAction(ctx, room_code, host, { type: 'image.set_initial_all', catalog_id: 'house' }); // imagen inicial obligatoria
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
      expect(runs.reduce((n, r) => n + r.succeeded, 0)).toBeGreaterThanOrEqual(12); // (puede incluir trabajos pendientes de otras pruebas de la misma BD)
      for (const g of games) {
        const s = await getHostState(ctx, g.room, g.host);
        expect(s.jobs.every((j) => j.status === 'completed')).toBe(true);
        expect(s.versions.filter((v) => v.origin === 'edit')).toHaveLength(2);
        expect(s.players.reduce((n, p) => n + p.balance_cents, 0)).toBe(2 * 2000 - 400);
      }
    });
  });
  describe('funciones nuevas (eventos, deshacer, base compartida, superadmin)', () => {
    it('superadmin: resumen con el esquema storage, ajustes, acceso y borrado de usuario en Postgres real', async () => {
      await pool.query("insert into storage.objects (bucket_id, name, metadata) values ('game-images', 'games/x/a.png', '{\"size\": 1234}'), ('game-images', 'games/x/b.png', '{\"size\": 100}')");
      const o = await ctx.db.rpc<{ db_bytes: number; storage: { bucket_bytes: number; bucket_objects: number }; ai: { per_day: unknown[] } }>('ss_admin_overview', {});
      expect(Number(o.db_bytes)).toBeGreaterThan(0);
      expect(Number(o.storage.bucket_bytes)).toBe(1334);
      expect(Number(o.storage.bucket_objects)).toBe(2);
      expect(o.ai.per_day).toHaveLength(14);
      const uid = randomUUID();
      expect((await ctx.db.rpc<{ allowed: boolean }>('ss_host_access', { user_id: uid, email: 'pg@x.es' })).allowed).toBe(true);
      await ctx.db.rpc('ss_settings_set', { key: 'signups_open', value: false, actor: 'root' });
      expect(await ctx.db.rpc('ss_host_access', { user_id: randomUUID(), email: 'otro@x.es' })).toMatchObject({ allowed: false, reason: 'closed' });
      await ctx.db.rpc('ss_settings_set', { key: 'signups_open', value: true, actor: 'root' });
      const r = await ctx.db.rpc<{ game_ids: string[] }>('ss_admin_delete_user', { user_id: uid, actor: 'root' });
      expect(r.game_ids).toEqual([]);
      const users = await ctx.db.rpc<{ users: { user_id: string }[] }>('ss_admin_users', {});
      expect(users.users.some((u) => u.user_id === uid)).toBe(false);
    });

    it('galería, deshacer adjudicación y evento doble o mitad funcionan con concurrencia real', async () => {
      const host = randomUUID();
      const { room_code } = await createGame(ctx, host, { name: 'PG nuevas', play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }] });
      let s = await getHostState(ctx, room_code, host);
      await performAction(ctx, room_code, host, { type: 'image.set_initial_all', catalog_id: 'house' });
      await performAction(ctx, room_code, host, { type: 'game.start' });
      const item = s.items[0]!;
      const a = await performAction(ctx, room_code, host, { type: 'auction.announce', item_id: item.id, wild_event: 'double' });
      const ana = s.players[0]!;
      await performAction(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana.id, amount_cents: 400, idempotency_key: randomUUID() });
      const award = { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana.id, expected_price_cents: 400 };
      await Promise.all([performAction(ctx, room_code, host, { ...award, idempotency_key: randomUUID() }), performAction(ctx, room_code, host, { ...award, idempotency_key: randomUUID() })]);
      s = await getHostState(ctx, room_code, host);
      const charged = s.players.find((p) => p.id === ana.id)!.purchases[0]!.price_cents;
      expect([200, 800]).toContain(charged);
      expect(s.stats.purchases_count).toBe(1);
      const pid = s.players.find((p) => p.id === ana.id)!.purchases[0]!.purchase_id;
      const key = randomUUID();
      await Promise.all([1, 2].map(() => performAction(ctx, room_code, host, { type: 'auction.undo_award', purchase_id: pid, idempotency_key: key })));
      s = await getHostState(ctx, room_code, host);
      expect(s.players.find((p) => p.id === ana.id)!.balance_cents).toBe(2000); // devuelto una sola vez
      await performAction(ctx, room_code, host, { type: 'game.finish' });
      await performAction(ctx, room_code, host, { type: 'gallery.close' });
      expect((await getHostState(ctx, room_code, host)).gallery?.closed).toBe(true);
    });

    it('imagen base compartida: un solo trabajo y el mismo archivo para todos', async () => {
      const host = randomUUID();
      const { room_code } = await createGame(ctx, host, { name: 'PG base', players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] });
      await performAction(ctx, room_code, host, { type: 'image.generate_initial_all', scope_current: true, scope_new: true });
      await performAction(ctx, room_code, host, { type: 'image.generate_initial_all', scope_current: true, scope_new: true });
      const gid = (await getHostState(ctx, room_code, host)).game.id;
      expect((await processImageJobs(ctx, { gameId: gid })).succeeded).toBe(1);
      const s = await getHostState(ctx, room_code, host);
      expect(new Set(s.players.map((p) => p.current_image!.storage_path)).size).toBe(1);
    });
  });
});
