import { LibraryItems } from '@/components/admin/library-items';
import { LibraryTabs } from '@/components/admin/library-tabs';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { libraryUploadsEnabled } from '@/lib/services/library-service';

export const metadata = { title: 'Superadmin · Catálogo' };

export default async function CatalogPage() {
  await requireSuperadmin();
  const runtime = getRuntimeInfo(await getContext());
  return (
    <div className="space-y-5">
      <LibraryTabs current="items" />
      <LibraryItems aiConfigured={runtime.aiConfigured} uploadsEnabled={libraryUploadsEnabled()} />
    </div>
  );
}
