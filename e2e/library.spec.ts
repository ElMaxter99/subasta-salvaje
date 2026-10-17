import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const COLLECTION = `Halloween ${stamp}`;
const ORIGIN = { origin: 'http://localhost:3210' };

test('biblioteca: subida masiva (con repetida y archivo no válido), productos desde imágenes y los importa un anfitrión', async ({ browser }) => {
  // Servidor local que imita la API de GitHub (el servidor de la app apunta aquí por GITHUB_ASSETS_API_BASE)
  const hex40 = (n: number) => n.toString(16).padStart(40, '0');
  let blobs = 0, commits = 0, puts = 0;
  const stub = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const url = req.url ?? '';
      if (req.method === 'POST' && url.endsWith('/git/blobs')) { blobs++; res.statusCode = 201; res.end(JSON.stringify({ sha: hex40(blobs) })); }
      else if (req.method === 'POST' && url.endsWith('/git/trees')) { res.statusCode = 201; res.end(JSON.stringify({ sha: hex40(9000) })); }
      else if (req.method === 'POST' && url.endsWith('/git/commits')) { commits++; res.statusCode = 201; res.end(JSON.stringify({ sha: 'e2ec0de'.padEnd(40, '0') })); }
      else if (req.method === 'PATCH' && url.includes('/git/refs/heads/')) res.end('{}');
      else if (req.method === 'PUT') { puts++; res.statusCode = 201; res.end(JSON.stringify({ commit: { sha: 'stub0000sha' } })); }
      else if (url.includes('/git/commits/')) res.end(JSON.stringify({ tree: { sha: hex40(8000) } }));
      else if (url.includes('/commits/')) res.end(JSON.stringify({ sha: 'stub0000sha' }));
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
    const k = parseInt(stamp, 36) % 200; // contenido único por ejecución (la base del e2e persiste y las imágenes se identifican por contenido)
    const photo = (color: string) => sharp({ create: { width: 1200 + (k % 37), height: 900 + (k % 29), channels: 3, background: color.replace('#', '#') } }).jpeg().toBuffer();
    const file = async (name: string, color: string) => ({ name, mimeType: 'image/jpeg', buffer: await photo(color) });
    await page.getByLabel('Colección de la subida').fill(COLLECTION);
    await page.getByLabel('Etiquetas de la subida').fill('terror, otoño');
    await page.getByLabel('Elegir imágenes para la biblioteca').setInputFiles([
      await file(`calabaza_gigante_${stamp}.jpg`, `rgb(${20 + k}, 119, 17)`),
      await file(`fantasma_${stamp}.jpg`, `rgb(238, ${k + 20}, 255)`),
      await file(`murcielago_${stamp}.jpg`, `rgb(34, 17, ${k + 20})`),
      await file(`copia_de_fantasma_${stamp}.jpg`, `rgb(238, ${k + 20}, 255)`),
      { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('no soy una imagen') },
    ]);
    await expect(page.getByTestId('library-progress')).toContainText('3 nuevas · 1 repetidas · 1 con error', { timeout: 90_000 });
    await expect(page.getByTestId('library-queue')).toContainText('Publicada en el commit', { timeout: 30_000 });
    expect(blobs).toBeGreaterThanOrEqual(3); // (una copia dentro del lote puede dejar un blob sin usar: no entra en el commit)
    expect(commits).toBe(1); // ...y las tres nuevas entraron en UN solo commit
    expect(puts).toBe(0);

    // Galería: filtro por colección y selección
    await page.getByLabel('Filtrar por colección').selectOption(COLLECTION);
    await expect(page.getByTestId('library-image')).toHaveCount(3);
    await page.getByRole('button', { name: 'Seleccionar todo lo visible' }).click();
    await expect(page.getByTestId('library-bulk')).toContainText('3 seleccionadas');

    // Pulsar una imagen abre su ventana: se inspecciona y se crea UN producto del catálogo con ella
    await page.getByRole('button', { name: /^Ver Calabaza gigante/ }).click();
    await expect(page.getByTestId('library-image-dialog')).toBeVisible();
    await page.getByTestId('library-create-product').click();
    await expect(page.getByLabel('Nombre del producto 1')).toHaveValue(/Calabaza gigante/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Crear productos', exact: true }).click();
    await expect(page.getByText(/1 producto creado/)).toBeVisible({ timeout: 30_000 });

    // Selección múltiple → crear productos (el nombre sale del título; el repetido se omite)
    await page.getByRole('button', { name: 'Seleccionar todo lo visible' }).click();
    await page.getByTestId('library-to-items').click();
    await expect(page.getByTestId('library-from-images')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Nombre del producto 1')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Crear productos', exact: true }).click();
    await expect(page.getByText(/2 productos creados/)).toBeVisible({ timeout: 30_000 });

    // Los productos se gestionan en su propia página (la de imágenes solo tiene fotos)
    await expect(page.getByLabel('Lista de productos')).toHaveCount(0);
    await page.goto('/admin/catalogo');
    await expect(page.getByLabel('Filtrar productos por colección')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.getByLabel('Filtrar productos por colección').selectOption(COLLECTION);
    await expect(page.getByTestId('library-item')).toHaveCount(3);

    // Añadir en bloque por texto: uno nuevo (con emoji) y uno repetido que se omite
    await page.getByText('Añadir muchos productos a la vez').click();
    await page.getByLabel('Colección de los productos nuevos').fill(COLLECTION);
    await page.getByLabel('Lista de productos').fill(`Escoba voladora; Para llegar a tiempo; 🧹\nFantasma ${stamp}`);
    await page.getByRole('button', { name: 'Añadir productos' }).click();
    await expect(page.getByText(/productos añadidos/)).toBeVisible({ timeout: 30_000 });

    // Vista de catálogo: buscar, editar un producto, y la IA está desactivada si no hay proveedor
    await page.getByLabel('Buscar productos').fill('Escoba');
    await expect(page.getByTestId('library-item')).toHaveCount(1, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Editar Escoba voladora' }).click();
    await page.getByTestId('library-item').getByLabel('Descripción del producto').fill('Con motor de ceniza');
    await page.getByTestId('library-item').getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Producto actualizado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('library-item')).toContainText('Con motor de ceniza');
    await expect(page.getByRole('button', { name: 'Subir foto de Escoba voladora' })).toBeVisible();

    // Asociar una imagen a un producto que ya existe (la escoba no tiene foto)
    await page.goto('/admin/biblioteca');
    await expect(page.getByTestId('library-dropzone')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.getByLabel('Filtrar por colección').selectOption(COLLECTION);
    await page.getByRole('button', { name: new RegExp(`^Ver Murcielago ${stamp}`) }).click();
    await page.getByTestId('library-associate').click();
    await page.getByLabel('Buscar productos del catálogo').fill('Escoba');
    await page.getByTestId('library-associate-item').filter({ hasText: COLLECTION }).getByRole('button', { name: 'Asociar a Escoba voladora' }).click();
    await expect(page.getByText(/Imagen asociada a «Escoba voladora»/)).toBeVisible({ timeout: 30_000 });
    const withPhoto = ((await (await ctx.request.post('/api/admin/library', { data: { op: 'items.list', collection: COLLECTION }, headers: ORIGIN })).json()) as { items: { name: string; image_id: string | null }[] }).items;
    expect(withPhoto.find((i) => i.name === 'Escoba voladora')?.image_id).toBeTruthy();

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

    // Superadmin: la portada de una plantilla del sistema se elige de la biblioteca
    await page.goto('/admin/plantillas/editor');
    await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /Siguiente/ }).click();
    await expect(page.getByLabel(/URL/i)).toHaveCount(0); // nunca se teclea una URL: se sube o se elige de la biblioteca
    await page.getByRole('button', { name: 'Elegir portada de la biblioteca' }).click();
    await page.getByLabel('Colección de imágenes').selectOption(COLLECTION);
    await expect(page.getByTestId('library-image-choice')).toHaveCount(3, { timeout: 30_000 });
    await page.getByTestId('library-image-choice').first().click();
    await expect(page.getByTestId('system-cover').locator('img')).toHaveAttribute('src', /cdn\.jsdelivr\.net\/gh\/e2e\/fotos@e2ec0de.*biblioteca\//);

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
