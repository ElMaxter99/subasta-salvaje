'use client';

import { Music, Volume2, VolumeX } from 'lucide-react';
import { SoundToggle } from '@/components/ui/sound-toggle';
import type { HostCtx } from './host-context';

/**
 * Sonido desde el panel del anfitrión:
 *  · «Sonido de la TV» y «Música de la TV»: interruptores de la PARTIDA (los ve la TV en su siguiente lectura), por si necesitas
 *    hablar o controlar algo sin tocar la tele.
 *  · «Este dispositivo»: el sonido del propio panel (clics y avisos), solo en este navegador.
 */
export function HostSoundControls({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const { game } = snapshot;
  const fx = game.sound_enabled !== false;
  const music = game.music_enabled !== false;
  const chip = (on: boolean) => `inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-60 ${on ? 'border-gold/60 bg-gold/15 text-gold' : 'border-white/15 bg-night-800 text-white/70'}`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="host-sound">
      <span className="text-xs font-bold uppercase tracking-wide text-white/55">TV</span>
      <button type="button" className={chip(fx)} disabled={busy !== null} aria-pressed={fx} data-testid="tv-sound-switch" onClick={() => run('sound', { type: 'game.set_sound', sound_enabled: !fx }, fx ? 'Sonido de la TV silenciado' : 'Sonido de la TV activado')}>
        {fx ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />} {fx ? 'Sonido' : 'Silenciada'}
      </button>
      <button type="button" className={chip(music)} disabled={busy !== null} aria-pressed={music} data-testid="tv-music-switch" onClick={() => run('sound', { type: 'game.set_sound', music_enabled: !music }, music ? 'Música de la TV desactivada' : 'Música de la TV activada')}>
        <Music className="size-4" aria-hidden /> Música {music ? 'sí' : 'no'}
      </button>
      <span className="ml-2 text-xs font-bold uppercase tracking-wide text-white/55">Este dispositivo</span>
      <SoundToggle />
    </div>
  );
}
