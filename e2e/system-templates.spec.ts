import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const TITLE = `Noche en la luna ${stamp}`;
/** Avanza `n` pasos del asistente del superadmin con «Siguiente». */
async function next(page: import('@playwright/test').Page, n: number) {
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: /Siguiente/ }).click();
}

test('partidas del sistema: el superadmin crea y publica una plantilla; el anfitrión la ve, la carga y crea la partida', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
  const page = await ctx.newPage();

  // Sin plantillas publicadas no aparece la sección
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });

  // Superadmin: el mismo recorrido de pasos que el anfitrión, con un paso de ficha, y SIN «¿Tienes una plantilla?»
  await page.goto('/admin/plantillas');
  await page.getByRole('link', { name: 'Nueva plantilla' }).click();
  await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('template-import')).toHaveCount(0);
  await next(page, 2); // Quién puja → Casas → Partida
  await page.getByLabel('Nombre de la partida').fill(TITLE);
  await next(page, 3); // Reglas → Jugadores → Ficha
  await expect(page.getByTestId('system-step')).toBeVisible();
  await page.getByLabel('Título de la tarjeta').fill(TITLE);
  await page.getByLabel('Identificador (carpeta de las fotos)').fill(`noche-luna-${stamp}`);
  await page.getByLabel('Descripción (hasta 300 caracteres)').fill('Una subasta lunar para empezar rápido');
  await next(page, 1);
  const N = Number(await page.getByTestId('summary-catalog').locator('b').first().innerText()); // elementos del catálogo (el de la temática, ya editable)
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 30_000 });
  const row = page.getByTestId('system-template-row').filter({ hasText: TITLE });
  await expect(row).toContainText('Borrador');

  // Un borrador no lo ve el anfitrión
  const titles = async () => (((await (await ctx.request.get('/api/system-templates')).json()) as { templates: { title: string }[] }).templates).map((t) => t.title);
  expect(await titles()).not.toContain(TITLE);

  // Publicar (sin imágenes no hay nada que descargar)
  await row.getByRole('button', { name: 'Publicar' }).click();
  await expect(row).toContainText('Publicada');
  await expect(page.getByText('Plantilla publicada')).toBeVisible();

  // Anfitrión: la tarjeta aparece, se usa y rellena el asistente
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  const card = page.getByTestId('system-template-card').filter({ hasText: TITLE });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(`${N} elementos`);
  await card.getByRole('button', { name: /Usar la partida del sistema/ }).click();
  await expect(page.getByTestId('summary-catalog')).toContainText(`${N} elementos`); // el asistente salta al Resumen con la plantilla cargada
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  await expect(page.getByText(TITLE).first()).toBeVisible();

  // Retirar: vuelve a ser borrador y desaparece para los anfitriones
  await page.goto('/admin/plantillas');
  await page.getByTestId('system-template-row').filter({ hasText: TITLE }).getByRole('button', { name: 'Retirar' }).click();
  await expect(page.getByTestId('system-template-row').filter({ hasText: TITLE })).toContainText('Borrador');
  expect(await titles()).not.toContain(TITLE);

  // Limpieza: borrar la plantilla de la prueba
  await page.getByTestId('system-template-row').filter({ hasText: TITLE }).getByRole('button', { name: 'Borrar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
  await expect(page.getByTestId('system-template-row').filter({ hasText: TITLE })).toHaveCount(0);

  // Un anfitrión que no es superadmin recibe 404 en las rutas de administración
  const anon = await browser.newContext();
  expect((await anon.request.get('/api/admin/system-templates')).status()).toBe(404);
  expect((await anon.request.post('/api/admin/system-templates', { data: { op: 'delete', id: '00000000-0000-4000-8000-000000000000' }, headers: { origin: 'http://localhost:3210' } })).status()).toBe(404);
  await anon.close();
  await ctx.close();
});

