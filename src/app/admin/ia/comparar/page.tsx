import Link from 'next/link';
import { AiCompare } from '@/components/admin/ai-compare';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { MAX_COMPARE_PROVIDERS, comparableProviders } from '@/lib/services/compare-service';
import { getSettings } from '@/lib/services/settings';

export const metadata = { title: 'Superadmin · Comparar modelos' };

export default async function AiComparePage() {
  await requireSuperadmin();
  const ctx = await getContext();
  const settings = await getSettings(ctx.db);
  const off = settings.ai_providers_off ?? [];
  const providers = ctx.provider && settings.ai_enabled ? comparableProviders() : [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/65"><Link href="/admin/ia" className="font-bold text-violet-soft hover:underline">← Uso de la IA</Link></p>
      <AiCompare providers={providers.map((id) => ({ id, off: off.includes(id) }))} aiEnabled={settings.ai_enabled} max={MAX_COMPARE_PROVIDERS} />
    </div>
  );
}
