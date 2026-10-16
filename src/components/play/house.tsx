'use client';

import { useState } from 'react';
import { Home, Hammer } from 'lucide-react';
import type { Player } from '@/lib/domain/types';

interface Layers {
  front: string | null;
  back: string | null;
  loaded: boolean;
}

/** Casa del jugador con cross-fade al cambiar la imagen. */
export function MyHouse({ player }: { player: Player }) {
  const url = player.current_image?.url ?? null;
  const [layers, setLayers] = useState<Layers>({ front: url, back: null, loaded: true });
  if (url !== layers.front) setLayers({ front: url, back: layers.front, loaded: false });
  const done = () => {
    setLayers((l) => (l.loaded ? l : { ...l, loaded: true }));
    window.setTimeout(() => setLayers((l) => (l.loaded && l.back ? { ...l, back: null } : l)), 1000);
  };
  const building = player.generating[0];

  return (
    <section aria-label="Tu casa" className="space-y-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl border border-white/10 bg-night-800">
        {layers.back ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={layers.back} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
        ) : null}
        {layers.front ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={layers.front}
            ref={(el) => {
              if (el && el.complete && el.naturalWidth > 0 && !layers.loaded) queueMicrotask(done);
            }}
            src={layers.front}
            alt={`Casa de ${player.name}`}
            onLoad={done}
            onError={done}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-in-out ${layers.loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
            <Home className="size-10" aria-hidden />
            <span className="text-sm font-semibold">Tu casa aún no tiene imagen</span>
          </div>
        )}
        {building ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-night-950/80 px-4 py-2.5 text-sm font-bold text-gold" role="status">
            <Hammer className="size-4 animate-pulse" aria-hidden />
            Construyendo {building.item_name ?? 'tu mejora'}…
          </div>
        ) : null}
      </div>
    </section>
  );
}
