import type { ImageStorage } from '@/lib/storage/types';

/** Añade URLs públicas a todo `storage_path` / `image_path` de una instantánea. */
export function attachUrls<T>(snapshot: T, storage: Pick<ImageStorage, 'publicUrl'>): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      if (typeof out.storage_path === 'string') out.url = storage.publicUrl(out.storage_path);
      if (typeof out.image_path === 'string') out.image_url = storage.publicUrl(out.image_path);
      return out;
    }
    return node;
  };
  return walk(snapshot) as T;
}
