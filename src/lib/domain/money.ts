/** Todos los importes se manejan en céntimos enteros (100 = 1 Ohro). La moneda del juego se llama «Ohros» (1 Ohro, 2 Ohros). */
const num = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numWhole = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

/** Nombre de la moneda según la cantidad: «Ohro» solo para exactamente 1; «Ohros» en el resto (0, 1,5, 2…). */
export const ohrosUnit = (cents: number): string => (Math.abs(cents) === 100 ? 'Ohro' : 'Ohros');

/** Solo el número («12» o «1,50»), para mostrarlo junto al icono de la moneda. */
export function formatAmount(cents: number): string {
  return cents % 100 === 0 ? numWhole.format(cents / 100) : num.format(cents / 100);
}

/** Texto completo: «1 Ohro», «12 Ohros», «1,50 Ohros». */
export function formatOhros(cents: number): string {
  return `${formatAmount(cents)} ${ohrosUnit(cents)}`;
}

/** Redondea hacia arriba a Ohros enteros cuando la partida solo admite pujas enteras. */
export function wholeUp(cents: number, integerOnly: boolean | undefined): number {
  return integerOnly ? Math.ceil(cents / 100) * 100 : cents;
}

/** Convierte texto del usuario ("12", "12,5", "12.50", "12 Ohros") a céntimos. Devuelve null si no es válido. */
export function parseOhrosToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(/ohros?$/i, '').replace('€', '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = '0', frac = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
