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
    async deleteFiles(paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await bucket().remove(paths.slice(i, i + 100));
        if (error) throw new Error(`Storage: ${error.message}`);
      }
      return paths.length;
    },
    async deletePrefix(prefix) {
      // Lista recursivamente (las «carpetas» devuelven id null) y borra por lotes.
      const files: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await bucket().list(dir, { limit: 1000, offset });
          if (error) throw new Error(`Storage: ${error.message}`);
          if (!data || data.length === 0) break;
          for (const entry of data) {
            const full = `${dir}/${entry.name}`;
            if (entry.id) files.push(full);
            else await walk(full);
          }
          if (data.length < 1000) break;
        }
      };
      await walk(prefix.replace(/\/$/, ''));
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await bucket().remove(files.slice(i, i + 100));
        if (error) throw new Error(`Storage: ${error.message}`);
      }
      return files.length;
    },
    publicUrl(storagePath) {
      return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}
