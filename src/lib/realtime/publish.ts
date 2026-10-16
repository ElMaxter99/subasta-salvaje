import { getSupabaseConfig } from '@/lib/config/env';

/** Avisa a los clientes de que la partida cambió. La BD sigue siendo la fuente de verdad. */
export interface Publisher {
  publish(roomCode: string, version: number): Promise<void>;
}

export const noopPublisher: Publisher = { async publish() {} };

export const channelName = (roomCode: string) => `game:${roomCode.toUpperCase()}`;

/**
 * Broadcast de Supabase Realtime vía REST (compatible con serverless: no hay sockets de larga duración).
 * Un fallo aquí nunca rompe la operación: los clientes también hacen polling de seguridad.
 */
export function createSupabasePublisher(): Publisher {
  return {
    async publish(roomCode, version) {
      const cfg = getSupabaseConfig();
      try {
        await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` },
          body: JSON.stringify({ messages: [{ topic: channelName(roomCode), event: 'changed', payload: { version }, private: false }] }),
          signal: AbortSignal.timeout(4000),
        });
      } catch (e) {
        console.warn('[realtime] broadcast fallido (el polling cubrirá el cambio):', (e as Error).message);
      }
    },
  };
}
