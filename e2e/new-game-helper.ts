import type { Page } from '@playwright/test';

/** Recorre el asistente de «Nueva partida» (5 pasos) y crea la partida. */
export async function createGameViaWizard(page: Page, opts: { name: string; mobile?: boolean; players: string[] }): Promise<void> {
  await page.goto('/new-game');
  const next = () => page.getByRole('button', { name: /Siguiente/ }).click();
  // 1. Cómo jugáis
  if (opts.mobile) await page.getByRole('radio', { name: /Cada jugador desde su móvil/ }).check();
  await next();
  // 2. Partida
  await page.getByLabel('Nombre de la partida').fill(opts.name);
  await next();
  // 3. Reglas
  await next();
  // 4. Jugadores
  for (const [i, n] of opts.players.entries()) {
    await page.getByRole('button', { name: /Añadir jugador/ }).click();
    await page.getByLabel(`Nombre del jugador ${i + 1}`).fill(n);
  }
  await next();
  // 5. Resumen
  await page.getByRole('button', { name: /Crear partida/ }).click();
}
