import { expect, test } from '@playwright/test';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const COL = `Cocina ${stamp}`;
const DEST = `Destino ${stamp}`;
const ORIGIN = { origin: 'http://localhost:3210' };

test.setTimeout(240_000); // la primera visita de cada página compila en frío
test('admin: plantilla desde colección, edición en bloque de productos y estadísticas', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
    const api = (path: string, data: unknown) => ctx.request.post(`/api/admin/${path}`, { data, headers: ORIGIN });
    const added = await api('library', { op: 'items.add', items: [
      { name: `Cuchara ${stamp}`, description: 'De palo', emoji: '🥄', collection: COL },
      { name: `Sartén ${stamp}`, description: 'Antiadherente', emoji: '🍳', collection: COL },
      { name: `Tetera ${stamp}`, description: '', collection: COL },
    ] });
    expect(added.ok()).toBeTruthy();

    // 1) Crear plantilla del sistema desde la colección
    const page = await ctx.newPage();
    await page.goto('/admin/plantillas');
    await page.getByTestId('template-from-collection').click({ timeout: 60_000 });
    await page.getByLabel('Colección de productos').selectOption(COL);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await page.waitForURL('**/admin/plantillas/editor?id=*', { timeout: 30_000 });
    const list = (await (await ctx.request.get('/api/admin/system-templates')).json()) as { templates?: { slug: string; title: string; status: string }[] };
    const tpl = (list.templates ?? []).find((t) => t.title === COL);
    expect(tpl?.status).toBe('draft');

    // 2) Edición en bloque: mover dos productos a otra colección
    await page.goto('/admin/catalogo');
    await page.getByLabel(`Seleccionar Cuchara ${stamp}`).check({ timeout: 60_000 });
    await page.getByLabel(`Seleccionar Sartén ${stamp}`).check();
    await expect(page.getByTestId('items-bulk')).toBeVisible();
    await page.getByLabel('Colección de destino').fill(DEST);
    await page.getByRole('button', { name: 'Mover', exact: true }).click();
    await expect(page.getByText(/2 productos movidos/)).toBeVisible();
    const moved = (await (await api('library', { op: 'items.list', collection: DEST })).json()) as { items: { name: string }[] };
    expect(moved.items).toHaveLength(2);

    // 3) Estadísticas
    await page.goto('/admin/estadisticas');
    await expect(page.getByRole('heading', { name: 'Partidas creadas por día' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Cuota de IA de hoy' })).toBeVisible();
    await expect(page.getByTestId('stats-quota-today')).toContainText('/');
  } finally {
    await ctx.close();
  }
});
