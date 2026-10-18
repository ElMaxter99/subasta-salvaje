import { expect, test } from '@playwright/test';

test('comparador de modelos: enlazado desde IA y, sin proveedor real configurado, lo dice y no simula nada', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
    const page = await ctx.newPage();
    await page.goto('/admin/ia');
    await page.getByRole('link', { name: 'Comparar modelos' }).click();
    await expect(page).toHaveURL(/\/admin\/ia\/comparar/);
    await expect(page.getByTestId('compare-no-providers')).toContainText('No hay ningún proveedor de IA real configurado', { timeout: 60_000 });
    await expect(page.getByTestId('compare-result')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Comparar', exact: true })).toHaveCount(0);
    // La API tampoco simula: sin proveedor devuelve un error claro.
    const res = await ctx.request.post('/api/admin/ia/compare', { multipart: { meta: JSON.stringify({ providers: ['cloudflare'], items: [{ name: 'Sombrero' }] }) } });
    expect(res.ok()).toBeFalsy();
  } finally {
    await ctx.close();
  }
});
