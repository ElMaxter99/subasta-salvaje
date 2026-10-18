import Link from 'next/link';
import { AiAuditView } from '@/components/admin/ai-audit';
import { requireSuperadmin } from '@/lib/auth/host';
import { getAiAudit } from '@/lib/services/ai-audit-service';
import { getContext } from '@/lib/services/context';

export const metadata = { title: 'Superadmin · IA' };

export default async function AiAuditPage({ searchParams }: { searchParams: Promise<{ refresh?: string }> }) {
  await requireSuperadmin();
  const sp = await searchParams;
  const audit = await getAiAudit(await getContext(), sp.refresh === '1');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/65">
        <p>Datos leídos en solo lectura de cada proveedor con las claves del servidor (caché de 60 s). Actualizado: {new Date(audit.generatedAt).toLocaleString('es-ES')}.</p>
        <div className="flex gap-2">
          <Link href="/admin/ia/comparar" className="rounded-xl bg-gold px-3 py-2 font-bold text-night-950 hover:brightness-110">Comparar modelos</Link>
          <Link href="/admin/ia?refresh=1" className="rounded-xl bg-white/10 px-3 py-2 font-bold hover:bg-white/15">Actualizar ahora</Link>
        </div>
      </div>
      <AiAuditView audit={audit} />
    </div>
  );
}
