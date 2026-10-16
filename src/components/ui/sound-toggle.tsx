'use client';

import { Music, Volume2, VolumeX } from 'lucide-react';
import { arm, setPrefs } from '@/lib/audio/engine';
import { useAudioState } from '@/lib/audio/use-audio';

/**
 * Sonido de ESTE dispositivo: silenciar/activar, música (si aplica) y volumen.
 * Con el sonido activado pero el navegador sin permiso (hasta el primer gesto) muestra «Activar sonido».
 */
export function SoundToggle({ music = false, className = '', big = false, mutedByHost = false }: { music?: boolean; className?: string; big?: boolean; mutedByHost?: boolean }) {
  const a = useAudioState();
  const waiting = a.enabled && !a.armed;
  const btn = `inline-flex items-center gap-2 rounded-xl border border-white/15 bg-night-800 font-bold hover:border-gold ${big ? 'px-5 py-2.5 text-[1.2rem]' : 'px-3 py-2 text-sm'}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="sound-toggle">
      {waiting ? (
        <button type="button" onClick={() => void arm()} className={`${btn} !border-gold !bg-gold !text-night-950`} data-testid="sound-activate">
          <Volume2 className="size-4" aria-hidden /> Activar sonido
        </button>
      ) : (
        <button type="button" onClick={() => setPrefs({ enabled: !a.enabled })} aria-pressed={a.enabled} className={btn} data-testid="sound-switch" aria-label={a.enabled ? 'Silenciar el sonido en este dispositivo' : 'Activar el sonido en este dispositivo'}>
          {a.enabled ? <Volume2 className="size-4 text-gold" aria-hidden /> : <VolumeX className="size-4 text-white/60" aria-hidden />}
          {a.enabled ? 'Sonido' : 'Silencio'}
        </button>
      )}
      {mutedByHost ? (
        <span className="inline-flex items-center gap-2 rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-sm font-bold text-rose" role="status" data-testid="muted-by-host">
          <VolumeX className="size-4" aria-hidden /> Silenciado por el anfitrión
        </span>
      ) : null}
      {music && a.enabled ? (
        <button type="button" onClick={() => setPrefs({ music: !a.music })} aria-pressed={a.music} className={btn} data-testid="music-switch">
          <Music className={`size-4 ${a.music ? 'text-gold' : 'text-white/50'}`} aria-hidden /> Música {a.music ? 'sí' : 'no'}
        </button>
      ) : null}
      {a.enabled ? (
        <input type="range" min={0} max={100} value={Math.round(a.volume * 100)} onChange={(e) => setPrefs({ volume: Number(e.target.value) / 100 })} aria-label="Volumen" className="w-24 accent-[var(--color-gold)]" />
      ) : null}
    </div>
  );
}
