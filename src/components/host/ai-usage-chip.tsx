import { Sparkles } from 'lucide-react';
import type { ImageUsage } from '@/lib/domain/types';

/** Indicador SIEMPRE visible de generaciones reales de IA usadas (solo en partidas con IA). */
export function AiUsageChip({ usage }: { usage: ImageUsage | undefined }) {
  if (!usage?.limited) return null;
  const pct = (used: number, limit: number | null) => (limit ? used / limit : 0);
  const worst = Math.max(pct(usage.game_used, usage.game_limit), pct(usage.day_used, usage.day_limit));
  const tone = worst >= 1 ? 'bg-rose text-night-950' : worst >= 0.8 ? 'bg-gold text-night-950' : 'bg-night-700 text-white';
  const label = `IA: ${usage.game_used}/${usage.game_limit} en esta partida · ${usage.day_used}/${usage.day_limit} hoy`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${tone}`}
      title={worst >= 1 ? 'Cuota alcanzada: los trabajos nuevos fallarán y la partida sigue con las imágenes actuales' : 'Generaciones reales usadas / límite'}
      aria-label={label}
      data-testid="ai-usage-chip"
    >
      <Sparkles className="size-3.5" aria-hidden />
      IA {usage.game_used}/{usage.game_limit} · hoy {usage.day_used}/{usage.day_limit}
    </span>
  );
}
