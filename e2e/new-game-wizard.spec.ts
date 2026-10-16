import { expect, test } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

const VIEWPORTS = [
  { name: 'movil', width: 390, height: 844 },
  { name: 'escritorio', width: 1280, height: 800 },
  { name: 'tv', width: 1920, height: 1080 },
];

test('asistente de nueva partida: pasos, validación, resumen editable y creación; usable en móvil, escritorio y TV', async ({ browser }, info) => {
  const host = await browser.newContext();
  expect((await host.request.post('/api/auth/demo')).ok()).toBeTruthy();

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: await host.storageState(), isMobile: vp.name === 'movil' });
    const page = await ctx.newPage();
    await page.goto('/new-game');
    await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500); // el servidor de desarrollo en frío puede recargar la página una vez
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();
    // Sin desbordamiento horizontal y con la barra de navegación visible dentro de la pantalla
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${vp.name}: desbordamiento horizontal`).toBeLessThanOrEqual(1);
    const nav = page.getByRole('button', { name: /Siguiente/ });
    await expect(nav).toBeInViewport();
    const box = (await nav.boundingBox())!;
    expect(box.height, `${vp.name}: botón demasiado pequeño`).toBeGreaterThanOrEqual(44);

    // Indicador de pasos propio de cada tamaño
    if (vp.name === 'movil') await expect(page.getByText('Paso 1 de 6')).toBeVisible();
    else await expect(page.getByRole('navigation', { name: /Pasos/ }).getByRole('listitem')).toHaveCount(6);
    await page.screenshot({ path: info.outputPath(`wizard-${vp.name}-1.png`) });

    // Los dos primeros pasos (quién puja / cómo cambian las casas) son pantallas distintas y cortas
    await expect(page.getByRole('radio', { name: /Cada jugador desde su móvil/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Pegatinas con emojis/ })).toHaveCount(0);
    await nav.click();
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Pegatinas con emojis/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Cada jugador desde su móvil/ })).toHaveCount(0);
    // Validación: nombre vacío no deja avanzar
    await nav.click();
    await page.getByLabel('Nombre de la partida').fill('');
    await nav.click();
    await expect(page.getByTestId('wizard-error')).toContainText('nombre');
    await page.getByLabel('Nombre de la partida').fill(`Partida ${vp.name}`);
    await nav.click();
    await expect(page.getByTestId('wizard-step-4')).toBeVisible();
    await page.getByLabel('Presupuesto inicial (€)').fill('abc');
    await nav.click();
    await expect(page.getByTestId('wizard-error')).toContainText('presupuesto');
    await page.getByLabel('Presupuesto inicial (€)').fill('30');
    // Rondas por defecto = catálogo (12 en «Casa») y pujas enteras por defecto
    await expect(page.getByLabel('Máximo de rondas')).toHaveAttribute('placeholder', '12');
    await expect(page.getByRole('checkbox', { name: /Solo pujas en euros enteros/ })).toBeChecked();
    await page.getByLabel('Puja mínima (€)').fill('1,5');
    await nav.click();
    await expect(page.getByTestId('wizard-error')).toContainText('euros enteros');
    await page.getByLabel('Puja mínima (€)').fill('1');
    await page.getByLabel('Máximo de rondas').fill('5');
    await nav.click();
    // Jugadores: ninguno por defecto y explicación de que se pueden crear luego
    await expect(page.getByLabel('Nombre del jugador 1')).toHaveCount(0);
    await expect(page.getByTestId('players-help')).toContainText('crearlos más tarde');
    await page.getByRole('button', { name: /Añadir jugador/ }).click();
    await page.getByRole('button', { name: /Añadir jugador/ }).click();
    await page.getByLabel('Nombre del jugador 1').fill('Ana');
    await page.getByLabel('Nombre del jugador 2').fill('ana');
    await nav.click();
    await expect(page.getByTestId('wizard-error')).toContainText('repetidos');
    await page.getByLabel('Nombre del jugador 2').fill('Beto');
    await page.getByLabel('Nombre del jugador 2').press('Enter'); // Enter avanza, no crea
    await expect(page.getByTestId('wizard-step-6')).toBeVisible();
    await expect(page.getByText('Ana')).toBeVisible();
    await expect(page.getByText(/5 rondas máximo/)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`wizard-${vp.name}-6.png`) });

    // Editar desde el resumen y volver
    await page.getByRole('button', { name: 'Editar Reglas' }).click();
    await expect(page.getByLabel('Presupuesto inicial (€)')).toHaveValue('30');
    await page.getByRole('button', { name: /Atrás/ }).click();
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();
    await ctx.close();
  }

  // Creación completa de principio a fin
  const page = await host.newPage();
  await createGameViaWizard(page, { name: 'Asistente E2E', mobile: true, players: ['Ana', 'Beto'] });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Asistente E2E' })).toBeVisible();
});
