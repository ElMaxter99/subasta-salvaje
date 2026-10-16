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
export async function uploadInitialImage(roomCode: string, playerId: string, file: File, scope?: { current: boolean; new: boolean }): Promise<ActionResponse> {
  const form = new FormData();
  form.set('player_id', playerId);
  if (scope) {
    form.set('scope_current', String(scope.current));
    form.set('scope_new', String(scope.new));
  }
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

/* ---------- Jugadores desde el móvil (modo «móviles») ---------- */

export async function joinGameRequest(roomCode: string, body: { player_id: string } | { name: string }): Promise<{ player_id: string; snapshot: import('@/lib/domain/types').PublicSnapshot }> {
  const res = await fetch(`/api/play/${roomCode}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return parse(res);
}

export async function playerBidRequest(roomCode: string, auctionId: string, amountCents: number, idempotencyKey: string = newIdempotencyKey()): Promise<{ snapshot: import('@/lib/domain/types').PublicSnapshot; player_id: string | null }> {
  const res = await fetch(`/api/play/${roomCode}/bid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auction_id: auctionId, amount_cents: amountCents, idempotency_key: idempotencyKey }),
  });
  return parse(res);
}

export async function leaveGameRequest(roomCode: string): Promise<void> {
  await parse(await fetch(`/api/play/${roomCode}/leave`, { method: 'POST' }));
}

export async function fetchMe(roomCode: string): Promise<string | null> {
  const res = await parse<{ player_id: string | null }>(await fetch(`/api/play/${roomCode}/me`, { cache: 'no-store' }));
  return res.player_id;
}

/** Borra la partida (irreversible). Sólo el anfitrión propietario. */
export async function deleteGameRequest(roomCode: string): Promise<void> {
  await parse(await fetch(`/api/games/${roomCode}`, { method: 'DELETE' }));
}
