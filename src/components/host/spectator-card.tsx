'use client';

import { useState, useSyncExternalStore } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QrCode } from '@/components/ui/qr-code';
import { useToast } from '@/components/ui/toast';
import type { HostCtx } from './host-context';

/** Enlace de espectador (solo lectura) para seguir la partida desde casa u otro móvil, con QR y interruptor por partida. */
export function SpectatorCard({ ctx }: { ctx: HostCtx }) {
  const { roomCode, snapshot, busy, run } = ctx;
  const toast = useToast();
  const on = snapshot.game.spectator_enabled !== false;
  const url = useSyncExternalStore(
    () => () => {},
    () => `${window.location.origin}/game/${roomCode}/watch`,
    () => '',
  );
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) return toast.error(`No se pudo copiar. Enlace: ${url}`);
    }
    setCopied(true);
    toast.success('Enlace de espectador copiado');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <details className="rounded-2xl border border-white/10 bg-night-800/60" data-testid="spectator-card">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-bold text-violet-soft">
        {on ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />} Modo espectador · {on ? 'activo' : 'desactivado'}
      </summary>
      <div className="flex flex-col items-center gap-3 px-3 pb-3 sm:flex-row sm:items-start">
        {on && url ? <QrCode value={url} size={132} label="Código QR del enlace de espectador" /> : null}
        <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
          <p className="text-sm text-white/75">
            {on ? 'Cualquiera con este enlace puede seguir la subasta en directo desde su móvil. Solo lectura: no puede pujar ni ver nada privado.' : 'El enlace de espectador está desactivado: quien lo abra verá un aviso.'}
          </p>
          {on ? <p className="break-all text-xs text-white/70">{url}</p> : null}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {on ? (
              <Button size="md" variant="secondary" onClick={copy} disabled={!url} data-testid="spectator-copy">
                {copied ? <Check className="size-4 text-teal" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? 'Copiado' : 'Copiar enlace de espectador'}
              </Button>
            ) : null}
            <Button
              size="md"
              variant="secondary"
              disabled={busy !== null}
              aria-pressed={on}
              data-testid="spectator-toggle"
              onClick={() => run('spectator', { type: 'game.set_spectator', spectator_enabled: !on }, on ? 'Modo espectador desactivado' : 'Modo espectador activado')}
            >
              {on ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}