test('imágenes de una plantilla: se quedan en la vista y solo se suben, en UN commit, al guardar; al editar se borran las que sobran', async ({ browser }) => {
  // Servidor local que imita la API de GitHub (el servidor de la app apunta aquí por GITHUB_ASSETS_API_BASE)
  let puts = 0, blobs = 0, commits = 0;
  const repo = new Set<string>();
  const trees: { path: string; sha: string | null }[][] = [];
  const hex40 = (n: number) => n.toString(16).padStart(40, '0');
  const stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const url = decodeURIComponent(req.url ?? '');
      if (req.method === 'POST' && url.endsWith('/git/blobs')) { blobs++; res.statusCode = 201; res.end(JSON.stringify({ sha: hex40(blobs) })); }
      else if (req.method === 'POST' && url.endsWith('/git/trees')) {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { tree: { path: string; sha: string | null }[] };
        trees.push(body.tree);
        for (const e of body.tree) { if (e.sha === null) repo.delete(e.path); else repo.add(e.path); }
        res.statusCode = 201; res.end(JSON.stringify({ sha: hex40(9000) }));
      }
      else if (req.method === 'POST' && url.endsWith('/git/commits')) { commits++; res.statusCode = 201; res.end(JSON.stringify({ sha: 'stub0000sha' })); }
      else if (req.method === 'PATCH' && url.includes('/git/refs/heads/')) res.end('{}');
      else if (req.method === 'PUT') { puts++; res.statusCode = 201; res.end(JSON.stringify({ commit: { sha: 'stub0000sha' } })); }
      else if (req.method === 'GET' && url.includes('/git/trees/')) {
        const dir = url.split(':').pop()!;
        res.end(JSON.stringify({ tree: [...repo].filter((p) => p.startsWith(`${dir}/`)).map((p) => ({ path: p.slice(dir.length + 1), type: 'blob' })) }));
      } else if (url.includes('/git/commits/')) res.end(JSON.stringify({ tree: { sha: hex40(8000) } }));
      else if (url.includes('/commits/')) res.end(JSON.stringify({ sha: 'stub0000sha' }));
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise<void>((r) => stub.listen(3299, '127.0.0.1', r));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
    const page = await ctx.newPage();
    await page.goto('/admin/plantillas/editor');
    await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await next(page, 5); // Quién puja → Casas → Partida → Reglas → Jugadores → Ficha
    await expect(page.getByTestId('template-dropzone')).toBeVisible();

    const k = parseInt(stamp, 36) % 200; // contenido único por ejecución
    const photo = (color: string) => sharp({ create: { width: 1600 + (k % 31), height: 1200, channels: 3, background: color } }).jpeg().toBuffer();
    const file = async (name: string, color: string) => ({ name, mimeType: 'image/jpeg', buffer: await photo(color) });
    await page.getByLabel('Título de la tarjeta').fill(`Subida ${stamp}`);
    await page.getByLabel('Identificador (carpeta de las fotos)').fill(`subida-${stamp}`);
    await page.getByLabel('Elegir imágenes').setInputFiles([await file('portada.jpg', `rgb(${200 - k % 50}, 50, 50)`), await file('Casa-Inicial.jpg', `rgb(50, ${200 - k % 50}, 50)`), await file('piscina-infinita.jpg', `rgb(50, 50, ${200 - k % 50})`), await file('IMG_0001.jpg', `rgb(200, 200, ${k % 90})`)]);
    const list = page.getByTestId('upload-list');
    await expect(list.getByText(/^Portada · se subirá al guardar/)).toBeVisible();
    await expect(list.getByText(/^Casa inicial · se subirá al guardar/)).toBeVisible();
    await expect(list.getByText(/^Elemento · Piscina infinita · se subirá al guardar/)).toBeVisible();
    await expect(list.getByText('No encaja con la portada')).toBeVisible();
    await list.getByLabel('Asignar IMG_0001.jpg').selectOption({ label: 'Elemento · Sofá gigante' });
    await expect(list.getByText(/^Elemento · Sofá gigante · se subirá al guardar/)).toBeVisible();
    // Vista previa local y NADA enviado todavía a GitHub
    await expect(page.getByTestId('system-cover').locator('img')).toHaveAttribute('src', /^blob:/);
    expect([blobs, commits, puts]).toEqual([0, 0, 0]);

    // Resumen y guardado: ahora se preparan 4 imágenes y entran en UN solo commit; los enlaces quedan fijados a él
    await next(page, 1);
    await expect(page.getByText(/Portada: ✔ · Casa inicial: ✔ · Fotos: 2\//)).toBeVisible();
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 60_000 });
    expect(blobs).toBe(4);
    expect(commits).toBe(1);
    expect(puts).toBe(0);
    const row = page.getByTestId('system-template-row').filter({ hasText: `subida-${stamp}` });
    await expect(row).toContainText('casa inicial');
    const id = (await (await ctx.request.get('/api/admin/system-templates')).json()).templates.find((t: { slug: string }) => t.slug === `subida-${stamp}`).id as string;
    const read = async () => ((await (await ctx.request.post('/api/admin/system-templates', { data: { op: 'get', id }, headers: { origin: 'http://localhost:3210' } })).json()) as { data: { portada: string; casa_inicial: string; catalogo: { titulo: string; foto?: string }[] } }).data;
    const first = await read();
    expect(first.portada).toMatch(new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/e2e/fotos@stub0000sha/plantillas/subida-${stamp}/cover-portada-[0-9a-f]{12}\\.webp$`));
    expect(first.casa_inicial).toContain('/scene-casa-inicial-');
    expect(first.catalogo.find((i) => i.titulo === 'Piscina infinita')!.foto).toContain('/item-piscina-infinita-');
    expect(first.catalogo.find((i) => i.titulo === 'Sofá gigante')!.foto).toContain('/item-sofa-gigante-');
    const oldCover = first.portada.split('@stub0000sha/')[1]!;
    const oldPool = first.catalogo.find((i) => i.titulo === 'Piscina infinita')!.foto!.split('@stub0000sha/')[1]!;
    expect(repo.has(oldCover) && repo.has(oldPool)).toBe(true);

    // Editar: cambiar la portada por otra y quitar la foto de la piscina; al guardar UN commit sube la nueva y borra las dos viejas
    await page.goto(`/admin/plantillas/editor?id=${id}`);
    await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await next(page, 5);
    await page.getByLabel('Subir portada').setInputFiles(await file('otra.jpg', `rgb(10, ${100 + k % 90}, 200)`));
    await expect(page.getByTestId('system-cover').locator('img')).toHaveAttribute('src', /^blob:/);
    await next(page, 1);
    await page.getByRole('button', { name: 'Editar el catálogo' }).click();
    await page.getByLabel('Quitar la foto del elemento 1', { exact: true }).click();
    await page.getByRole('button', { name: 'Listo' }).click();
    expect([blobs, commits]).toEqual([4, 1]); // seguimos sin subir nada
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 60_000 });
    expect(blobs).toBe(5);
    expect(commits).toBe(2);
    expect(trees.at(-1)!.filter((e) => e.sha === null).map((e) => e.path).sort()).toEqual([oldCover, oldPool].sort());
    expect(repo.has(oldCover) || repo.has(oldPool)).toBe(false);
    const second = await read();
    expect(second.portada).not.toBe(first.portada);
    expect(second.catalogo.find((i) => i.titulo === 'Piscina infinita')!.foto).toBeFalsy();
    expect(second.catalogo.find((i) => i.titulo === 'Sofá gigante')!.foto).toBe(first.catalogo.find((i) => i.titulo === 'Sofá gigante')!.foto); // lo que no cambia no se toca

    // Borrar el borrador de la prueba
    await row.getByRole('button', { name: 'Borrar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
    await expect(row).toHaveCount(0);
  } finally {
    await ctx.close();
    await new Promise<void>((r) => stub.close(() => r()));
  }
});

test('editor visual: editar sin tocar el JSON (espacios, catálogo, orden, créditos) y ver los créditos en la tarjeta', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  const TV = `Visual ${stamp}`;
  await page.goto('/admin/plantillas/editor');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await next(page, 2); // Quién puja → Casas → Partida

  // Escribir con espacios no se «come» el espacio final mientras se teclea
  const nombre = page.getByLabel('Nombre de la partida');
  await nombre.fill('');
  await nombre.pressSequentially('Noche de prueba total');
  await expect(nombre).toHaveValue('Noche de prueba total');
  await next(page, 3); // Reglas → Jugadores → Ficha

  // Ficha: título, identificador y créditos (sin portada, así no hay imágenes que descargar al publicar)
  await page.getByLabel('Título de la tarjeta').fill(TV);
  await page.getByLabel('Identificador (carpeta de las fotos)').fill(`visual-${stamp}`);
  await page.getByLabel('Créditos de las imágenes (opcional)').fill('Dibujos propios y Wikimedia Commons');
  await next(page, 1);

  // Catálogo (el de la temática, ya editable): añadir uno, renombrarlo, subirlo al principio y quitar otro
  await page.getByRole('button', { name: 'Editar el catálogo' }).click();
  const total = await page.locator('[data-testid^="catalog-row-"]').count();
  await page.getByRole('button', { name: 'Añadir elemento' }).click();
  await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(total + 1);
  await page.getByLabel(`Título del elemento ${total + 1}`).fill('Calabaza gigante');
  await page.getByLabel(`Crédito de la foto del elemento ${total + 1}`).fill('Autor X · CC BY');
  for (let i = total + 1; i > 1; i--) await page.getByLabel(`Subir el elemento ${i}`).click();
  await expect(page.getByLabel('Título del elemento 1', { exact: true })).toHaveValue('Calabaza gigante');
  await page.getByLabel('Quitar el elemento 2', { exact: true }).click();
  await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(total);
  await page.getByRole('button', { name: 'Listo' }).click();

  // Guardar, publicar y ver la tarjeta con sus créditos
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 30_000 });
  const row = page.getByTestId('system-template-row').filter({ hasText: TV });
  await expect(row).toContainText('Borrador');
  await row.getByRole('button', { name: 'Publicar' }).click();
  await expect(row).toContainText('Publicada');
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  const card = page.getByTestId('system-template-card').filter({ hasText: TV });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('system-template-credits')).toContainText('Dibujos propios y Wikimedia Commons');

  // Limpieza
  await page.goto('/admin/plantillas');
  const r2 = page.getByTestId('system-template-row').filter({ hasText: TV });
  await r2.getByRole('button', { name: 'Borrar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
  await expect(r2).toHaveCount(0);
  await ctx.close();
});
