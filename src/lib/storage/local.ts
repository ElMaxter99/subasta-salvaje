import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mimeForPath, type ImageStorage } from './types';

/** Almacenamiento en disco para el modo demo (nunca se usa en producción). */
export function createLocalStorage(root = path.join(/* turbopackIgnore: true */ process.cwd(), '.demo-data', 'images')): ImageStorage {
  const resolve = (storagePath: string) => {
    const full = path.resolve(root, storagePath);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('Ruta no válida');
    return full;
  };
  return {
    async put(storagePath, bytes) {
      const full = resolve(storagePath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    async get(storagePath) {
      const bytes = await readFile(resolve(storagePath));
      return { bytes: new Uint8Array(bytes), mime: mimeForPath(storagePath) };
    },
    async deletePrefix(prefix) {
      const dir = resolve(prefix.replace(/\/$/, ''));
      await rm(dir, { recursive: true, force: true });
      return 1;
    },
    publicUrl(storagePath) {
      return `/api/demo-images/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}

export function createMemoryStorage(): ImageStorage & { files: Map<string, { bytes: Uint8Array; mime: string }> } {
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    files,
    async put(p, bytes, mime) {
      files.set(p, { bytes, mime });
    },
    async get(p) {
      const f = files.get(p);
      if (!f) throw new Error('archivo no encontrado');
      return f;
    },
    async deletePrefix(prefix) {
      let n = 0;
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) { files.delete(k); n++; }
      return n;
    },
    publicUrl: (p) => `memory://${p}`,
  };
}
