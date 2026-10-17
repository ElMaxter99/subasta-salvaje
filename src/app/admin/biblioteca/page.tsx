import { LibraryPanel } from '@/components/admin/library-panel';
import { requireSuperadmin } from '@/lib/auth/host';
import { libraryUploadsEnabled } from '@/lib/services/library-service';

export const metadata = { title: 'Superadmin · Biblioteca' };

export default async function LibraryPage() {
  await requireSuperadmin();
  return <LibraryPanel uploadsEnabled={libraryUploadsEnabled()} />;
}
