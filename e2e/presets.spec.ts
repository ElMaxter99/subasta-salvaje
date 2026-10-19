import { expect, test } from '@playwright/test';

test('presets en el asistente (rellenan y se ajustan al catálogo, siguen siendo editables) y «Aplicar preset» en Ajustes', async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await page.goto('/new-game');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const next = () => page.getByRole('button', { name: /Siguiente/ }).click();
  await next(); // quién puja
  await next(); // imágenes
  await page.getByLabel('Nombre de la partida').fill('Partida con preset');
  await next();
  await expect(page.getByTestId('wizard-step-4')).toBeVisible();

  // Indicador «X de N productos» y atajos
  const count = page.getByTestId('rounds-count');
  await expect(count).toHaveText(/12 de 12 productos/);
  await page.getByRole('button', { name: /^Mitad: 6 rondas/ }).click();
  await expect(count).toHaveText(/6 de 12 productos/);
  await page.getByRole('button', { name: /^8: 8 rondas/ }).click();
  await expect(count).toHaveText(/8 de 12 productos/);

  // «Larga» pide 20 rondas pero el catálogo tiene 12: se recorta y el presupuesto va con ellas
  await page.getByRole('radio', { name: /Larga/ }).check();
  await expect(page.getByTestId('wizard-preset-applied')).toContainText('Larga');
  await expect(page.getByTestId('wizard-preset-applied')).toContainText(/12 elementos/);
  await expect(count).toHaveText(/12 de 12 productos/);
  await expect(page.getByLabel('Presupuesto inicial (Ohros)')).toHaveValue('24');

  // «Rápida»: 8 rondas y 16 Ohros; editar a mano lo marca como personalizado
  await page.getByRole('radio', { name: /Rápida/ }).check();
  await expect(count).toHaveText(/8 de 12 productos/);
  await expect(page.getByLabel('Presupuesto inicial (Ohros)')).toHaveValue('16');
  await expect(page.getByLabel('Puja mínima (Ohros)')).toHaveValue('1');
  await expect(page.getByLabel('Adjudicar a los (s)')).toHaveValue('15');
  await page.getByLabel('Presupuesto inicial (Ohros)').fill('18');
  await expect(page.getByTestId('wizard-preset-applied')).toContainText('personalizado');

  await next(); // jugadores
  for (const [i, n] of ['Ana', 'Beto'].entries()) {
    await page.getByRole('button', { name: /Añadir jugador/ }).click();
    await page.getByLabel(`Nombre del jugador ${i + 1}`).fill(n);
  }
  await next(); // resumen con los valores resultantes
  await expect(page.getByTestId('summary-pace')).toContainText('Rápida');
  await expect(page.getByTestId('summary-pace')).toContainText('personalizado');
  await expect(page.getByTestId('wizard-step-6')).toContainText('8 rondas máximo');
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  const host = context.request;
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  let g = (await state()).game;
  expect(g).toMatchObject({ max_rounds: 8, initial_budget_cents: 1800, min_bid_cents: 100, auto_award_enabled: true, auto_award_seconds: 15, auto_run_gap_seconds: 6, auto_run_idle_seconds: 40, wild_chance_pct: 10, auto_run_enabled: false });

  // Ajustes → Aplicar preset con confirmación que lista los cambios
  await page.getByRole('tab', { name: 'Ajustes' }).click();
  await page.getByTestId('preset-larga').click();
  const dlg = page.getByTestId('preset-changes');
  await expect(dlg).toContainText('Máximo de rondas');
  await expect(dlg).toContainText('Presupuesto inicial');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect.poll(async () => (await state()).game.max_rounds).toBe(12);
  g = (await state()).game;
  expect(g).toMatchObject({ initial_budget_cents: 2400, auto_award_seconds: 25, wild_chance_pct: 15 });
  await expect(page.getByLabel(/Máximo de rondas/)).toHaveValue('12');

  // En curso: el presupuesto no se toca y las rondas no bajan de las jugadas
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('tab', { name: 'Ajustes' }).click();
  await page.getByTestId('preset-rapida').click();
  await expect(page.getByTestId('preset-changes')).toContainText(/Presupuesto inicial \(solo se puede cambiar antes de empezar\)/);
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect.poll(async () => (await state()).game.max_rounds).toBe(8);
  expect((await state()).game.initial_budget_cents).toBe(2400);
});
