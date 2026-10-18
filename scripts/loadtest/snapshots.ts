/**
 * Prueba de carga reproducible de las lecturas de estado (`ss_get_state`) y de las escrituras con la partida bloqueada
 * (`ss_player_bid`, `ss_yield_bid`) con 10 y 20 «móviles». Metodología y resultados: docs/RENDIMIENTO.md.
 *
 *   npm run loadtest                                        # PGlite (WASM, monohilo) con N = 10 y 20
 *   npm run loadtest -- --quick                             # menos repeticiones (humo, ~1 min)
 *   npm run loadtest -- --players=5,10,20 --json            # otros tamaños; --json imprime además el resultado en JSON
 *   PG_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres npm run loadtest -- --engine=pg
 *   npm run loadtest -- --engine=both                       # PGlite y Postgres real (necesita PG_TEST_URL)
 *
 * IMPORTANTE: PGlite NO representa a Postgres de Supabase (WASM, una sola conexión, sin red). Cada cifra se etiqueta con su motor.
 * Esto NO es una prueba de vitest (no se ejecuta en `npm test`). Con N > 10 (tope de producto) se relaja el tope SOLO en la
 * base temporal de la prueba, para ver cómo escala; no toca ninguna migración.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createDemoProvider } from '@/lib/ai/demo';
import { createPgliteDb } from '@/lib/db/pglite';
import type { Db } from '@/lib/db/types';
import { toDomainError } from '@/lib/domain/errors';
import { createGame, getHostState, getPublicState, performAction } from '@/lib/services/game-service';
import { joinGame, playerBid, yieldBid } from '@/lib/services/play-service';
import { createMemoryStorage } from '@/lib/storage/local';

// ---------------------------------------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const QUICK = flag('quick');
const SIZES = opt('players', '10,20').split(',').map(Number);
const ENGINE = opt('engine', 'pglite') as 'pglite' | 'pg' | 'both';
const SEQ_READS = QUICK ? 100 : 400;
const BURSTS = QUICK ? 10 : 40;
const SUSTAIN_MS = QUICK ? 4000 : 12000;
const POLL_MS = 1500; // FALLBACK_POLL_MS_DEMO de src/lib/client/use-live-game.ts (modo local); en Supabase serían 8000 ms con Realtime
const BID_ROUNDS = QUICK ? 5 : 15;
const YIELD_TRIALS = QUICK ? 2 : 5;

// ---------------------------------------------------------------------------------------------- utilidades
const now = () => performance.now();
function pct(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}
const fmt = (n: number) => (Number.isNaN(n) ? '   n/d' : n.toFixed(1).padStart(7));
function stats(xs: number[]) {
  return { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / (xs.length || 1) };
}
const row = (label: string, xs: number[]) => {
  const s = stats(xs);
  console.log(`  ${label.padEnd(46)} n=${String(s.n).padStart(5)}  p50${fmt(s.p50)}  p95${fmt(s.p95)}  p99${fmt(s.p99)}  max${fmt(s.max)} ms`);
  return s;
};
async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; ok: boolean; value?: T }> {
  const t = now();
  try {
    const value = await fn();
    return { ms: now() - t, ok: true, value };
  } catch {
    return { ms: now() - t, ok: false };
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------- motores
interface Engine {
  name: string;
  label: string;
  db: Db;
  exec(sql: string): Promise<void>;
  query<R>(sql: string): Promise<R[]>;
  close(): Promise<void>;
}

async function pgliteEngine(): Promise<Engine> {
  const db = await createPgliteDb();
  return { name: 'pglite', label: 'PGlite (WASM, monohilo, en memoria)', db, exec: async (sql) => void (await db.pg.exec(sql)), query: async <R,>(sql: string) => (await db.pg.query(sql)).rows as R[], close: () => db.close() };
}

async function pgEngine(): Promise<Engine> {
  const url = process.env.PG_TEST_URL;
  if (!url) throw new Error('Define PG_TEST_URL (p. ej. postgres://postgres:postgres@localhost:5432/postgres) para --engine=pg');
  const dbName = `ss_load_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: u.toString(), max: 16 });
  pool.on('error', () => {});
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
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(readFileSync(path.join(dir, f), 'utf8'));
  const db: Db = {
    async rpc<T>(fn: string, params: Record<string, unknown>) {
      try {
        return (await pool.query(`select ${fn}($1::jsonb) as r`, [JSON.stringify(params)])).rows[0].r as T;
      } catch (e) {
        throw toDomainError(e);
      }
    },
  };
  return {
    name: 'pg',
    label: `PostgreSQL real (${(await admin.query('show server_version')).rows[0].server_version}, ${new URL(url).hostname}, pool de 16 conexiones)`,
    db,
    exec: async (sql) => void (await pool.query(sql)),
    query: async <R,>(sql: string) => (await pool.query(sql)).rows as R[],
    close: async () => {
      await pool.end();
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    },
  };
}

// ---------------------------------------------------------------------------------------------- escenario
type Ctx = Parameters<typeof createGame>[0];
interface Scenario {
  room: string;
  host: string;
  tokens: string[];
  auction: string;
  nPlayers: number;
  lastCents: number;
  leaderIdx: number;
}

let capRelaxed = false;
async function relaxCap(e: Engine) {
  if (capRelaxed) return;
  // Solo en la BD temporal de esta prueba: permite más de 10 jugadores para estudiar la escala.
  await e.exec(`alter table games drop constraint if exists games_max_players_check;
    create or replace function ss_max_players_cap() returns int language sql immutable as $$ select 100 $$;`);
  capRelaxed = true;
}

async function buildScenario(e: Engine, ctx: Ctx, n: number, bids = 10, openAuction = true): Promise<Scenario> {
  if (n > 10) await relaxCap(e);
  const host = randomUUID();
  const { room_code: room } = await createGame(ctx, host, {
    name: `Carga ${n}`, play_mode: 'mobile', initial_budget_cents: 10_000_000, integer_bids: false,
    players: [], items: Array.from({ length: 14 }, (_, i) => ({ name: `Elemento ${i + 1}`, description: 'Un objeto de prueba para la subasta' })),
  });
  if (n > 10) await ctx.db.rpc('ss_set_game_rules', { room_code: room, host_id: host, max_players: n });
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) tokens.push((await joinGame(ctx, room, { name: `Jugador ${i + 1}` })).token);
  await performAction(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'house', scope_current: true, scope_new: false });
  await performAction(ctx, room, host, { type: 'game.start' });
  const sc: Scenario = { room, host, tokens, auction: '', nPlayers: n, lastCents: 0, leaderIdx: -1 };
  if (!openAuction) return sc;
  const s = await getHostState(ctx, room, host);
  const a = await performAction(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
  sc.auction = a.snapshot.auction!.id;
  for (let i = 0; i < bids; i++) {
    const idx = i % n;
    sc.lastCents += 100 + 37 * i;
    await playerBid(ctx, room, tokens[idx], { auction_id: sc.auction, amount_cents: sc.lastCents, idempotency_key: randomUUID() });
    sc.leaderIdx = idx;
  }
  return sc;
}

// ---------------------------------------------------------------------------------------------- mediciones
async function measureSize(ctx: Ctx, sc: Scenario) {
  const pub = await ctx.db.rpc('ss_get_state', { room_code: sc.room, view: 'public' });
  const host = await ctx.db.rpc('ss_get_state', { room_code: sc.room, view: 'host', host_id: sc.host });
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
  const out = { public: bytes(pub), host: bytes(host), publicServed: bytes(await getPublicState(ctx, sc.room)) };
  console.log(`  tamaño del snapshot con ${sc.nPlayers} jugadores, 14 elementos, subasta con 10 pujas: público ${out.public} B (servido, con URLs: ${out.publicServed} B), anfitrión ${out.host} B`);
  return out;
}

async function measureReads(ctx: Ctx, sc: Scenario) {
  const n = sc.nPlayers;
  const res: Record<string, ReturnType<typeof stats>> = {};
  const sql = () => ctx.db.rpc('ss_get_state', { room_code: sc.room, view: 'public' });
  const svc = () => getPublicState(ctx, sc.room);
  const host = () => getHostState(ctx, sc.room, sc.host);
  for (let i = 0; i < 30; i++) await svc(); // calentamiento

  const seqSql: number[] = [], seqSvc: number[] = [], seqHost: number[] = [];
  for (let i = 0; i < SEQ_READS; i++) seqSql.push((await timed(sql)).ms);
  for (let i = 0; i < SEQ_READS; i++) seqSvc.push((await timed(svc)).ms);
  for (let i = 0; i < Math.ceil(SEQ_READS / 4); i++) seqHost.push((await timed(host)).ms);
  console.log('(a) lecturas SECUENCIALES');
  res.seqSql = row('ss_get_state (RPC SQL pura, vista pública)', seqSql);
  res.seqPublic = row('getPublicState (RPC + URLs)', seqSvc);
  res.seqHost = row('getHostState (4 RPC: estado + uso + ajustes + actividad)', seqHost);

  // Ráfaga: todos los móviles + 1 TV + 1 anfitrión a la vez (peor caso: sondeos sincronizados).
  const burstLat: number[] = [], burstHost: number[] = [], makespan: number[] = [];
  for (let b = 0; b < BURSTS; b++) {
    const t0 = now();
    const jobs = [...Array.from({ length: n + 1 }, () => timed(svc)), timed(host)];
    const r = await Promise.all(jobs);
    makespan.push(now() - t0);
    for (const x of r.slice(0, -1)) burstLat.push(x.ms);
    burstHost.push(r[r.length - 1]!.ms);
  }
  console.log(`(a) RÁFAGA concurrente: ${n} móviles + 1 TV (público) + 1 anfitrión a la vez, ${BURSTS} ráfagas`);
  res.burstPublic = row('latencia por petición pública', burstLat);
  res.burstHost = row('latencia del anfitrión', burstHost);
  res.burstMakespan = row('duración total de la ráfaga', makespan);

  // Sostenido: cada cliente sondea cada POLL_MS con fase aleatoria (lo que ocurre de verdad).
  const lat: number[] = [], latHost: number[] = [];
  let issued = 0;
  const stopAt = now() + SUSTAIN_MS;
  const t0 = now();
  const busy: number[] = [];
  const client = async (isHost: boolean) => {
    await sleep(Math.random() * POLL_MS);
    while (now() < stopAt) {
      const r = await timed(isHost ? host : svc);
      issued++;
      (isHost ? latHost : lat).push(r.ms);
      busy.push(r.ms);
      await sleep(POLL_MS);
    }
  };
  await Promise.all([...Array.from({ length: n + 1 }, () => client(false)), client(true)]);
  const wall = now() - t0;
  console.log(`(a) SOSTENIDO: ${n} móviles + TV + anfitrión sondeando cada ${POLL_MS} ms durante ${(SUSTAIN_MS / 1000).toFixed(0)} s (${issued} peticiones, ${(issued / (wall / 1000)).toFixed(1)} req/s)`);
  res.sustainedPublic = row('latencia pública (móviles + TV)', lat);
  res.sustainedHost = row('latencia del anfitrión', latHost);
  return res;
}

async function measureWrites(e: Engine, ctx: Ctx, sc: Scenario) {
  const n = sc.nPlayers;
  const out: Record<string, ReturnType<typeof stats>> = {};
  const bid = (idx: number, cents: number) => timed(() => playerBid(ctx, sc.room, sc.tokens[idx], { auction_id: sc.auction, amount_cents: cents, idempotency_key: randomUUID() }));

  // Puja aislada (secuencial): jugadores rotando, importe creciente.
  const seq: number[] = [];
  for (let i = 0; i < BID_ROUNDS * 2; i++) {
    const idx = (sc.leaderIdx + 1) % n;
    sc.lastCents += 100;
    const r = await bid(idx, sc.lastCents);
    if (r.ok) sc.leaderIdx = idx;
    seq.push(r.ms);
  }
  console.log('(b) PUJAS (ss_player_bid, bloqueo FOR UPDATE de la partida)');
  out.bidSeq = row('puja aislada (secuencial)', seq);

  // Contienda: los n-1 no líderes pujan a la vez con importes distintos; solo una parte puede ser válida cada ronda.
  const conc: number[] = [], concOk: number[] = [], rounds: number[] = [];
  let okCount = 0, total = 0;
  for (let r = 0; r < BID_ROUNDS; r++) {
    const base = sc.lastCents;
    const t0 = now();
    const jobs: Promise<{ ms: number; ok: boolean }>[] = [];
    for (let i = 0; i < n; i++) if (i !== sc.leaderIdx) jobs.push(bid(i, base + 100 * (i + 1)));
    const res = await Promise.all(jobs);
    rounds.push(now() - t0);
    for (const x of res) { conc.push(x.ms); total++; if (x.ok) { okCount++; concOk.push(x.ms); } }
    const st = await getPublicState(ctx, sc.room);
    sc.lastCents = st.auction!.current_bid_cents ?? sc.lastCents;
    sc.leaderIdx = sc.tokens.length ? st.players.findIndex((p) => p.id === st.auction!.current_bidder_id) : -1;
  }
  console.log(`  contienda: ${n - 1} pujas simultáneas por ronda, ${BID_ROUNDS} rondas (${okCount}/${total} aceptadas; las rechazadas lo serían por «puja demasiado baja» según el orden de llegada)`);
  out.bidConc = row('latencia por puja (todas)', conc);
  out.bidRound = row('duración de la ronda completa', rounds);

  // Pujas con lecturas concurrentes: ¿bloquean las pujas a los sondeos? (ss_get_state no toma FOR UPDATE)
  const readsDuring: number[] = [], bidsDuring: number[] = [];
  for (let r = 0; r < BID_ROUNDS; r++) {
    const base = sc.lastCents;
    const reads = Array.from({ length: n + 2 }, () => timed(() => getPublicState(ctx, sc.room)));
    const bids: Promise<{ ms: number; ok: boolean }>[] = [];
    for (let i = 0; i < n; i++) if (i !== sc.leaderIdx) bids.push(bid(i, base + 100 * (i + 1)));
    const [rr, bb] = await Promise.all([Promise.all(reads), Promise.all(bids)]);
    for (const x of rr) readsDuring.push(x.ms);
    for (const x of bb) bidsDuring.push(x.ms);
    const st = await getPublicState(ctx, sc.room);
    sc.lastCents = st.auction!.current_bid_cents ?? sc.lastCents;
    sc.leaderIdx = st.players.findIndex((p) => p.id === st.auction!.current_bidder_id);
  }
  console.log(`  mezcla: ${n - 1} pujas + ${n + 2} lecturas a la vez, ${BID_ROUNDS} rondas`);
  out.mixReads = row('latencia de las LECTURAS durante pujas', readsDuring);
  out.mixBids = row('latencia de las PUJAS durante lecturas', bidsDuring);

  // Ceder la puja: partida nueva por prueba (el último que cede puede adjudicar al instante, lo que cierra la subasta).
  const yseq: number[] = [], yconc: number[] = [], yround: number[] = [];
  for (let t = 0; t < YIELD_TRIALS; t++) {
    const y = await buildScenario(e, ctx, n, 1);
    const yld = (idx: number) => timed(() => yieldBid(ctx, y.room, y.tokens[idx], { auction_id: y.auction }));
    const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== y.leaderIdx);
    const first = await yld(others[0]!); // aislado
    yseq.push(first.ms);
    const t0 = now();
    const res = await Promise.all(others.slice(1).map((i) => yld(i))); // el resto cede a la vez
    yround.push(now() - t0);
    for (const x of res) yconc.push(x.ms);
  }
  console.log(`(b) CEDER LA PUJA (ss_yield_bid): ${YIELD_TRIALS} partidas; en cada una uno cede aislado y los otros ${n - 2} ceden a la vez`);
  out.yieldSeq = row('ceder aislado', yseq);
  out.yieldConc = row('latencia por cesión (concurrente)', yconc);
  out.yieldRound = row('duración de la tanda completa', yround);
  return out;
}

/** Coste en servidor (sin red ni JSON de cliente) de cada capa de la pila de envoltorios `ss_get_state*`: 200 llamadas en un bucle SQL. */
async function profileWrappers(e: Engine, sc: Scenario) {
  const q = async (sql: string) => {
    const t = now();
    await e.exec(sql);
    return now() - t;
  };
  const list = await listWrappers(e);
  const loops = 200;
  console.log(`(c) PERFIL de la pila de ${list.length} funciones ss_get_state* (${loops} llamadas en bucle SQL, vista pública, ms por llamada; orden alfabetico, NO el de apilado; cada una incluye las que envuelve)`);
  const out: Record<string, number> = {};
  for (const fn of list) {
    const ms = await q(`do $$ declare i int; begin for i in 1..${loops} loop perform ${fn}('{"room_code":"${sc.room}","view":"public"}'::jsonb); end loop; end $$`);
    out[fn] = ms / loops;
    console.log(`  ${fn.padEnd(40)} ${(ms / loops).toFixed(2).padStart(7)} ms`);
  }
  return out;
}
async function listWrappers(e: Engine): Promise<string[]> {
  const rows = await e.query<{ name: string }>(`select proname as name from pg_proc where proname like 'ss\\_get\\_state%' and pronamespace = 'public'::regnamespace order by proname`);
  // La función pública va la última; las capas internas, de la más antigua a la más reciente por nombre.
  return [...rows.map((r) => r.name).filter((n) => n !== 'ss_get_state'), 'ss_get_state'];
}

