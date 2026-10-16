import type { GameAction } from '@/lib/domain/schemas';
import type { HostSnapshot } from '@/lib/domain/types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  }
  return data as T;
}

export interface ActionResponse {
  result: Record<string, unknown>;
  snapshot: HostSnapshot;
}

/** Envía una acción del anfitrión. Devuelve el estado actualizado (para aplicarlo de inmediato). */
export async function sendAction(roomCode: string, action: GameAction | (Record<string, unknown> & { type: string })): Promise<ActionResponse> {
  const res = await fetch(`/api/games/${roomCode}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  return parse<ActionResponse>(res);
}

/** playerId = 'all' aplica la imagen a todos los jugadores. */
export async function uploadInitialImage(roomCode: string, playerId: string, file: File): Promise<ActionResponse> {
  const form = new FormData();
  form.set('player_id', playerId);
  form.set('file', file);
  const res = await fetch(`/api/games/${roomCode}/initial-image`, { method: 'POST', body: form });
  return parse<ActionResponse>(res);
}

/** Pide al servidor que procese la cola de imágenes de la partida (responde 202 de inmediato). */
export async function kickJobs(roomCode: string): Promise<void> {
  await parse(await fetch(`/api/games/${roomCode}/jobs`, { method: 'POST' }));
}

export async function createGameRequest(body: unknown): Promise<{ room_code: string }> {
  const res = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return parse<{ room_code: string }>(res);
}

export async function demoLogin(): Promise<void> {
  await parse(await fetch('/api/auth/demo', { method: 'POST' }));
}

export const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Sólo demo: crea una partida de ejemplo. */
export async function seedDemo(stage: 'lobby' | 'bidding' | 'midgame' | 'finished' | 'failedjob' = 'midgame'): Promise<{ room_code: string }> {
  const res = await fetch('/api/dev/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
  return parse<{ room_code: string }>(res);
}
