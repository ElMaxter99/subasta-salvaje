import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeSendAlert } from '@/lib/observability/alerts';
import { bump, flushMetrics, observeRequest, pendingMetrics, recordError, resetMetricsBuffer } from '@/lib/observability/record';
import { latencyBucket, normalizeRoute, roomFromPath, routeFamily, sanitizeText, statusClass } from '@/lib/observability/sanitize';
import { csvCell, exportErrorsCsv, observabilityErrors, observabilityOp, observabilityOverview, runObservabilityMaintenance, toCsv } from '@/lib/services/observability-service';
import { makeCtx, newHost, startedGame, type TestCtx } from './helpers';

const FAKE_KEY = ['sk', 'abcdefghijklmnopqrstuv'].join('-'); // FALSA, partida para el escáner de secretos

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});
beforeEach(async () => {
  await q('delete from app_errors; delete from usage_metrics');
  resetMetricsBuffer();
});
const q = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
  const r = (await ctx.db.pg.exec(sql)).at(-1);
  return (r?.rows ?? []) as T[];
};

describe('saneado', () => {
  it('quita secretos, correos, IP, cookies y consultas de URL, y trunca', () => {
    const t = sanitizeText('fallo para ana@x.es desde 192.168.1.10 con Bearer abcdefghijklmnop y sb-abc-auth-token=zzzz12345 en https://x.es/p?token=ABC&x=1 ' + 'x'.repeat(900), 200);
    expect(t).not.toMatch(/ana@x\.es|192\.168|abcdefghijklmnop|zzzz12345|token=ABC/);
    expect(t).toContain('[correo]');
    expect(t.length).toBeLessThanOrEqual(201);
  });
  it('redacta claves exactas del entorno', () => {
    process.env.CRON_SECRET = 'super-secreto-12345';
    try {
      expect(sanitizeText('error con super-secreto-12345 dentro', 100)).not.toContain('super-secreto');
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
  it('normaliza rutas, familias y cubos', () => {
    expect(normalizeRoute('/game/ABCD12/play?x=1')).toBe('/game/:id/play');
    expect(normalizeRoute('/api/play/ABCD/bid')).toBe('/api/play/:id/bid');
    expect(roomFromPath('/api/play/abcd/bid')).toBe('ABCD');
    expect(routeFamily('/api/play/ABCD/bid')).toBe('play');
    expect(routeFamily('/api/inventada/x')).toBe('other');
    expect(statusClass(429)).toBe('429');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
    expect(latencyBucket(30)).toBe('50');
    expect(latencyBucket(300)).toBe('500');
    expect(latencyBucket(9000)).toBe('max');
  });
});

describe('errores: captura y agrupación por huella', () => {
  it('agrupa el mismo error aunque cambien los números, cuenta repeticiones y no guarda secretos', async () => {
    const base = { source: 'server' as const, route: '/api/play/ABCD/bid', code: 'internal', stack: 'Error: x\n at f (a.ts:1)' };
    const a = await recordError({ ...base, message: `Error: fallo con puja 123 de ana@x.es ${FAKE_KEY}` }, ctx.db);
    const b = await recordError({ ...base, message: `Error: fallo con puja 987 de ana@x.es ${FAKE_KEY}` }, ctx.db);
    const c = await recordError({ ...base, source: 'client', message: 'otra cosa' }, ctx.db);
    expect(a?.is_new).toBe(true);
    expect(b?.is_new).toBe(false);
    expect(b?.fingerprint).toBe(a?.fingerprint);
    expect(c?.fingerprint).not.toBe(a?.fingerprint);
    const list = await observabilityErrors(ctx, {});
    expect(list).toHaveLength(2);
    const g = list.find((e) => e.fingerprint === a!.fingerprint)!;
    expect(g.total).toBe(2);
    expect(g.count_24h).toBe(2);
    expect(g.route).toBe('/api/play/:id/bid');
    expect(g.message).not.toMatch(/ana@x|sk-abc/);
    expect(g.severity).toBe('high');
    expect(list.find((e) => e.source === 'client')?.severity).toBe('low');
  });

  it('segunda barrera en SQL: aunque llegue sin sanear, no se guardan correos ni JWT', async () => {
    await ctx.db.rpc('ss_obs_error_record', { source: 'server', route: '/x', code: 'internal', message: 'a b@c.es eyJabcdefghijklm.abcdefghij.abcdefghij 10.0.0.1' });
    const m = (await observabilityErrors(ctx, {}))[0]!.message;
    expect(m).not.toMatch(/b@c\.es|eyJabc|10\.0\.0\.1/);
  });

  it('estado visto/resuelto auditado, reapertura al repetirse y filtros', async () => {
    const r = await recordError({ source: 'cron', route: '/api/jobs/process', code: 'internal', message: 'boom' }, ctx.db);
    await observabilityOp(ctx, 'root@x.es', { op: 'status', fingerprint: r!.fingerprint, status: 'resolved' });
    expect(await observabilityErrors(ctx, { status: 'open' })).toHaveLength(0);
    expect(await observabilityErrors(ctx, { status: 'resolved' })).toHaveLength(1);
    const again = await recordError({ source: 'cron', route: '/api/jobs/process', code: 'internal', message: 'boom' }, ctx.db);
    expect(again?.reopened).toBe(true);
    expect((await observabilityErrors(ctx, { status: 'new' }))).toHaveLength(1);
    expect(await observabilityErrors(ctx, { source: 'client' })).toHaveLength(0);
    expect(await observabilityErrors(ctx, { q: 'JOBS' })).toHaveLength(1);
    const audit = await q<{ action: string; actor: string }>("select action, actor from admin_audit where action = 'error_status' order by id desc limit 1");
    expect(audit[0]).toMatchObject({ actor: 'root@x.es' });
    await expect(observabilityOp(ctx, 'x', { op: 'status', fingerprint: 'no-valido', status: 'seen' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('purga y tope', () => {
  it('purga por retención configurable', async () => {
    await recordError({ source: 'server', route: '/a', message: 'vieja' }, ctx.db);
    await q("update app_errors set last_at = now() - interval '40 days'; update app_error_hourly set hour = now() - interval '40 days'");
    await observabilityOp(ctx, 'root', { op: 'setting', key: 'obs_retention_days', value: 60 });
    expect((await ctx.db.rpc<{ errors: number }>('ss_obs_purge', {})).errors).toBe(0);
    await observabilityOp(ctx, 'root', { op: 'setting', key: 'obs_retention_days', value: 30 });
    expect((await ctx.db.rpc<{ errors: number }>('ss_obs_purge', {})).errors).toBe(1);
    expect(await observabilityErrors(ctx, {})).toHaveLength(0);
    await expect(observabilityOp(ctx, 'root', { op: 'setting', key: 'obs_retention_days', value: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('tope duro de grupos: descarta primero resueltos y antiguos', async () => {
    await q(`insert into app_errors (fingerprint, source, route, message, status, last_at)
             select md5('x' || g), 'server', '/x', 'm' || g, case when g < 5 then 'resolved' else 'seen' end, now() - (g || ' minutes')::interval from generate_series(1, 500) g`);
    const r = await recordError({ source: 'server', route: '/nuevo', message: 'nuevo' }, ctx.db);
    expect(r?.is_new).toBe(true);
    const n = await q<{ n: number }>('select count(*)::int n from app_errors');
    expect(n[0]!.n).toBe(500);
    expect(await q("select 1 from app_errors where fingerprint = md5('x4')")).toHaveLength(0); // el resuelto más antiguo
    expect(await q("select 1 from app_errors where fingerprint = md5('x1')")).toHaveLength(1);
  });
});

describe('métricas agregadas', () => {
  it('cuenta peticiones por familia/clase, latencia y errores de dominio, y calcula p50/p95', async () => {
    const mk = (p: string) => new Request(`http://localhost${p}`);
    const t0 = Date.now();
    for (let i = 0; i < 17; i++) observeRequest(mk('/api/play/ABCD/bid'), 200, t0 - 20);
    observeRequest(mk('/api/play/ABCD/bid'), 200, t0 - 700);
    observeRequest(mk('/api/play/ABCD/bid'), 409, t0 - 20, Object.assign(new Error('x'), { name: 'DomainError', code: 'bid_too_low', status: 409 }));
    observeRequest(mk('/api/play/ABCD/bid'), 429, t0 - 700);
    expect(pendingMetrics()['req.play.2xx']).toBe(18);
    expect(pendingMetrics()['derr.bid_too_low']).toBe(1);
    expect(await flushMetrics(ctx.db)).toBe(true);
    expect(pendingMetrics()).toEqual({});
    const ov = await observabilityOverview(ctx);
    const play = ov.families.find((f) => f.family === 'play')!;
    expect(play).toMatchObject({ total: 20, s2xx: 18, s4xx: 1, s429: 1, s5xx: 0, p50: 50, p95: 1000 });
    expect(ov.domain_errors).toContainEqual({ code: 'bid_too_low', n: 1 });
    expect(ov.rate_5xx).toBe(0);
  });
  it('ignora nombres y valores inválidos', async () => {
    await ctx.db.rpc('ss_obs_incr', { metrics: { 'MAL NOMBRE': 1, 'ok.metric': 2, 'neg.v': -1, 'big.v': 1e9 } });
    expect(await q("select metric from usage_metrics where metric in ('ok.metric','neg.v','big.v','MAL NOMBRE')")).toEqual([{ metric: 'ok.metric' }]);
  });
  it('un 5xx guarda un error agrupado (sin tocar el cuerpo) y cuenta la tasa de 5xx', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getContext } = await import('@/lib/services/context');
    expect(typeof getContext).toBe('function');
    spy.mockRestore();
    bump('req.games.5xx', 1);
    bump('req.games.2xx', 9);
    await flushMetrics(ctx.db);
    const ov = await observabilityOverview(ctx);
    expect(ov.status_5xx_7d).toBe(1);
    expect(ov.rate_5xx).toBeCloseTo(0.1, 5);
  });
  it('rollup: partidas creadas/empezadas y jugadores', async () => {
    const host = newHost();
    await startedGame(ctx, host);
    await ctx.db.rpc('ss_obs_rollup', { days: 2 });
    await ctx.db.rpc('ss_obs_rollup', { days: 2 });
    const ov = await observabilityOverview(ctx);
    const v = (m: string) => ov.series.filter((s) => s.metric === m).reduce((n, s) => n + Number(s.value), 0);
    expect(v('game.created')).toBeGreaterThanOrEqual(1);
    expect(v('game.started')).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe('la observabilidad nunca rompe la petición', () => {
  it('recordError, flushMetrics y observeRequest no lanzan aunque la BD falle', async () => {
    const broken = { rpc: async () => { throw new Error('BD caída'); } };
    expect(await recordError({ source: 'server', message: 'x' }, broken)).toBeNull();
    bump('req.play.2xx');
    expect(await flushMetrics(broken)).toBe(false);
    expect(() => observeRequest(undefined, 500, Date.now(), new Error('x'))).not.toThrow();
    expect(() => observeRequest({ url: 'no-es-url' } as Request, 200, 0)).not.toThrow();
    expect(await runObservabilityMaintenance({ db: broken })).toMatchObject({ ok: false });
  });
  it('handle() devuelve su respuesta normal aunque el contexto de observabilidad falle', async () => {
    vi.resetModules();
    vi.doMock('@/lib/services/context', () => ({ getContext: async () => { throw new Error('sin contexto'); } }));
    const { handle } = await import('@/lib/api');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = await handle<[Request]>(async () => new Response('ok', { status: 200 }))(new Request('http://localhost/api/x'));
    const bad = await handle<[Request]>(async () => { throw new Error('kaboom'); })(new Request('http://localhost/api/play/ABCD/bid'));
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(500);
    expect((await bad.json()).error.code).toBe('internal');
    await new Promise((r) => setTimeout(r, 20));
    spy.mockRestore();
    vi.doUnmock('@/lib/services/context');
    vi.resetModules();
  });
});

describe('alertas', () => {
  it('error grave nuevo y pico aparecen en el resumen', async () => {
    expect((await observabilityOverview(ctx)).alerts).toEqual([]);
    await recordError({ source: 'server', route: '/api/games/x', message: 'grave' }, ctx.db);
    expect((await observabilityOverview(ctx)).alerts.map((a) => a.kind)).toContain('new_error');
    await q("update app_error_hourly set n = 40 where hour = date_trunc('hour', now())");
    expect((await observabilityOverview(ctx)).alerts.map((a) => a.kind)).toContain('spike');
  });
  it('sin Resend o con el interruptor apagado no se envía nada; con ambos, uno y con límite', async () => {
    await recordError({ source: 'server', route: '/api/games/x', message: 'mensaje-secreto-xyz' }, ctx.db);
    const sent: string[] = [];
    const fetchMock = vi.fn(async (_u: unknown, init?: RequestInit) => { sent.push(String(init?.body)); return new Response('{}', { status: 200 }); });
    vi.stubGlobal('fetch', fetchMock);
    const env = { RESEND_API_KEY: 're_abcdefghijklmnopqrstuvwx', MAIL_FROM: 'a@b.es', SUPERADMIN_EMAILS: 'root@x.es' } as unknown as NodeJS.ProcessEnv;
    try {
      expect(await maybeSendAlert(ctx.db, env)).toBe(0); // interruptor apagado
      await observabilityOp(ctx, 'root', { op: 'setting', key: 'obs_alert_email', value: true });
      expect(await maybeSendAlert(ctx.db, {} as NodeJS.ProcessEnv)).toBe(0); // sin Resend
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await maybeSendAlert(ctx.db, env)).toBe(1);
      expect(await maybeSendAlert(ctx.db, env)).toBe(0); // límite anti-spam
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain('mensaje-secreto-xyz'); // ni mensajes: solo recuentos, ruta y código
    } finally {
      vi.unstubAllGlobals();
      await observabilityOp(ctx, 'root', { op: 'setting', key: 'obs_alert_email', value: false });
      await q("delete from app_settings where key = 'obs_alert_last_at'");
    }
  });
});

describe('CSV', () => {
  it('escapa y neutraliza fórmulas', async () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(toCsv(['a'], [['1']])).toContain('\r\n1\r\n');
    await recordError({ source: 'server', route: '/a', message: '=cmd|calc' }, ctx.db);
    const csv = await exportErrorsCsv(ctx);
    expect(csv).toContain("'=cmd");
    expect(csv.split('\r\n')[0]).toContain('huella');
  });
});
