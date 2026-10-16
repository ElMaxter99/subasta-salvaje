import { expect, test } from '@playwright/test';

const template = {
  formato: 'subasta-salvaje/plantilla@1',
  nombre: 'Partida de plantilla',
  tematica: 'Base lunar',
  reglas: { presupuesto: 30, puja_minima: 2, rondas_maximas: 2, pujas_enteras: true, clasificacion: 'saldo', modo_juego: 'movil', modo_imagenes: 'pegatinas' },
  jugadores: ['Ana', 'Beto'],
  catalogo: [
    { titulo: 'Cráter', descripcion: 'Un cráter enorme.', emoji: '🌑', foto: 'https://127.0.0.1/crater.png' },
    { titulo: 'Rover', descripcion: 'Vehículo lunar.', emoji: '🚙' },
    { titulo: 'Bandera', descripcion: '', emoji: '🚩' },
  ],
};

test('plantillas: descargar la vacía, importar con errores y bien, crear la partida y exportarla de nuevo', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500); // el servidor de desarrollo en frío puede recargar una vez

  // Plantilla vacía descargable y válida
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar plantilla vacía/ }).click()]);
  const blank = JSON.parse(await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf8'));
  expect(blank).toMatchObject({ formato: 'subasta-salvaje/plantilla@1' });
  expect(blank.catalogo.length).toBeGreaterThan(1);

  // Archivo con errores: mensajes por elemento y no cambia nada
  await page.getByTestId('template-input').setInputFiles({ name: 'mala.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ formato: 'subasta-salvaje/plantilla@1', nombre: 'X', tematica: 'Y', catalogo: [{ titulo: 'Bien' }, { titulo: '' }] })) });
  await expect(page.getByTestId('template-errors')).toContainText('Elemento 2 del catálogo');
  await page.getByTestId('template-input').setInputFiles({ name: 'rota.json', mimeType: 'application/json', buffer: Buffer.from('{ esto no es json') });
  await expect(page.getByTestId('template-errors')).toContainText('JSON válido');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();

  // Plantilla buena: rellena el asistente y salta al resumen
  await page.getByTestId('template-input').setInputFiles({ name: 'buena.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) });
  await expect(page.getByTestId('wizard-step-6')).toBeVisible();
  await expect(page.getByTestId('summary-catalog')).toContainText('3 elementos');
  await expect(page.getByTestId('summary-catalog')).toContainText('1 con foto');
  await expect(page.getByText('Partida de plantilla')).toBeVisible();
  await expect(page.getByText('Ana', { exact: true })).toBeVisible();
  await expect(page.getByText(/2 rondas máximo/)).toBeVisible();
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;

  // La partida salió como dice la plantilla
  const s = (await (await ctx.request.get(`/api/games/${code}`)).json()).snapshot;
  expect(s.game).toMatchObject({ name: 'Partida de plantilla', theme: 'Base lunar', initial_budget_cents: 3000, min_bid_cents: 200, play_mode: 'mobile', ranking_rule: 'balance', total_rounds: 2, integer_bids: true });
  expect(s.players.map((p: { name: string }) => p.name)).toEqual(['Ana', 'Beto']);
  expect(s.items.map((i: { name: string }) => i.name)).toEqual(['Cráter', 'Rover', 'Bandera']);
  // La foto apuntaba a una IP interna: se rechaza (SSRF), la partida existe igualmente y se avisa
  await expect(page.getByText(/no se pudo descargar|no se pudieron descargar/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/dirección no permitida|no permitida/)).toBeVisible();

  // Exportar desde Ajustes y volver a importar
  await page.getByRole('tab', { name: /Ajustes/ }).click();
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('template-export').click()]);
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile((await dl2.path())!, 'utf8'));
  expect(exported).toMatchObject({ formato: 'subasta-salvaje/plantilla@1', nombre: 'Partida de plantilla', jugadores: ['Ana', 'Beto'] });
  expect(exported.catalogo.map((i: { titulo: string }) => i.titulo)).toEqual(['Cráter', 'Rover', 'Bandera']);
  expect(exported.reglas).toMatchObject({ presupuesto: 30, puja_minima: 2, clasificacion: 'saldo', modo_juego: 'movil' });
});
