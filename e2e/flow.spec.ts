import { expect, test, type APIRequestContext } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

type Snap = { version: number; players: { id: string; name: string; balance_cents: number; current_image: { url: string } | null; purchases: unknown[] }[]; auction: { status: string; current_bid_cents: number } | null; jobs: { status: string }[] };

async function hostState(request: APIRequest, code: string): Promise<Snap> {
  const res = await request.get(`/api/games/${code}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).snapshot;
}
type APIRequest = APIRequestContext;
const act = (request: APIRequest, code: string, body: Record<string, unknown>) => request.post(`/api/games/${code}/actions`, { data: body });

test('flujo completo: crear, pujar, adjudicar, IA, sincronización y permisos', async ({ page, context, request, browser }) => {
  // 1. Acceso de anfitrión demo y creación de partida con 4 jugadores
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  const names = ['Ana', 'Beto', 'Carla', 'Dani'];
  await createGameViaWizard(page, { name: 'Noche E2E', players: names });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;

  // 2. Pantalla pública en otra pestaña (sin sesión: contexto limpio)
  const tvCtx = await browser.newContext();
  const tv = await tvCtx.newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByText('Noche E2E').first()).toBeVisible();

  // 3. Imágenes iniciales (proveedor demo) y comienzo de partida
  const ctxReq = context.request;
  let snap = await hostState(ctxReq, code);
  for (const p of snap.players) expect((await act(ctxReq, code, { type: 'image.request_initial', player_id: p.id })).ok()).toBeTruthy();
  await expect.poll(async () => (await hostState(ctxReq, code)).players.every((p) => p.current_image), { timeout: 60_000 }).toBe(true);
  expect((await act(ctxReq, code, { type: 'game.start' })).ok()).toBeTruthy();

  // 4. Anunciar y pujar desde el panel
  await page.reload();
  await page.getByRole('tab', { name: /Subasta/ }).click();
  await page.getByRole('button', { name: 'Anunciar elemento' }).first().click();
  await expect(tv.getByText(/Subasta|En curso/i).first()).toBeVisible();
  await page.getByRole('radio', { name: /Ana/ }).click();
  await page.getByRole('button', { name: /Sumar 1/ }).first().click();
  await expect.poll(async () => (await hostState(ctxReq, code)).auction?.current_bid_cents).toBeGreaterThan(0);
  const bid = (await hostState(ctxReq, code)).auction!.current_bid_cents;
  // La TV (sin recargar) refleja la puja pública
  const pub = async () => (await (await request.get(`/api/public/games/${code}`)).json()).snapshot as Snap;
  expect((await pub()).auction?.current_bid_cents).toBe(bid);
  await expect(tv.getByText(new RegExp(`${bid / 100}`)).first()).toBeVisible({ timeout: 15_000 });

  const before = (await hostState(ctxReq, code)).players.find((p) => p.name === 'Ana')!.current_image!.url;
  // 5. Adjudicar con confirmación; doble envío no cobra dos veces
  await page.getByRole('button', { name: /^Adjudicar/ }).click();
  await page.getByRole('button', { name: /Cobrar .* y adjudicar/ }).dblclick();
  await expect.poll(async () => (await hostState(ctxReq, code)).players.find((p) => p.name === 'Ana')!.purchases.length).toBe(1);
  snap = await hostState(ctxReq, code);
  expect(snap.players.find((p) => p.name === 'Ana')!.balance_cents).toBe(2000 - bid);

  // 6. Trabajo de IA terminado → nueva imagen visible públicamente
  await expect.poll(async () => (await pub()).players.find((p) => p.name === 'Ana')!.current_image!.url, { timeout: 60_000 }).not.toBe(before);

  // 7. Permisos: sin sesión → 401; otra identidad demo → 403; la vista pública no filtra datos de anfitrión
  expect((await request.get(`/api/games/${code}`)).status()).toBe(401);
  const other = await browser.newContext();
  await other.request.post('/api/auth/demo');
  expect((await other.request.get(`/api/games/${code}`)).status()).toBe(403);
  expect((await other.request.post(`/api/games/${code}/actions`, { data: { type: 'game.finish' } })).status()).toBe(403);
  expect(JSON.stringify(await pub())).not.toContain('host_id');

  // 8. Recarga del panel sin perder la partida
  await page.reload();
  await expect(page.getByText('Noche E2E').first()).toBeVisible();

  // 9. Finalizar → resultados en TV y página pública
  expect((await act(ctxReq, code, { type: 'game.finish' })).ok()).toBeTruthy();
  await expect(tv.getByText(/Ana/).first()).toBeVisible();
  await tv.goto(`/game/${code}/results`);
  await expect(tv.getByText(/Noche E2E/).first()).toBeVisible();
  await tvCtx.close();
  await other.close();
});
