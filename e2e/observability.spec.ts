import { expect, test } from '@playwright/test';

const stamp = Date.now().toString(36);
const ORIGIN = { origin: 'http://localhost:3210' };

test.setTimeout(240_000); // la primera visita de cada página compila en frío
test('observabilidad: el superadmin ve la página y un error provocado aparece agrupado; los demás no entran', async ({ browser }) => {
  // Sin sesión: la página y la API no existen (404, igual que el resto del panel) y la exportación tampoco
  const anon = await browser.newContext();
  try {
    const anonPage = await anon.newPage();
    expect((await anonPage.goto('/admin/observabilidad'))?.status()).toBe(404);
    expect((await anon.request.post('/api/admin/observability', { data: { op: 'purge' }, headers: ORIGIN })).status()).toBe(404);
    expect((await anon.request.get('/api/admin/observability/export?kind=errors')).status()).toBe(404);
  } finally {
    await anon.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
    // Dos veces el "mismo" error del navegador (cambia el número): se agrupa en una fila. Sin cookies: el reporter no las necesita.
    const msg = (n: number) => `TypeError: e2e ${stamp} no puede leer la propiedad ${n} de undefined`;
    for (const n of [11, 22]) {
      const r = await ctx.request.post('/api/telemetry/error', { data: { message: msg(n), stack: 'at f (app.js:1:1)', route: '/game/:code/play', kind: 'boundary' }, headers: ORIGIN });
      expect(r.status()).toBe(204);
    }
    const page = await ctx.newPage();
    await page.goto(`/admin/observabilidad?q=${stamp}`);
    await expect(page.getByRole('heading', { name: 'Salud' })).toBeVisible({ timeout: 90_000 });
    const rows = page.getByTestId('obs-error-row');
    await expect(rows).toHaveCount(1, { timeout: 30_000 });
    await expect(rows.first()).toContainText('Navegador');
    await expect(rows.first().locator('td').nth(3)).toContainText('2');
    await expect(page.getByTestId('obs-alerts')).toBeVisible(); // error grave nuevo -> alerta destacada

    // Marcar como resuelto (acción auditada) y verlo en el filtro
    await rows.first().getByRole('button', { name: 'Resuelto' }).click();
    await expect(page.getByText('Marcado como resuelto')).toBeVisible();
    await page.goto(`/admin/observabilidad?q=${stamp}&status=resolved`);
    await expect(page.getByTestId('obs-error-row')).toHaveCount(1);
    await page.goto(`/admin/observabilidad?q=${stamp}&status=open`);
    await expect(page.getByTestId('obs-error-row')).toHaveCount(0);

    // Gráficas accesibles y exportación CSV
    await expect(page.getByTestId('obs-usage-chart').first()).toBeVisible();
    await expect(page.getByRole('img', { name: /Partidas creadas por día/ })).toBeVisible();
    const csv = await ctx.request.get(`/api/admin/observability/export?kind=errors`);
    expect(csv.ok()).toBeTruthy();
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain(stamp);
    expect((await ctx.request.get('/api/admin/observability/export?kind=usage')).ok()).toBeTruthy();

    // Enlace en el menú y entrada de auditoría
    await page.goto('/admin/auditoria');
    await expect(page.getByText('Error marcado (visto/resuelto)').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Observabilidad' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
