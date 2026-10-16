import { expect, test, type Page } from '@playwright/test';
import pkg from '../package.json';

const PAGES = [
  ['/legal', 'Aviso legal'],
  ['/privacidad', 'Política de privacidad'],
  ['/cookies', 'Política de cookies y almacenamiento local'],
  ['/creditos', 'Créditos y licencias de terceros'],
  ['/licencia', 'Licencia'],
] as const;

const noHScroll = async (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('inicio: footer con versión y los 6 enlaces; el enlace al repositorio abre en pestaña nueva con noopener', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByTestId('site-footer');
  await expect(footer).toBeVisible({ timeout: 60_000 });
  await expect(footer.getByTestId('app-version')).toHaveText(`v${pkg.version}`);
  const nav = footer.getByRole('navigation', { name: 'Información legal y del proyecto' });
  for (const name of ['Aviso legal', 'Privacidad', 'Cookies', 'Créditos y licencias de terceros', 'Licencia']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  const repo = nav.getByRole('link', { name: /Repositorio/ });
  await expect(repo).toHaveAttribute('href', 'https://github.com/ElMaxter99/subasta-salvaje');
  await expect(repo).toHaveAttribute('target', '_blank');
  expect(await repo.getAttribute('rel')).toContain('noopener');
  await expect(nav.getByRole('link')).toHaveCount(6);
});

for (const [route, title] of PAGES) {
  test(`página legal ${route}: 200, h1 y botón de volver`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
    await expect(page.getByText('plantilla informativa, no asesoramiento jurídico')).toBeVisible();
  });
}

test('sin variables legales: aviso de titular pendiente, sin datos inventados', async ({ page }) => {
  test.skip(!!process.env.NEXT_PUBLIC_LEGAL_NAME, 'el entorno define el titular');
  await page.goto('/legal');
  await expect(page.getByTestId('holder-pending')).toHaveText('Titular pendiente de completar por el propietario');
});

test('cookies: la tabla lista las claves reales', async ({ page }) => {
  await page.goto('/cookies');
  const table = page.getByTestId('storage-table');
  for (const k of ['ss_demo_host', 'ss_p_', 'ss_audio_tv', 'ss_import_notice', 'sb-']) await expect(table).toContainText(k);
});

for (const [label, size] of [['móvil 390px', { width: 390, height: 844 }], ['escritorio 1920px', { width: 1920, height: 1080 }]] as const) {
  test(`sin desbordamiento horizontal en ${label}`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const route of ['/', ...PAGES.map((p) => p[0])]) {
      await page.goto(route);
      await expect(page.getByTestId('site-footer')).toBeVisible({ timeout: 60_000 });
      expect(await noHScroll(page), `${route} desborda en ${label}`).toBe(true);
    }
  });
}

test('la pantalla de TV y las rutas de partida NO muestran el footer', async ({ browser }) => {
  const host = (await browser.newContext()).request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const code = (await (await host.post('/api/games', { data: { name: 'Legal E2E', initial_budget_cents: 2000, players: [{ name: 'Ana' }, { name: 'Beto' }] } })).json()).room_code as string;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/game/${code}/screen`);
  await expect(page.getByText('Legal E2E').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('site-footer')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Aviso legal' })).toHaveCount(0);
  await page.goto('/new-game');
  await expect(page.getByTestId('site-footer')).toHaveCount(0);
});
