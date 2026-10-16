import { OG_ALT, OG_SIZE, renderOg } from '@/lib/seo/og-image';
import { loadGameCard } from '@/lib/seo/site';

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return renderOg('invite', await loadGameCard(code.toUpperCase()));
}
