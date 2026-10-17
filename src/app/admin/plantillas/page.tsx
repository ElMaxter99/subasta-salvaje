import { SystemTemplatesPanel } from '@/components/admin/system-templates-panel';
import { requireSuperadmin } from '@/lib/auth/host';
import { assetCdnHosts } from '@/lib/config/env';
import { getContext } from '@/lib/services/context';
import { listSystemTemplates } from '@/lib/services/system-template-service';

export const metadata = { title: 'Superadmin · Plantillas' };

export default async function SystemTemplatesPage() {
  await requireSuperadmin();
  const templates = await listSystemTemplates(await getContext(), { admin: true });
  return <SystemTemplatesPanel templates={templates} cdnHosts={assetCdnHosts()} />;
}
