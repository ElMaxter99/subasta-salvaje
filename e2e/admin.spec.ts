import { expect, test } from '@playwright/test';

test('superadmin: panel con estadísticas, ajustes y auditoría; los demás ven un 404', async ({ page, browser }) => {
  // Sin sesión: 404 en las páginas y en la API
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  expect((await anonPage.goto('/admin'))?.status()).toBe(404);
  const denied = await anon.request.post('/api/admin/settings', { data: { key: 'ai_enabled', value: false } });
  expect(denied.status()).toBe(404);

  // Modo demo: el anfitrión local es superadmin
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await page.getByRole('link', { name: 'Superadmin' }).click();
  await expect(page.getByRole('heading', { name: /Peso: base de datos y almacenamiento/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Cuota de IA' })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Base de datos' })).toBeVisible();

  // Cerrar el registro desde Ajustes y dejarlo abierto otra vez
  await page.goto('/admin/ajustes');
  await page.getByRole('button', { name: 'Cerrar registro' }).click();
  await expect(page.getByText('Registro cerrado').first()).toBeVisible();
  await page.getByRole('button', { name: 'Abrir registro' }).click();
  await expect(page.getByText('Registro abierto')).toBeVisible();

  // Plazo de borrado a 3 días
  await page.getByLabel('Días').fill('3');
  await page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByText('Plazo de borrado actualizado')).toBeVisible();

  // Invitación + auditoría
  await page.goto('/admin/usuarios');
  await page.getByPlaceholder('correo@ejemplo.com').fill('amigo@ejemplo.com');
  await page.getByRole('button', { name: 'Invitar' }).click();
  await expect(page.getByText('amigo@ejemplo.com').first()).toBeVisible();
  // Panel de IA: en demo no hay credenciales, así que muestra el aviso en lugar de llamar a ningún proveedor
  await page.goto('/admin/ia');
  await expect(page.getByRole('heading', { name: 'Cloudflare Workers AI' })).toBeVisible();
  await expect(page.getByText('No hay credenciales de Cloudflare configuradas')).toBeVisible();
  await expect(page.getByText('No hay clave de Pollinations configurada')).toBeVisible();
  await page.goto('/admin/auditoria');
  await expect(page.getByText('Ajuste cambiado').first()).toBeVisible();
  await expect(page.getByText('Invitación creada').first()).toBeVisible();
  await page.goto('/admin/ajustes');
  await page.getByLabel('Días').fill('');
  await page.getByRole('button', { name: 'Guardar' }).first().click();
});
