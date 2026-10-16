import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminGames, adminSettings } from '@/lib/services/admin-service';
import { effectiveTtlHours } from '@/lib/services/settings';
import { GamesPanel } from '@/components/admin/games-panel';

export const metadata = { title: 'Superadmin · Partidas' };

export default async function GamesPage() {
  await requireSuperadmin();
  const ctx = await getContext();
  const [games, settings] = await Promise.all([adminGames(ctx), adminSettings(ctx)]);
  return <GamesPanel games={games} ttlHours={effectiveTtlHours(settings)} />;
}
