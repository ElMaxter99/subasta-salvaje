import type { CSSProperties } from 'react';
import { miniHeroSvg, type MiniMood } from '@/lib/brand/mini-hero';
import type { MascotId } from './assets';

/** Gesto del mini héroe para cada id de mascota heredado. */
export function moodFor(variant: MascotId): MiniMood {
  switch (variant) {
    case 'expr-triste': return 'sad';
    case 'expr-sorprendido': case 'pose-anuncia': case 'pose-cuenta-atras': return 'wow';
    case 'expr-guino': return 'wink';
    case 'expr-celebrando': case 'expr-hype': case 'pose-celebra': case 'pose-adjudica': return 'cheer';
    case 'expr-enfadado': return 'angry';
    default: return 'happy';
  }
}

const cache = new Map<string, string>();
const svg = (mood: MiniMood, body: boolean) => {
  const k = `${mood}:${body}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = miniHeroSvg(mood, { body })));
  return s;
};

/**
 * Mini héroe vectorial (≈ 1 KB, sin imágenes que cargar) para tamaños pequeños. Decorativo por defecto (`aria-hidden`).
 * El tamaño sale de `height` en CSS (por defecto 1em), así que se puede usar dentro de texto o con `--mh`.
 */
export function MiniHero({ mood = 'happy', body = false, className = '', style, title }: { mood?: MiniMood; body?: boolean; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <span
      className={`inline-block aspect-square shrink-0 [&>svg]:size-full ${className}`}
      style={{ height: '1em', ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-mini-hero={mood}
      // Cadena estática generada por nuestro propio código (sin datos del usuario)
      dangerouslySetInnerHTML={{ __html: svg(mood, body) }}
    />
  );
}
