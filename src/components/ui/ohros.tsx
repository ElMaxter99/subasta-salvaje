import { ItemIcon } from '@/components/mascot/mascot';
import { formatAmount, formatOhros } from '@/lib/domain/money';

/**
 * Importe en Ohros: el número seguido de la moneda del juego (icono). Para lectores de pantalla se lee «12 Ohros».
 * Para textos sin elementos (avisos, atributos, placeholders) usa `formatOhros`.
 */
export function Ohros({ cents, className = '' }: { cents: number; className?: string }) {
  return (
    <span role="img" aria-label={formatOhros(cents)} className={`inline-flex items-center gap-[0.2em] whitespace-nowrap ${className}`}>
      <span aria-hidden>{formatAmount(cents)}</span>
      <ItemIcon variant="item-moneda" className="!h-[0.95em]" />
    </span>
  );
}
