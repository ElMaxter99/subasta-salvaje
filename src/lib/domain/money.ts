/** Todos los importes se manejan en céntimos enteros. */
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const eurWhole = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatEuros(cents: number): string {
  return cents % 100 === 0 ? eurWhole.format(cents / 100) : eur.format(cents / 100);
}

/** Convierte texto del usuario ("12", "12,5", "12.50") a céntimos. Devuelve null si no es válido. */
export function parseEurosToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = '0', frac = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
