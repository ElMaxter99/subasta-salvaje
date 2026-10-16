import { z } from 'zod';
import { getRuntimeMode } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { redactSecrets } from '@/lib/security/redact';
import type { AppContext } from './context';
import { getSettings, invalidateSettings, type AppSettings } from './settings';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'>;

/* ---------- Tipos de lo que muestra el panel ---------- */
export interface AdminOverview {
  db_bytes: number;
  tables: { name: string; bytes: number; rows: number }[];
  counts: { hosts: number; blocked_hosts: number; games: number; games_active: number; players: number; image_versions: number; jobs_pending: number; jobs_failed: number; events: number };
  storage: { tracked_bytes: number; tracked_files: number; bucket_bytes: number | null; bucket_objects: number | null };
  ai: { today: number; month: number; total: number; per_day: { day: string; count: number }[]; by_provider: { provider: string; count: number }[]; top_hosts: { host_id: string | null; email: string | null; count: number }[] };
}
export interface AdminUser {
  user_id: string;
  email: string | null;
  status: 'active' | 'blocked';
  ai_enabled: boolean;
  profile: boolean;
  created_at: string | null;
  last_seen_at: string | null;
  last_sign_in_at?: string | null;
  games: number;
  games_active: number;
  ai_used: number;
  bytes: number;
}
export interface AdminInvite {
  email: string;
  invited_at: string;
  used_at: string | null;
}
export interface AdminGame {
  id: string;
  room_code: string;
  name: string;
  status: string;
  play_mode: string;
  image_mode: string;
  host_id: string;
  host_email: string | null;
  created_at: string;
  updated_at: string;
  players: number;
  versions: number;
  ai_used: number;
  bytes: number;
}
export interface AdminAuditEntry {
  id: number;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Límites del plan gratuito de Supabase (CONFIGURABLES: cambian con el tiempo; contrástalos con la página de precios). */
export function planLimits(env: NodeJS.ProcessEnv = process.env) {
  const mb = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return { dbBytes: mb(env.SUPABASE_PLAN_DB_MB, 500) * 1024 * 1024, storageBytes: mb(env.SUPABASE_PLAN_STORAGE_MB, 1024) * 1024 * 1024 };
}

/* ---------- Lecturas ---------- */
export const adminOverview = (ctx: Ctx) => ctx.db.rpc<AdminOverview>('ss_admin_overview', {});
export const adminGames = (ctx: Ctx) => ctx.db.rpc<AdminGame[]>('ss_admin_games', { limit: 300 });
export const adminAudit = (ctx: Ctx) => ctx.db.rpc<AdminAuditEntry[]>('ss_admin_audit_list', { limit: 300 });
export async function adminSettings(ctx: Ctx): Promise<AppSettings> {
  invalidateSettings(ctx.db);
  return getSettings(ctx.db);
}

interface AuthUserLite {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
}

/** Usuarios de Supabase Auth (solo modo Supabase). Paginado hasta 1000 cuentas. */
async function listAuthUsers(): Promise<AuthUserLite[]> {
  if (getRuntimeMode() !== 'supabase') return [];
  const { getSupabaseAdmin } = await import('@/lib/db/supabase');
  const out: AuthUserLite[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new DomainError('internal', `No se pudo leer la lista de cuentas: ${redactSecrets(error.message)}`);
    out.push(...data.users);
    if (data.users.length < 200) break;
  }
  return out;
}

/** Perfiles de anfitrión + cuentas de Auth (incluye a quien se registró pero aún no tiene perfil) + invitaciones. */
export async function adminUsers(ctx: Ctx): Promise<{ users: AdminUser[]; invites: AdminInvite[] }> {
  const base = await ctx.db.rpc<{ users: AdminUser[]; invites: AdminInvite[] }>('ss_admin_users', {});
  const auth = await listAuthUsers().catch((e) => {
    console.error('[admin] listUsers', redactSecrets(String(e)));
    return [] as AuthUserLite[];
  });
  const byId = new Map(auth.map((u) => [u.id, u]));
  const users = base.users.map((u) => {
    const a = byId.get(u.user_id);
    byId.delete(u.user_id);
    return { ...u, email: u.email ?? a?.email ?? null, created_at: u.created_at ?? a?.created_at ?? null, last_sign_in_at: a?.last_sign_in_at ?? null };
  });
  for (const a of byId.values()) {
    users.push({ user_id: a.id, email: a.email ?? null, status: 'active', ai_enabled: true, profile: false, created_at: a.created_at ?? null, last_seen_at: null, last_sign_in_at: a.last_sign_in_at ?? null, games: 0, games_active: 0, ai_used: 0, bytes: 0 });
  }
  return { users, invites: base.invites };
}

/* ---------- Acciones (todas auditadas en SQL) ---------- */
const setting = z.discriminatedUnion('key', [
  z.object({ key: z.literal('signups_open'), value: z.boolean() }),
  z.object({ key: z.literal('ai_enabled'), value: z.boolean() }),
  z.object({ key: z.literal('game_ttl_hours'), value: z.number().int().min(1).max(2160).nullable() }),
  z.object({ key: z.literal('quota_per_game'), value: z.number().int().min(1).max(100000).nullable() }),
  z.object({ key: z.literal('quota_per_day'), value: z.number().int().min(1).max(100000).nullable() }),
]);

export async function adminSetSetting(ctx: Ctx, actor: string, raw: unknown): Promise<AppSettings> {
  const parsed = setting.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input');
  const res = await ctx.db.rpc<AppSettings>('ss_settings_set', { ...parsed.data, actor });
  invalidateSettings(ctx.db);
  return res;
}

const userOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), user_id: z.string().uuid(), email: z.string().max(200).nullable().optional(), status: z.enum(['active', 'blocked']).optional(), ai_enabled: z.boolean().optional() }),
  z.object({ op: z.literal('delete'), user_id: z.string().uuid(), confirm: z.string().max(200) }),
]);