// ---------------------------------------------------------------------------------------------- principal
async function runEngine(e: Engine) {
  console.log(`\n=== Motor: ${e.label} ===`);
  const ctx: Ctx = { db: e.db, storage: createMemoryStorage(), publisher: { async publish() {} }, provider: createDemoProvider() } as Ctx;
  const results: Record<string, unknown> = {};
  for (const n of SIZES) {
    console.log(`\n--- N = ${n} jugadores (+ TV + anfitrión) ---`);
    const sc = await buildScenario(e, ctx, n);
    const size = await measureSize(ctx, sc);
    const reads = await measureReads(ctx, sc);
    const writes = await measureWrites(e, ctx, sc);
    const profile = await profileWrappers(e, sc);
    results[`N${n}`] = { size, reads, writes, profile };
  }
  return results;
}

async function main() {
  console.log(`loadtest · node ${process.version} · ${new Date().toISOString()} · ${QUICK ? 'modo rápido' : 'modo completo'} · N=${SIZES.join(',')}`);
  console.log('Aviso: PGlite no representa a Postgres de Supabase; compara siempre dentro del mismo motor.');
  const all: Record<string, unknown> = {};
  const engines = ENGINE === 'both' ? ['pglite', 'pg'] : [ENGINE];
  for (const name of engines) {
    capRelaxed = false;
    const e = name === 'pg' ? await pgEngine() : await pgliteEngine();
    try {
      all[e.name] = await runEngine(e);
    } finally {
      await e.close();
    }
  }
  if (flag('json')) console.log('\nJSON:\n' + JSON.stringify(all, null, 1));
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
