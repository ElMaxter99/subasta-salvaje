'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiError, sendAction, type ActionResponse } from '@/lib/client/api';
import type { GameAction } from '@/lib/domain/schemas';
import type { HostSnapshot, RuntimeInfo } from '@/lib/domain/types';
import { useToast } from '@/components/ui/toast';

/** Todo lo que necesitan las secciones del panel. */
export interface HostCtx {
  roomCode: string;
  snapshot: HostSnapshot;
  runtime: RuntimeInfo;
  /** Clave de la petición en curso (null = libre). Mientras haya una, el resto de botones se bloquean. */
  busy: string | null;
  /** Envía una acción. Devuelve null si falla (el error ya se mostró en un toast). */
  run: (key: string, action: GameAction, success?: string) => Promise<ActionResponse | null>;
  /** Igual que run pero para cualquier petición que devuelva un snapshot (p. ej. subida de archivos). */
  exec: (key: string, fn: () => Promise<ActionResponse>, success?: string) => Promise<ActionResponse | null>;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'No se pudo conectar con el servidor. Revisa tu conexión: no se ha perdido nada, puedes volver a intentarlo.';
}

export function useHostRunner(roomCode: string, apply: (s: HostSnapshot) => void, refresh: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);

  const exec = useCallback(
    async (key: string, fn: () => Promise<ActionResponse>, success?: string) => {
      if (lock.current) return null;
      lock.current = true;
      setBusy(key);
      try {
        const res = await fn();
        apply(res.snapshot);
        if (success) toast.success(success);
        return res;
      } catch (e) {
        toast.error(errorMessage(e));
        void refresh();
        return null;
      } finally {
        lock.current = false;
        setBusy(null);
      }
    },
    [apply, refresh, toast],
  );

  const run = useCallback((key: string, action: GameAction, success?: string) => exec(key, () => sendAction(roomCode, action), success), [exec, roomCode]);
  return { busy, run, exec };
}

export function playerById(s: HostSnapshot, id: string | null | undefined) {
  return id ? s.players.find((p) => p.id === id) : undefined;
}