export async function adminUserOp(ctx: Ctx, actor: { id: string; email: string }, raw: unknown): Promise<Record<string, unknown>> {
  const parsed = userOp.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input');
  const op = parsed.data;
  if (op.user_id === actor.id) throw new DomainError('invalid_input', 'No puedes bloquear ni borrar tu propia cuenta de superadmin.');
  const { clearHostAccessCache } = await import('@/lib/auth/host');
  if (op.op === 'set') {
    const r = await ctx.db.rpc<Record<string, unknown>>('ss_admin_set_user', { ...op, actor: actor.email });
    clearHostAccessCache();
    return r;
  }
  // Borrado total: partidas (BD), archivos (Storage) y cuenta de Auth. Pide escribir el correo/ID como confirmación.
  const users = await adminUsers(ctx);
  const target = users.users.find((u) => u.user_id === op.user_id);
  const expect = (target?.email ?? op.user_id).toLowerCase();
  if (op.confirm.trim().toLowerCase() !== expect) throw new DomainError('invalid_input', 'La confirmación no coincide con el correo del usuario.');
  const r = await ctx.db.rpc<{ game_ids: string[] }>('ss_admin_delete_user', { user_id: op.user_id, actor: actor.email });
  for (const gid of r.game_ids) await removeFiles(ctx, gid);
  if (getRuntimeMode() === 'supabase') {
    const { getSupabaseAdmin } = await import('@/lib/db/supabase');
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(op.user_id);
    if (error && !/not found/i.test(error.message)) throw new DomainError('internal', `Datos borrados, pero no se pudo borrar la cuenta de Auth: ${redactSecrets(error.message)}`);
  }
  clearHostAccessCache();
  return { ok: true, games_deleted: r.game_ids.length };
}

const inviteOp = z.object({ op: z.enum(['add', 'remove']), email: z.string().trim().max(200) });
export async function adminInvite(ctx: Ctx, actor: string, raw: unknown): Promise<Record<string, unknown>> {
  const parsed = inviteOp.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_invite', { ...parsed.data, actor });
}

const gameOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('delete'), room_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/) }),
  z.object({ op: z.literal('purge') }),
]);
export async function adminGameOp(ctx: Ctx, actor: string, raw: unknown): Promise<Record<string, unknown>> {
  const parsed = gameOp.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input');
  if (parsed.data.op === 'purge') {
    const { purgeExpiredGames } = await import('./game-service');
    const r = await purgeExpiredGames(ctx, { limit: 200 });
    await ctx.db.rpc('ss_admin_log', { actor, action: 'games_purged', target_type: 'games', payload: r });
    return r;
  }
  const r = await ctx.db.rpc<{ game_id: string; room_code: string }>('ss_admin_delete_game', { room_code: parsed.data.room_code, actor });
  await removeFiles(ctx, r.game_id);
  await ctx.publisher.publish(r.room_code, Number.MAX_SAFE_INTEGER);
  return { ok: true };
}

async function removeFiles(ctx: Ctx, gameId: string): Promise<void> {
  try {
    await ctx.storage.deletePrefix(`games/${gameId}/`);
  } catch (e) {
    console.error('[admin] no se pudieron borrar los archivos de', gameId, redactSecrets((e as Error).message));
  }
}
