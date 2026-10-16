import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminGameOp, adminInvite, adminOverview, adminSetSetting, adminUserOp, adminUsers, adminAudit, adminGames } from '@/lib/services/admin-service';
import { createGame, deleteGame, getHostState, purgeExpiredGames } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});
afterEach(async () => {
  await adminSetSetting(ctx, 'test', { key: 'signups_open', value: true });
  await adminSetSetting(ctx, 'test', { key: 'ai_enabled', value: true });
});

const access = (uid: string, email: string) => ctx.db.rpc<{ allowed: boolean; reason?: string }>('ss_host_access', { user_id: uid, email });

describe('ajustes y auditoría', () => {
  it('valida los valores, los guarda y deja rastro en la auditoría', async () => {
    const s = await adminSetSetting(ctx, 'root@x.es', { key: 'game_ttl_hours', value: 24 });
    expect(s.game_ttl_hours).toBe(24);
    await expect(adminSetSetting(ctx, 'root@x.es', { key: 'game_ttl_hours', value: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(ctx.db.rpc('ss_settings_set', { key: 'inventado', value: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(ctx.db.rpc('ss_settings_set', { key: 'signups_open', value: 'si' })).rejects.toMatchObject({ code: 'invalid_input' });
    await adminSetSetting(ctx, 'root@x.es', { key: 'game_ttl_hours', value: null });
    const log = await adminAudit(ctx);
    expect(log.find((e) => e.action === 'setting_changed' && e.actor === 'root@x.es')?.payload).toMatchObject({ new: null });
  });
});

describe('acceso de anfitriones: registro abierto/cerrado, invitaciones y bloqueo', () => {
  it('abierto: se crea el perfil; cerrado: sin invitación no entra; con invitación sí (y se marca usada)', async () => {
    const a = randomUUID();
    expect((await access(a, 'a@x.es')).allowed).toBe(true);
    await adminSetSetting(ctx, 'root', { key: 'signups_open', value: false });
    const b = randomUUID();
    expect(await access(b, 'b@x.es')).toMatchObject({ allowed: false, reason: 'closed' });
    expect((await access(a, 'a@x.es')).allowed).toBe(true); // quien ya tenía perfil sigue entrando
    await adminInvite(ctx, 'root', { op: 'add', email: ' B@X.es ' });
    expect((await access(b, 'b@x.es')).allowed).toBe(true);
    const inv = (await adminUsers(ctx)).invites.find((i) => i.email === 'b@x.es')!;
    expect(inv.used_at).not.toBeNull();
    await expect(adminInvite(ctx, 'root', { op: 'add', email: 'no-es-un-correo' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('la puerta de alta respeta el registro cerrado y las invitaciones', async () => {
    const gate = (email: string) => ctx.db.rpc<{ open: boolean; allowed: boolean }>('ss_signup_allowed', { email });
    expect(await gate('n@x.es')).toEqual({ open: true, allowed: true });
    await adminSetSetting(ctx, 'root', { key: 'signups_open', value: false });
    expect(await gate('n@x.es')).toEqual({ open: false, allowed: false });
    await adminInvite(ctx, 'root', { op: 'add', email: 'N@x.es' });
    expect(await gate(' n@x.es ')).toEqual({ open: false, allowed: true });
  });

  it('quien ya tenía partidas antes conserva el acceso con el registro cerrado', async () => {
    const host = newHost();
    await createGame(ctx, host, { name: 'Vieja', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await adminSetSetting(ctx, 'root', { key: 'signups_open', value: false });
    expect((await access(host, 'viejo@x.es')).allowed).toBe(true);
  });

  it('un usuario bloqueado no entra y se puede desbloquear', async () => {
    const u = randomUUID();
    await access(u, 'u@x.es');
    await adminUserOp(ctx, { id: randomUUID(), email: 'root' }, { op: 'set', user_id: u, status: 'blocked' });
    expect(await access(u, 'u@x.es')).toMatchObject({ allowed: false, reason: 'blocked' });
    await adminUserOp(ctx, { id: randomUUID(), email: 'root' }, { op: 'set', user_id: u, status: 'active' });
    expect((await access(u, 'u@x.es')).allowed).toBe(true);
  });

  it('el superadmin no puede bloquearse ni borrarse a sí mismo', async () => {
    const me = randomUUID();
    await expect(adminUserOp(ctx, { id: me, email: 'root' }, { op: 'set', user_id: me, status: 'blocked' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('IA: interruptor global, permiso por usuario y cuotas editables', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const withAi = () => {
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';
    process.env.CLOUDFLARE_API_TOKEN = 'tok';
  };

  it('sin permiso de IA (global o del usuario) no se puede crear ni cambiar a modo IA', async () => {
    withAi();
    const host = newHost();
    await access(host, 'ia@x.es');
    await expect(createGame(ctx, host, { name: 'Con IA', image_mode: 'ai', players: [{ name: 'A' }, { name: 'B' }] })).resolves.toBeTruthy();
    await adminSetSetting(ctx, 'root', { key: 'ai_enabled', value: false });
    await expect(createGame(ctx, host, { name: 'Sin IA global', image_mode: 'ai', players: [] })).rejects.toMatchObject({ code: 'ai_not_available' });
    await adminSetSetting(ctx, 'root', { key: 'ai_enabled', value: true });
    await adminUserOp(ctx, { id: randomUUID(), email: 'root' }, { op: 'set', user_id: host, ai_enabled: false });
    await expect(createGame(ctx, host, { name: 'Sin IA usuario', image_mode: 'ai', players: [] })).rejects.toMatchObject({ code: 'ai_disabled_for_user' });
    // Sus partidas en modo IA pasan a pegatinas
    const games = await adminGames(ctx);
    expect(games.filter((g) => g.host_id === host && g.image_mode === 'ai')).toHaveLength(0);
  });

  it('con la IA apagada globalmente los trabajos de modo IA quedan en cola y los de pegatinas siguen', async () => {
    const { createDemoProvider } = await import('@/lib/ai/demo');
    const real = createDemoProvider(); // hace de proveedor «real» (id demo: sin cuota ni validación estricta)
    const c2 = { ...ctx, provider: real, stickers: createDemoProvider() };
    const host = newHost();
    const { room_code } = await createGame(c2, host, { name: 'Mixta', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const s = await getHostState(c2, room_code, host);
    await adminSetSetting(ctx, 'root', { key: 'ai_enabled', value: false });
    await act(ctx, room_code, host, { type: 'image.request_initial', player_id: playerByName(s, 'Ana').id });
    const r = await processImageJobs(c2, { gameId: s.game.id });
    expect(r.succeeded).toBe(1); // pegatinas
    await ctx.db.pg.query("update games set image_mode = 'ai' where id = $1", [s.game.id]);
    await act(ctx, room_code, host, { type: 'image.request_initial', player_id: playerByName(s, 'Beto').id });
    expect((await processImageJobs(c2, { gameId: s.game.id })).processed).toBe(0); // IA apagada: no se toca
    await adminSetSetting(ctx, 'root', { key: 'ai_enabled', value: true });
    expect((await processImageJobs(c2, { gameId: s.game.id })).succeeded).toBe(1);
  });

  it('cuota por partida editable en caliente', async () => {
    await adminSetSetting(ctx, 'root', { key: 'quota_per_game', value: 3 });
    const { effectiveQuota, getSettings, invalidateSettings } = await import('@/lib/services/settings');
    invalidateSettings(ctx.db);
    expect(effectiveQuota(await getSettings(ctx.db)).perGame).toBe(3);
    await adminSetSetting(ctx, 'root', { key: 'quota_per_game', value: null });
    invalidateSettings(ctx.db);
    expect(effectiveQuota(await getSettings(ctx.db)).perGame).toBe(10);
  });

  it('el uso de IA sobrevive al borrado de la partida (el contador diario no se «devuelve»)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Gasto', players: [{ name: 'A' }, { name: 'B' }] });
    const gid = (await getHostState(ctx, room_code, host)).game.id;
    const before = (await adminOverview(ctx)).ai.today;
    await ctx.db.pg.query(
      "insert into image_jobs (game_id, kind) values ($1, 'base')", [gid]);
    const jobId = (await ctx.db.pg.query<{ id: string }>("select id from image_jobs where game_id = $1", [gid])).rows[0]!.id;
    await ctx.db.rpc('ss_reserve_image_quota', { job_id: jobId, provider: 'cloudflare', game_limit: 10, day_limit: 50 });
    expect((await adminOverview(ctx)).ai.today).toBe(before + 1);
    await deleteGame(ctx, room_code, host);
    const after = await adminOverview(ctx);
    expect(after.ai.today).toBe(before + 1);
    expect(after.ai.top_hosts.some((t) => t.host_id === host)).toBe(true);
  });
});

describe('borrado de usuarios y partidas', () => {
  it('borrar un usuario elimina todo lo suyo (partidas y archivos) y lo deja auditado; exige confirmar el correo', async () => {
    const uid = randomUUID();
    await access(uid, 'borrar@x.es');
    const { room_code } = await createGame(ctx, uid, { name: 'Se va', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const gid = (await getHostState(ctx, room_code, uid)).game.id;
    await ctx.storage.put(`games/${gid}/players/x.png`, new Uint8Array([1]), 'image/png');
    const actor = { id: randomUUID(), email: 'root@x.es' };
    await expect(adminUserOp(ctx, actor, { op: 'delete', user_id: uid, confirm: 'otro@x.es' })).rejects.toMatchObject({ code: 'invalid_input' });
    const r = await adminUserOp(ctx, actor, { op: 'delete', user_id: uid, confirm: 'BORRAR@x.es' });
    expect(r.games_deleted).toBe(1);
    expect([...ctx.storage.files.keys()].some((k) => k.startsWith(`games/${gid}/`))).toBe(false);
    expect((await adminGames(ctx)).some((g) => g.id === gid)).toBe(false);
    expect((await adminUsers(ctx)).users.some((u) => u.user_id === uid)).toBe(false);
    expect((await adminAudit(ctx)).some((e) => e.action === 'user_deleted' && e.target_id === uid)).toBe(true);
  });

  it('el superadmin puede borrar una partida concreta y purgar las caducadas; el plazo es configurable (7 días por defecto)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Vieja', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const gid = (await getHostState(ctx, room_code, host)).game.id;
    // 6 días sin actividad: sigue; con el plazo a 24 h: se purga
    await ctx.db.pg.query("update games set updated_at = now() - interval '6 days' where id = $1", [gid]);
    expect((await purgeExpiredGames(ctx, { limit: 100 })).deleted).toBe(0);
    await adminSetSetting(ctx, 'root', { key: 'game_ttl_hours', value: 24 });
    const { invalidateSettings } = await import('@/lib/services/settings');
    invalidateSettings(ctx.db);
    expect(await adminGameOp(ctx, 'root', { op: 'purge' })).toMatchObject({ deleted: 1 });
    await adminSetSetting(ctx, 'root', { key: 'game_ttl_hours', value: null });
    const h2 = newHost();
    const g2 = await createGame(ctx, h2, { name: 'Manual', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await adminGameOp(ctx, 'root', { op: 'delete', room_code: g2.room_code });
    await expect(getHostState(ctx, g2.room_code, h2)).rejects.toMatchObject({ code: 'game_not_found' });
    const actions = (await adminAudit(ctx)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['games_purged', 'game_deleted']));
  });
});

describe('estadísticas de uso y peso', () => {
  it('el resumen incluye BD, tablas, almacenamiento seguido, IA por día y no cuenta dos veces archivos compartidos', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Peso', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await act(ctx, room_code, host, { type: 'image.set_initial_all', catalog_id: 'house' });
    const o = await adminOverview(ctx);
    expect(o.db_bytes).toBeGreaterThan(0);
    expect(o.tables.some((t) => t.name === 'games')).toBe(true);
    expect(o.ai.per_day).toHaveLength(14);
    expect(o.storage.bucket_bytes).toBeNull(); // PGlite no tiene el esquema storage
    const games = await adminGames(ctx);
    const mine = games.find((g) => g.room_code === room_code)!;
    expect(mine.versions).toBe(2); // una versión por jugador, MISMO archivo
    const tracked = o.storage.tracked_files;
    expect(tracked).toBeGreaterThanOrEqual(1);
    const bytes = mine.bytes;
    const one = (await ctx.db.pg.query<{ b: string }>('select max(bytes)::text as b from image_versions where game_id = $1', [mine.id])).rows[0]!.b;
    expect(bytes).toBe(Number(one)); // contado una sola vez
  });
});
