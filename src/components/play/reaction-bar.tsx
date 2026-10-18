'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { ApiError, sendReactionRequest } from '@/lib/client/api';
import { REACTION_EMOJIS } from '@/lib/domain/schemas';

/** Fila de reacciones: cada toque manda un emoji que flota por la TV. Máx. 1 cada 1,5 s (lo impone también el servidor). */
export function ReactionBar({ roomCode, onNotPlayer }: { roomCode: string; onNotPlayer: () => void }) {
  const toast = useToast();
  const [cool, setCool] = useState(false);
  const [said, setSaid] = useState('');

  async function send(emoji: string) {
    if (cool) return;
    setCool(true);
    setTimeout(() => setCool(false), 1600);
    try {
      await sendReactionRequest(roomCode, emoji);
      setSaid(`Reacción ${emoji} enviada`);
      setTimeout(() => setSaid(''), 2500);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_player') return onNotPlayer();
      if (e instanceof ApiError && e.code === 'reaction_too_fast') return; // el enfriamiento local ya avisa
      toast.error(e instanceof ApiError ? e.message : 'No se pudo enviar la reacción.');
    }
  }

  return (
    <section aria-label="Reacciones a la tele" data-testid="reaction-bar" className="rounded-3xl border border-white/10 bg-night-800 p-3">
      <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-white/60">Reacciona en la tele</p>
      <div className="flex flex-wrap justify-center gap-2">
        {REACTION_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            aria-disabled={cool || undefined} // no `disabled`: si no, el botón con el foco lo pierde durante el enfriamiento
            onClick={() => send(e)}
            aria-label={`Reaccionar ${e}`}
            className="inline-flex size-12 items-center justify-center rounded-2xl bg-night-700 text-2xl transition active:scale-90 hover:bg-night-600 aria-disabled:opacity-50 aria-disabled:hover:bg-night-700"
          >
            <span aria-hidden>{e}</span>
          </button>
        ))}
      </div>
      <p role="status" className="sr-only">{said}</p>
    </section>
  );
}
