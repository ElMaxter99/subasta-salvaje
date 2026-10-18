import { expect, test } from '@playwright/test';

/** PNG: dimensiones del encabezado IHDR (bytes 16-23). */
const dims = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

test('imagen del podio: formatos story/square/landscape, formato inválido rechazado y botones de descarga', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Podio PNG', initial_budget_cents: 2000, ranking_rule: 'balance', players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  expect((await host.get(`/api/public/games/${code}/podium?format=story`)).ok()).toBeFalsy(); // aún no ha terminado
  expect((await act({ type: 'game.finish' })).ok()).toBeTruthy();

  for (const [format, size] of [['story', [1080, 1350]], ['square', [1080, 1080]], ['landscape', [1200, 630]]] as const) {
    const res = await host.get(`/api/public/games/${code}/podium?format=${format}&download=1`);
    expect(res.status(), format).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect(dims(await res.body()), format).toEqual(size);
  }
  expect(dims(await (await host.get(`/api/public/games/${code}/podium`)).body())).toEqual([1200, 630]); // sin parámetro = el formato de siempre
  for (const bad of ['portrait', 'STORY', '../x', '1080x1350']) expect((await host.get(`/api/public/games/${code}/podium?format=${encodeURIComponent(bad)}`)).status(), bad).toBe(400);

  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/game/${code}/results`);
  await expect(page.getByTestId('podium-download')).toHaveAttribute('href', new RegExp(`format=story.*download=1`), { timeout: 60_000 });
  await expect(page.getByTestId('podium-download-square')).toHaveAttribute('href', /format=square/);
  await expect(page.getByTestId('podium-download-landscape')).toHaveAttribute('href', /format=landscape/);
});
