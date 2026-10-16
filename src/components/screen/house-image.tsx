'use client';

import { useState } from 'react';
import { Home } from 'lucide-react';
import type { ImageRef } from '@/lib/domain/types';

interface Layers {
  front: string | null;
  back: string | null;
  loaded: boolean;
}

/**
 * Imagen con cross-fade: la nueva versión se carga encima de la anterior y solo se muestra
 * (con fundido) cuando ya está descargada; así no hay parpadeos ni huecos.
 */
export function HouseImage({
  image,
  alt,
  emptyLabel = 'Sin imagen todavía',
  className = '',
}: {
  image: ImageRef | null | undefined;
  alt: string;
  emptyLabel?: string;
  className?: string;
}) {
  const url = image?.url ?? null;
  const [layers, setLayers] = useState<Layers>({ front: url, back: null, loaded: true });
  if (url !== layers.front) setLayers({ front: url, back: layers.front, loaded: false });

  const done = () => {
    setLayers((l) => (l.loaded ? l : { ...l, loaded: true }));
    window.setTimeout(() => setLayers((l) => (l.loaded && l.back ? { ...l, back: null } : l)), 1000);
  };

  return (
    <div className={`overflow-hidden bg-night-800 ${className}`}>
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
          alt={alt}
          onLoad={done}
          onError={done}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-in-out ${layers.loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.03)_0_14px,transparent_14px_28px)] text-white/50">
          <Home className="size-[18%] min-h-6 min-w-6" aria-hidden />
          <span className="text-[1rem] font-semibold">{emptyLabel}</span>
        </div>
      )}
    </div>
  );
}
