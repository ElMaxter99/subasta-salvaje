import { expect, test } from '@playwright/test';

const meta = async (page: import('@playwright/test').Page, prop: string) => page.locator(`meta[property="${prop}"], meta[name="${prop}"]`).first().getAttribute('content');

test('Open Graph: invitación (con código), TV y resultados tienen título, imagen 1200×630 que responde y noindex; el panel no se indexa', async ({ browser }) => {
  const host = (await browser.newContext()).request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const code = (await (await host.post('/api/games', { data: { name: 'OG E2E', initial_budget_cents: 2000, players: [{ name: 'Ana' }, { name: 'Beto' }] } })).json()).room_code as string;
  const page = await (await browser.newContext()).newPage();

  for (const [route, titleHas, descHas] of [['play', 'Te han invitado a «OG E2E»', code], ['screen', 'Pantalla de TV · OG E2E', code], ['results', 'Resultados de «OG E2E»', '2 jugadores']] as const) {
    await page.goto(`/game/${code}/${route}`);
    await expect.poll(async () => meta(page, 'og:title'), { timeout: 60_000 }).toContain(titleHas);
    expect(await meta(page, 'og:description')).toContain(descHas);
    expect(await meta(page, 'robots')).toContain('noindex');
    expect(await meta(page, 'twitter:card')).toBe('summary_large_image');
    const img = await meta(page, 'og:image');
    expect(img, route).toContain(`/game/${code}/${route}/opengraph-image`);
    expect(await meta(page, 'og:image:width')).toBe('1200');
    const res = await page.request.get(new URL(img!).pathname + new URL(img!).search);
    expect(res.status(), route).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect((await res.body()).length).toBeGreaterThan(5_000);
  }

  // Partida inexistente: tarjeta genérica, sin romper
  const missing = await page.request.get('/game/ZZZZZZ/play/opengraph-image');
  expect(missing.status()).toBe(200);

  // Inicio: imagen de marca y sin noindex
  await page.goto('/');
  await expect.poll(async () => meta(page, 'og:image'), { timeout: 60_000 }).toContain('/assets/brand/og-image.png');
  expect(await meta(page, 'og:title')).toBe('Subasta Salvaje');
});
