import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, searchEmojis } from '@/lib/domain/emoji-list';

describe('selector de emojis', () => {
  it('busca por palabra clave sin distinguir acentos ni mayúsculas', () => {
    expect(searchEmojis('pina')).toContain('🍍');
    expect(searchEmojis('Murciélago')).toContain('🦇');
    expect(searchEmojis('barca')).toContain('🚣');
    expect(searchEmojis('')).toEqual([]);
  });
  it('no repite emojis dentro de una categoría y cada entrada tiene un emoji', () => {
    for (const c of EMOJI_CATEGORIES) {
      const list = c.items.map(([e]) => e);
      expect(new Set(list).size).toBe(list.length);
      expect(c.items.length).toBeGreaterThan(5);
    }
  });
});
