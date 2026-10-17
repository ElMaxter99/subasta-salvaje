import { LibraryTabs } from '@/components/admin/library-tabs';
import { LibraryPanel } from '@/components/admin/library-panel';
import { requireSuperadmin } from '@/lib/auth/host';
import { libraryUploadsEnabled } from '@/lib/services/library-service';

export const metadata = { title: 'Superadmin · Imágenes' };

export default async function LibraryPage() {
  await requireSuperadmin();
  return (
    <div className="space-y-5">
      <LibraryTabs current="images" />
      <LibraryPanel uploadsEnabled={libraryUploadsEnabled()} />
    </div>
  );
}
