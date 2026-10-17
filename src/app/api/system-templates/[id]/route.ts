import { handle, json } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { getSystemTemplate } from '@/lib/services/system-template-service';

/** Una partida del sistema publicada (para cargarla en el asistente). Un borrador responde «no existe». */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireHost();
  const { id } = await params;
  return json(await getSystemTemplate(await getContext(), id));
});
