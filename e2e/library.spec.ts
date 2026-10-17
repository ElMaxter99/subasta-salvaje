import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const COLLECTION = `Halloween ${stamp}`;
const ORIGIN = { origin: 'http://localhost:3210' };

test('biblioteca: subida masiva (con repetida y archivo no válido), productos desde imágenes y los importa un anfitrión', async ({ browser }) => {
  // Servidor local que imita la API de GitHub (el servidor de la app apunta aquí por GITHUB_ASSETS_API_BASE)
  const puts: string[] = [];
  const stub = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'PUT') { puts.push(decodeURIComponent(req.url ?? '')); res.statusCode = 201; res.end(JSON.stringify({ commit: { sha: 'stub0000sha' } })); }
      else if (req.url?.includes('/commits/')) res.end(JSON.stringify({ sha: 'stub0000sha' }));
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise<void>((r) => stub.listen(3299, '127.0.0.1', r));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
    const page = await ctx.newPage();
    await page.goto('/admin/biblioteca');
    await expect(page.getByTestId('library-dropzone')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);

    // Subida masiva: 3 nuevas + 1 con el mismo contenido + 1 archivo que no es una imagen
    const photo = (color: string) => sharp({ create: { width: 1200, height: 900, channels: 3, background: color } }).jpeg().toBuffer();
    const file = async (name: string, color: string) => ({ name, mimeType: 'image/jpeg', buffer: await photo(color) });
    await page.getByLabel('Colección de la subida').fill(COLLECTION);
    await page.getByLabel('Etiquetas de la subida').fill('terror, otoño');
    await page.getByLabel('Elegir imágenes para la biblioteca').setInputFiles([
      await file(`calabaza_gigante_${stamp}.jpg`, '#dd7711'),
      await file(`fantasma_${stamp}.jpg`, '#eeeeff'),
      await file(`murcielago_${stamp}.jpg`, '#221133'),
      await file(`copia_de_fantasma_${stamp}.jpg`, '#eeeeff'),
      { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('no soy una imagen') },
    ]);
    await expect(page.getByTestId('library-progress')).toContainText('3 nuevas · 1 repetidas · 1 con error', { timeout: 90_000 });
    expect(puts).toHaveLength(3); // la repetida no llegó a GitHub
    expect(puts.every((p) => p.includes('/biblioteca/') && p.endsWith('.webp'))).toBe(true);

    // Galería: filtro por colección y selección
    await page.getByLabel('Filtrar por colección').selectOption(COLLECTION);
    await expect(page.getByTestId('library-image')).toHaveCount(3);
    await page.getByRole('button', { name: 'Seleccionar todo lo visible' }).click();
    await expect(page.getByTestId('library-bulk')).toContainText('3 seleccionadas');

    // Productos desde las imágenes (el nombre sale del título del archivo)
    await page.getByTestId('library-to-items').click();
    const from = page.getByTestId('library-from-images');
    await expect(from).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Nombre del producto 1')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Crear productos', exact: true }).click();
    await expect(page.getByText(/3 productos creados/)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Filtrar productos por colección').selectOption(COLLECTION);
    await expect(page.getByTestId('library-item')).toHaveCount(3);

    // Añadir en bloque por texto: uno nuevo (con emoji) y uno repetido que se omite
    await page.getByLabel('Colección de los productos nuevos').fill(COLLECTION);
    await page.getByLabel('Lista de productos').fill(`Escoba voladora; Para llegar a tiempo; 🧹\nFantasma ${stamp}`);
    await page.getByRole('button', { name: 'Añadir productos' }).click();
    await expect(page.getByText(/productos añadidos/)).toBeVisible({ timeout: 30_000 });

    // Un anfitrión los importa al catálogo de su partida desde el modal
    await page.goto('/new-game');
    await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /Siguiente/ }).click();
    const before = Number(await page.getByTestId('summary-catalog-theme').locator('b').first().innerText());
    await page.getByRole('button', { name: 'Importar productos de la biblioteca' }).click();
    await page.getByLabel('Colección', { exact: true }).selectOption(COLLECTION);
    await expect(page.getByTestId('library-pick-item')).toHaveCount(4, { timeout: 30_000 });
    await page.getByRole('button', { name: /Marcar todos/ }).click();
    await page.getByTestId('library-pick-add').click();
    await expect(page.getByTestId('summary-catalog')).toContainText(`${before + 4} elementos`);
    await expect(page.getByTestId('summary-catalog')).toContainText('con foto');

    // Limpieza: productos e imágenes de la prueba
    const items = ((await (await ctx.request.post('/api/admin/library', { data: { op: 'items.list', collection: COLLECTION }, headers: ORIGIN })).json()) as { items: { id: string }[] }).items;
    expect(items).toHaveLength(4);
    await ctx.request.post('/api/admin/library', { data: { op: 'items.delete', ids: items.map((i) => i.id) }, headers: ORIGIN });
    const imgs = ((await (await ctx.request.post('/api/admin/library', { data: { op: 'images.list', collection: COLLECTION }, headers: ORIGIN })).json()) as { images: { id: string }[] }).images;
    expect((await ctx.request.post('/api/admin/library', { data: { op: 'images.delete', ids: imgs.map((i) => i.id) }, headers: ORIGIN })).ok()).toBeTruthy();

    // Quien no es superadmin recibe 404
    const anon = await browser.newContext();
    expect((await anon.request.post('/api/admin/library', { data: { op: 'items.list' }, headers: ORIGIN })).status()).toBe(404);
    expect((await anon.request.get('/api/library/items')).status()).toBeGreaterThanOrEqual(401);
    await anon.close();
  } finally {
    await ctx.close();
    await new Promise<void>((r) => stub.close(() => r()));
  }
});
