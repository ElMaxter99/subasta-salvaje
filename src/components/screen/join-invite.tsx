'use client';

import { useSyncExternalStore } from 'react';
import { Smartphone } from 'lucide-react';
import { QrCode } from '@/components/ui/qr-code';

const noopSubscribe = () => () => {};

/** Origen del navegador (cadena vacía en servidor: evita problemas de hidratación). */
function useOrigin(): string {
  return useSyncExternalStore(noopSubscribe, () => window.location.origin, () => '');
}

function subscribeResize(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

/** Tamaño en px de `rems` según el rem actual de la TV (QrCode pide px). */
function useRem(rems: number): number {
  return useSyncExternalStore(
    subscribeResize,
    () => Math.round(rems * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)),
    () => rems * 16,
  );
}

function hostOf(origin: string) {
  return origin.replace(/^https?:\/\//, '');
}

/** Panel grande de la sala de espera (modo móviles). */
export function LobbyInvite({ roomCode, connected, total }: { roomCode: string; connected: number; total: number }) {
  const origin = useOrigin();
  const qr = useRem(17);
  const url = origin ? `${origin}/game/${roomCode}/play` : '';
  return (
    <div className="flex h-full max-h-full items-center justify-center gap-[4rem]" aria-live="polite">
      <div className="flex min-w-0 flex-col items-start text-left">
        <p className="flex items-center gap-4 font-display text-[3.6rem] leading-tight text-white">
          <Smartphone className="size-[3.4rem] text-teal" aria-hidden /> Únete desde tu móvil
        </p>
        <p className="mt-[0.6rem] text-[1.3rem] font-bold uppercase tracking-[0.3em] text-white/55">Código de sala</p>
        <p className="font-display text-[8.5rem] leading-none tracking-[0.2em] text-gold drop-shadow-[0_0_2rem_rgb(251_191_36/0.4)]">{roomCode}</p>
        <p className="mt-[0.8rem] text-[1.6rem] font-semibold text-white/80">
          Entra en <strong className="text-white">{origin ? `${hostOf(origin)}/join` : '…/join'}</strong> y escribe el código
        </p>
        <p className="mt-[1rem] rounded-full bg-night-800/90 px-6 py-2 text-[1.8rem] font-black text-teal" data-testid="connected-count">
          {connected}/{total} {total === 1 ? 'jugador conectado' : 'jugadores conectados'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-3">
        {url ? <QrCode value={url} size={qr} className="shadow-[0_0_3rem_rgb(255_255_255/0.2)]" /> : <div style={{ width: qr, height: qr }} />}
        <p className="text-[1.2rem] font-bold uppercase tracking-[0.25em] text-white/60">Escanea para entrar</p>
      </div>
    </div>
  );
}

/** Versión discreta (QR pequeño + código) para la cabecera con la partida en marcha. */
export function CompactInvite({ roomCode }: { roomCode: string }) {
  const origin = useOrigin();
  const qr = useRem(4.6);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-night-900/70 py-1 pl-3 pr-1" aria-label={`Únete desde el móvil con el código ${roomCode}`}>
      <div className="text-right leading-tight">
        <p className="text-[0.8rem] font-bold uppercase tracking-[0.2em] text-white/55">Únete · móvil</p>
        <p className="font-display text-[1.5rem] tracking-[0.15em] text-gold-soft">{roomCode}</p>
      </div>
      {origin ? <QrCode value={`${origin}/game/${roomCode}/play`} size={qr} className="!rounded-lg !p-1" /> : <div style={{ width: qr, height: qr }} />}
    </div>
  );
}

/** Discreto: QR pequeño al enlace de espectador (solo lectura) para seguir la partida desde casa. Se oculta si el anfitrión lo desactiva. */
export function SpectatorBadge({ roomCode, enabled = true, className = '' }: { roomCode: string; enabled?: boolean; className?: string }) {
  const origin = useOrigin();
  const qr = useRem(5);
  if (!enabled) return null;
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-white/10 bg-night-900/80 py-1 pl-3 pr-1 ${className}`} data-testid="tv-spectator" aria-label="Seguir la partida como espectador, solo lectura">
      <div className="leading-tight">
        <p className="text-[0.85rem] font-bold uppercase tracking-[0.2em] text-white/70">Mirar desde casa</p>
        <p className="text-[0.95rem] font-semibold text-white/70">Escanea · solo lectura</p>
      </div>
      {origin ? <QrCode value={`${origin}/game/${roomCode}/watch`} size={qr} label="Código QR para seguir la partida como espectador" className="!rounded-lg !p-1" /> : <div style={{ width: qr, height: qr }} />}
    </div>
  );
}
