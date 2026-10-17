import { expect, test } from '@playwright/test';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const TITLE = `Noche en la luna ${stamp}`;
const template = {
  formato: 'subasta-salvaje/plantilla@1',
  nombre: TITLE,
  tematica: 'Base lunar',
  reglas: { presupuesto: 30, puja_minima: 2, rondas_maximas: 2, pujas_enteras: true, clasificacion: 'saldo', modo_juego: 'anfitrion', modo_imagenes: 'pegatinas' },
  jugadores: ['Ana', 'Beto'],
  catalogo: [
    { titulo: 'Cráter', descripcion: 'Un cráter enorme.', emoji: '🌑' },
    { titulo: 'Rover', descripcion: 'Vehículo lunar.', emoji: '🚙' },
  ],
};

test('partidas del sistema: el superadmin crea y publica una plantilla; el anfitrión la ve, la carga y crea la partida', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
  const page = await ctx.newPage();

  // Sin plantillas publicadas no aparece la sección
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });

  // Superadmin: nueva plantilla con JSON no válido → errores; válido → borrador
  await page.goto('/admin/plantillas');
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  await page.getByLabel('Título', { exact: true }).fill(TITLE);
  await page.getByLabel('Identificador').fill(`noche-luna-${stamp}`);
  await page.getByLabel('Descripción').fill('Una subasta lunar para empezar rápido');
  await page.getByLabel('Plantilla JSON', { exact: true }).fill('{ "formato": "mal" }');
  await expect(page.locator('ul[role="alert"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  await page.getByLabel('Plantilla JSON', { exact: true }).fill(JSON.stringify(template));
  await expect(page.getByTestId('template-valid')).toContainText('2 elementos');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  const row = page.getByTestId('system-template-row').filter({ hasText: TITLE });
  await expect(row).toContainText('Borrador');

  // Un borrador no lo ve el anfitrión
  const titles = async () => (((await (await ctx.request.get('/api/system-templates')).json()) as { templates: { title: string }[] }).templates).map((t) => t.title);
  expect(await titles()).not.toContain(TITLE);

  // Publicar (sin imágenes no hay nada que descargar)
  await row.getByRole('button', { name: 'Publicar' }).click();
  await expect(row).toContainText('Publicada');
  await expect(page.getByText('Plantilla publicada')).toBeVisible();

  // Anfitrión: la tarjeta aparece, se usa y rellena el asistente
  await page.goto('/new-game');
  const card = page.getByTestId('system-template-card').filter({ hasText: TITLE });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('2 elementos');
  await card.getByRole('button', { name: /Usar la partida del sistema/ }).click();
  await expect(page.getByTestId('summary-catalog')).toContainText('2 elementos'); // el asistente salta al Resumen con la plantilla cargada
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  await expect(page.getByText(TITLE).first()).toBeVisible();

  // Retirar: vuelve a ser borrador y desaparece para los anfitriones
  await page.goto('/admin/plantillas');
  await page.getByTestId('system-template-row').filter({ hasText: TITLE }).getByRole('button', { name: 'Retirar' }).click();
  await expect(page.getByTestId('system-template-row').filter({ hasText: TITLE })).toContainText('Borrador');
  expect(await titles()).not.toContain(TITLE);

  // Limpieza: borrar la plantilla de la prueba
  await page.getByTestId('system-template-row').filter({ hasText: TITLE }).getByRole('button', { name: 'Borrar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
  await expect(page.getByTestId('system-template-row').filter({ hasText: TITLE })).toHaveCount(0);

  // Un anfitrión que no es superadmin recibe 404 en las rutas de administración
  const anon = await browser.newContext();
  expect((await anon.request.get('/api/admin/system-templates')).status()).toBe(404);
  expect((await anon.request.post('/api/admin/system-templates', { data: { op: 'delete', id: '00000000-0000-4000-8000-000000000000' }, headers: { origin: 'http://localhost:3210' } })).status()).toBe(404);
  await anon.close();
  await ctx.close();
});
