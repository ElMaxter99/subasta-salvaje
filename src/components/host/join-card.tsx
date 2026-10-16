'use client';

import { useState, useSyncExternalStore } from 'react';
import { Check, Copy, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QrCode, joinUrl } from '@/components/ui/qr-code';
import { useToast } from '@/components/ui/toast';
import { Card } from './bits';
import type { HostCtx } from './host-context';

/** Tarjeta «Unirse desde el móvil»: sólo en modalidad móviles. */
export function JoinCard({ ctx }: { ctx: HostCtx }) {
  const { roomCode, snapshot } = ctx;
  const toast = useToast();
  const url = useSyncExternalStore(
    () => () => {},
    () => joinUrl(roomCode),
    () => '',
  );
  const [copied, setCopied] = useState(false);
  if (snapshot.game.play_mode !== 'mobile') return null;
  const total = snapshot.players.length;
  const connected = snapshot.players.filter((p) => p.claimed).length;

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
    toast.success('Enlace para jugadores copiado');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card title="Unirse desde el móvil" icon={<Smartphone className="size-5 text-gold" aria-hidden />} className="border-gold/30">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="shrink-0">{url ? <QrCode value={url} size={168} /> : <div className="size-[168px] rounded-2xl bg-white/10" aria-hidden />}</div>
        <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
          <p className="text-xs font-bold uppercase tracking-wide text-white/60">Código de sala</p>
          <p className="font-mono text-5xl font-bold tracking-[0.2em] text-gold" aria-label={`Código de sala ${roomCode.split('').join(' ')}`}>
            {roomCode}
          </p>
          <p className="break-all text-sm text-white/70">{url || 'Cargando enlace…'}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <Button size="md" variant="secondary" onClick={copy} disabled={!url}>
              {copied ? <Check className="size-4 text-teal" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? 'Copiado' : 'Copiar enlace'}
            </Button>
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold" aria-live="polite">
              {connected} de {total} jugadores conectados
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
