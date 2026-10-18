import { expect, test } from '@playwright/test';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const TITLE = `Casar fotos ${stamp}`;

test('plantillas del sistema: «Sugerir fotos de la biblioteca» muestra la propuesta por elemento (borrador, sin publicar)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
  const data = {
    formato: 'subasta-salvaje/plantilla@1', nombre: TITLE, tematica: 'Egipto',
    reglas: { presupuesto: 20, puja_minima: 1, rondas_maximas: 2, modo_imagenes: 'pegatinas' },
    catalogo: [{ titulo: 'Pirámide dorada', descripcion: 'Resiste milenios.', emoji: '🔺', foto: null }, { titulo: 'Camello de caravana', descripcion: 'Cruza el desierto.', emoji: '🐫', foto: null }],
  };
  const saved = await ctx.request.post('/api/admin/system-templates', { data: { op: 'save', slug: `casar-${stamp}`, title: TITLE, description: 'Plantilla de prueba del casamiento', data } });
  expect(saved.ok()).toBeTruthy();

  const page = await ctx.newPage();
  await page.goto('/admin/plantillas');
  const row = page.getByTestId('system-template-row').filter({ hasText: TITLE });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTestId('template-match').click();
  await expect(page.getByRole('heading', { name: new RegExp(`Fotos sugeridas · ${TITLE}`) })).toBeVisible();
  const rows = page.getByTestId('match-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Pirámide dorada');
  await expect(page.getByTestId('match-accept-high')).toBeVisible();
  await expect(row).toContainText('Borrador'); // sigue en borrador

  // La API de propuesta es solo para el superadmin: sin sesión no responde con datos
  const anon = await browser.newContext();
  const r = await anon.request.post('/api/admin/system-templates', { data: { op: 'match_propose', id: '00000000-0000-4000-8000-000000000000' } });
  expect(r.ok()).toBeFalsy();
});
