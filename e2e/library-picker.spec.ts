import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const ORIGIN = { origin: 'http://localhost:3210' };

test('biblioteca con roles: el superadmin etiqueta y publica; el anfitrión elige de la biblioteca la imagen inicial y la foto de un elemento', async ({ browser }) => {
  // Servidor local que imita la API de GitHub (la app apunta aquí por GITHUB_ASSETS_API_BASE)
  const hex40 = (n: number) => n.toString(16).padStart(40, '0');
  let blobs = 0;
  const stub = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const url = req.url ?? '';
      if (req.method === 'POST' && url.endsWith('/git/blobs')) { blobs++; res.statusCode = 201; res.end(JSON.stringify({ sha: hex40(blobs) })); }
      else if (req.method === 'POST' && url.endsWith('/git/trees')) { res.statusCode = 201; res.end(JSON.stringify({ sha: hex40(9000) })); }
      else if (req.method === 'POST' && url.endsWith('/git/commits')) { res.statusCode = 201; res.end(JSON.stringify({ sha: 'e2ec0de'.padEnd(40, '0') })); }
      else if (req.method === 'PATCH' && url.includes('/git/refs/heads/')) res.end('{}');
      else if (url.includes('/git/commits/')) res.end(JSON.stringify({ tree: { sha: hex40(8000) } }));
      else if (url.includes('/commits/')) res.end(JSON.stringify({ sha: 'stub0000sha' }));
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise<void>((r) => stub.listen(3299, '127.0.0.1', r));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin

    // --- Siembra por API (fase 1 + fase 2) de una escena (inicio) y un objeto (producto) con contenido único
    const k = parseInt(stamp, 36) % 200;
    const picture = (w: number, h: number, shift: number) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="rgb(${20 + k},60,90)"/><circle cx="${shift}" cy="${shift}" r="${60 + k}" fill="#fc3"/></svg>`)).jpeg().toBuffer();
    const stage = async (name: string, buffer: Buffer, fields: Record<string, string>) => {
      const r = await ctx.request.post('/api/admin/library/stage', { headers: ORIGIN, multipart: { ...fields, file: { name, mimeType: 'image/jpeg', buffer } } });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()) as { existed: boolean; staged: unknown; near: unknown[] };
    };
    const casa = await stage(`casa_${stamp}.jpg`, await picture(1600, 1100, 300), { kind: 'scene', collection: `Paisajes ${stamp}`, category: 'Paisajes' });
    const tetera = await stage(`tetera_${stamp}.jpg`, await picture(900, 700, 700), { kind: 'item', collection: `Hogar ${stamp}`, category: 'Objetos del hogar', tags: 'cocina' });
    expect(casa.existed || tetera.existed).toBe(false);
    const commit = await ctx.request.post('/api/admin/library/commit', { headers: ORIGIN, data: { staged: [casa.staged, tetera.staged] } });
    expect(commit.ok(), await commit.text()).toBeTruthy();
    const images = ((await commit.json()) as { images: { id: string; title: string; roles: string[]; category: string; reviewed: boolean }[] }).images;
    expect(images.find((i) => i.title === `Casa ${stamp}`)).toMatchObject({ roles: ['start'], category: 'Paisajes', reviewed: false });
    expect(images.find((i) => i.title === `Tetera ${stamp}`)).toMatchObject({ roles: ['product'], category: 'Objetos del hogar', reviewed: false });

    // Un anfitrión ve la lista del selector: vacía mientras no estén revisadas
    const pick = async (role: string, q: string) => ((await (await ctx.request.get(`/api/library/images?role=${role}&q=${encodeURIComponent(q)}`)).json()) as { total: number }).total;
    expect(await pick('start', stamp)).toBe(0);
    expect((await ctx.request.get('/api/library/images')).status()).toBe(400); // el rol es obligatorio

    // --- Superadmin: filtrar por rol/categoría, etiquetar en bloque y publicar (revisar)
    const admin = await ctx.newPage();
    await admin.goto('/admin/biblioteca');
    await expect(admin.getByTestId('library-dropzone')).toBeVisible({ timeout: 60_000 });
    await admin.waitForTimeout(2500);
    await expect(admin.getByTestId('library-coverage')).toBeVisible();
    await expect(admin.getByTestId('coverage-table')).toContainText('Paisajes');
    await expect(admin.getByTestId('quality-checklist')).toBeVisible();
    await admin.getByLabel('Buscar imágenes').fill(stamp);
    await expect(admin.getByTestId('library-image')).toHaveCount(2);
    await admin.getByLabel('Filtrar por rol').selectOption('start');
    await expect(admin.getByTestId('library-image')).toHaveCount(1);
    await admin.getByLabel('Filtrar por rol').selectOption('');
    await expect(admin.getByTestId('library-image')).toHaveCount(2);
    await admin.getByRole('button', { name: 'Seleccionar todo lo visible' }).click();
    await admin.getByLabel('Etiqueta para la selección').fill('e2e');
    await admin.getByTestId('library-tag-add').click();
    await expect(admin.getByText(/Etiqueta «e2e» añadida a 2 imágenes/)).toBeVisible({ timeout: 30_000 });
    await admin.getByRole('button', { name: 'Seleccionar todo lo visible' }).click();
    await admin.getByLabel('Rol para la selección').selectOption('product');
    await admin.getByTestId('library-role-add').click(); // la imagen también sirve de producto
    await expect(admin.getByText(/Rol añadido a 2 imágenes/)).toBeVisible({ timeout: 30_000 });
    await admin.getByRole('button', { name: 'Seleccionar todo lo visible' }).click();
    await admin.getByTestId('library-mark-reviewed').click();
    await expect(admin.getByText(/2 imágenes marcadas como revisadas/)).toBeVisible({ timeout: 30_000 });
    await admin.getByLabel('Filtrar por rol').selectOption('product');
    await expect(admin.getByTestId('library-image')).toHaveCount(2);
    // Quitar el rol «producto» de la imagen (ajuste en bloque por API): vuelve a ser solo de inicio
    const casaId = images.find((i) => i.title === `Casa ${stamp}`)!.id;
    const upd = await ctx.request.post('/api/admin/library', { headers: ORIGIN, data: { op: 'images.update', ids: [casaId], patch: { roles_remove: ['product'] } } });
    expect(upd.ok()).toBeTruthy();
    await admin.close();

    expect(await pick('start', stamp)).toBe(1);
    expect(await pick('product', stamp)).toBe(1); // solo la tetera: la imagen dejó de ser producto

    // --- Anfitrión: partida nueva, imagen inicial de la biblioteca
    const created = await ctx.request.post('/api/games', { data: { name: 'Biblioteca E2E', players: ['Ana', 'Beto'].map((name) => ({ name })) } });
    const code = (await created.json()).room_code as string;
    const page = await ctx.newPage();
    await page.goto(`/game/${code}/host`);
    await page.waitForTimeout(4000); // hidratación en frío
    const players = page.getByRole('tab', { name: /Jugadores/ });
    await expect(async () => {
      await players.click();
      await expect(players).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    const fromLibrary = page.getByTestId('initial-from-library');
    await expect(async () => {
      await fromLibrary.click();
      await expect(page.getByTestId('host-library-picker')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel('Buscar en la biblioteca').fill(stamp);
    await expect(page.getByTestId('host-library-choice')).toHaveCount(1); // solo la de rol «inicio»
    await expect(page.getByTestId('host-library-choice')).toHaveAttribute('aria-label', `Elegir Casa ${stamp}`);
    await page.getByTestId('host-library-choice').click();
    await page.getByRole('button', { name: 'Sí, aplicar' }).click();
    await expect(page.getByText('Imagen de partida aplicada').first()).toBeVisible({ timeout: 30_000 });
    const snap = async () => (await (await ctx.request.get(`/api/games/${code}`)).json()).snapshot as { players: { current_image?: { url: string } | null }[]; items: { id: string; name: string; image_url: string | null }[] };
    const s1 = await snap();
    expect(s1.players.every((p) => p.current_image?.url.includes('/biblioteca/paisajes'))).toBe(true);

    // --- Foto de un elemento del catálogo desde la biblioteca
    const tab = page.getByRole('tab', { name: /Catálogo/ });
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    const first = s1.items[0]!;
    await page.getByTestId(`item-from-library-${first.id}`).click();
    await page.getByLabel('Buscar en la biblioteca').fill(`Tetera ${stamp}`);
    await expect(page.getByTestId('host-library-choice')).toHaveCount(1);
    await page.getByTestId('host-library-choice').click();
    await expect(page.getByText(`Foto de «${first.name}» aplicada desde la biblioteca`)).toBeVisible({ timeout: 30_000 });
    expect((await snap()).items[0]!.image_url).toContain('/biblioteca/hogar');

    // Una imagen sin el rol pedido (la imagen ya no es «producto») no se puede aplicar a un elemento
    const bad = await ctx.request.post(`/api/games/${code}/library-image`, { headers: ORIGIN, data: { target: 'item', image_id: casaId, item_id: first.id } });
    expect(bad.status()).toBe(404);

    // --- Asistente «Nueva partida»: imagen inicial elegida de la biblioteca en el paso «Las imágenes»; se aplica al crear la partida
    const wiz = await ctx.newPage();
    await wiz.goto('/new-game');
    const next = () => wiz.getByRole('button', { name: /Siguiente/ }).click();
    await wiz.waitForTimeout(3000);
    await expect(async () => {
      await next();
      await expect(wiz.getByTestId('wizard-step-2')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await wiz.getByTestId('wizard-house-from-library').click();
    await wiz.getByLabel('Buscar en la biblioteca').fill(stamp);
    await wiz.getByRole('button', { name: `Elegir Casa ${stamp}` }).click(); // la base del e2e conserva las imágenes de otras ejecuciones
    await expect(wiz.getByTestId('wizard-house-chosen')).toContainText(`Casa ${stamp}`);
    await next();
    await wiz.getByLabel('Nombre de la partida').fill('Imagen de biblioteca');
    await next();
    await next();
    for (const [i, n] of ['Ana', 'Beto'].entries()) {
      await wiz.getByRole('button', { name: /Añadir jugador/ }).click();
      await wiz.getByLabel(`Nombre del jugador ${i + 1}`).fill(n);
    }
    await next();
    await expect(wiz.getByText(`Imagen inicial: Casa ${stamp}`)).toBeVisible();
    await wiz.getByRole('button', { name: /Crear partida/ }).click();
    await wiz.waitForURL(/\/game\/[A-Z0-9]+\/host/, { timeout: 60_000 });
    const wcode = wiz.url().match(/\/game\/([A-Z0-9]+)\/host/)![1]!;
    await expect(async () => {
      const players2 = ((await (await ctx.request.get(`/api/games/${wcode}`)).json()).snapshot as { players: { current_image?: { url: string } | null }[] }).players;
      expect(players2.length).toBe(2);
      expect(players2.every((p) => p.current_image?.url.includes('/biblioteca/paisajes'))).toBe(true);
    }).toPass({ timeout: 30_000 });
  } finally {
    await ctx.close();
    await new Promise<void>((r) => stub.close(() => r()));
  }
});
