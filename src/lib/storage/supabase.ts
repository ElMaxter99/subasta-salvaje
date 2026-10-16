import { getSupabaseConfig } from '@/lib/config/env';
import { getSupabaseAdmin } from '@/lib/db/supabase';
import type { ImageStorage } from './types';

export function createSupabaseStorage(): ImageStorage {
  const cfg = getSupabaseConfig();
  const bucket = () => getSupabaseAdmin().storage.from(cfg.bucket);
  return {
    async put(storagePath, bytes, mime) {
      const { error } = await bucket().upload(storagePath, bytes, { contentType: mime, upsert: false, cacheControl: '31536000' });
      if (error) throw new Error(`Storage: ${error.message}`);
    },
    async get(storagePath) {
      const { data, error } = await bucket().download(storagePath);
      if (error || !data) throw new Error(`Storage: ${error?.message ?? 'archivo no encontrado'}`);
      return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || 'application/octet-stream' };
    },
    publicUrl(storagePath) {
      return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}
