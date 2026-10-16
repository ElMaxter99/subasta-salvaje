import { randomUUID } from 'node:crypto';
import { createDemoProvider } from '@/lib/ai/demo';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createPgliteDb, type PgliteDb } from '@/lib/db/pglite';
import type { HostSnapshot } from '@/lib/domain/types';
import type { Publisher } from '@/lib/realtime/publish';
import { createGame, getHostState, performAction } from '@/lib/services/game-service';
import { createMemoryStorage } from '@/lib/storage/local';

export interface TestCtx {
  db: PgliteDb;
  storage: ReturnType<typeof createMemoryStorage>;
  publisher: Publisher & { calls: { room: string; version: number }[] };
  provider: ImageGenerationProvider | null;
}

export async function makeCtx(provider: ImageGenerationProvider | null = createDemoProvider()): Promise<TestCtx> {
  const db = await createPgliteDb();
  const calls: { room: string; version: number }[] = [];
  return {
    db,
    storage: createMemoryStorage(),
    publisher: { calls, async publish(room, version) { calls.push({ room, version }); } },
    provider,
  };
}

export const newHost = () => randomUUID();

export async function startedGame(ctx: TestCtx, host: string, opts: { players?: string[]; budget?: number } = {}) {
  const names = opts.players ?? ['Ana', 'Beto', 'Carla', 'Dani'];
  const { room_code } = await createGame(ctx, host, {
    name: 'Noche de prueba',
    theme: 'house',
    initial_budget_cents: opts.budget ?? 2000,
    integer_bids: false, // los tests usan importes como 4,50 €; las pujas enteras tienen su propio test
    players: names.map((name) => ({ name })),
  });
  await ensureInitialImages(ctx, room_code, host);
  await performAction(ctx, room_code, host, { type: 'game.start' });
  const snap = await getHostState(ctx, room_code, host);
  return { room: room_code, snap };
}

/** Todos los jugadores necesitan imagen inicial para empezar (obligatoria): se les pone la de la galería si aún no la tienen. */
export async function ensureInitialImages(ctx: TestCtx, room: string, host: string): Promise<void> {
  const s = await getHostState(ctx, room, host);
  if (s.game.status !== 'lobby' || s.players.length === 0 || s.players.every((p) => p.current_image_version_id)) return;
  await performAction(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'house', scope_current: true, scope_new: false });
}

export const act = async (ctx: TestCtx, room: string, host: string, action: Record<string, unknown>) => {
  if (action.type === 'game.start') await ensureInitialImages(ctx, room, host);
  return performAction(ctx, room, host, action);
};

export const key = () => randomUUID();

export function playerByName(snap: HostSnapshot, name: string) {
  const p = snap.players.find((x) => x.name === name);
  if (!p) throw new Error(`jugador ${name} no encontrado`);
  return p;
}
