import { getRuntimeMode } from '@/lib/config/env';
import path from 'node:path';
import { demoDataDir } from '@/lib/services/context';
import { createLocalStorage } from '@/lib/storage/local';

const storage = createLocalStorage(path.join(demoDataDir(), 'images'));

/** Sirve imágenes del modo demo desde disco. Desactivado fuera del modo demo. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (getRuntimeMode() !== 'demo') return new Response('Not found', { status: 404 });
  const { path } = await params;
  try {
    const { bytes, mime } = await storage.get(path.map(decodeURIComponent).join('/'));
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        // El SVG de muestra no debe ejecutar scripts aunque se abra directamente.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
