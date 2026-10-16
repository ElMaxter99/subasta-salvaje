import { catalogSceneSvg } from '@/lib/ai/catalog-scenes';

/** Vista previa pública de las imágenes iniciales de la galería (contenido estático, sin datos de partidas). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const svg = catalogSceneSvg(id);
  if (!svg) return new Response('Not found', { status: 404 });
  return new Response(svg as BodyInit, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
}
