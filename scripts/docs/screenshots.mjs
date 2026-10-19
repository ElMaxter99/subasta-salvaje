#!/usr/bin/env node
/**
 * Regenera TODAS las capturas de docs/img/ con la app en MODO DEMO (PGlite, pegatinas locales sin IA).
 *
 *   node scripts/docs/screenshots.mjs            # compila (si falta) .next-shots, arranca, captura y limpia
 *   node scripts/docs/screenshots.mjs --rebuild  # fuerza recompilar
 *   node scripts/docs/screenshots.mjs --keep     # no borra .next-shots ni los datos temporales al terminar
 *   node scripts/docs/screenshots.mjs --only=tv,podio   # solo las capturas cuyo nombre contenga alguno de esos textos
 *   node scripts/docs/screenshots.mjs --url=http://localhost:3000   # usa una app ya arrancada en modo demo (no compila)
 *
 * Variables: PW_CHROMIUM_PATH (Chromium), SHOTS_PORT (3220), SHOTS_DATA_DIR (/tmp/ss-shots-data).
 * No usa el servidor de desarrollo (inestable en el sandbox): compila una build de producción aislada
 * (NEXT_DIST_DIR=.next-shots) y la sirve con `next start`. No toca .next ni .demo-data.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const sharp = require('sharp');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const PORT = process.env.SHOTS_PORT || '3220';
const EXTERNAL = opt('url');
const BASE = EXTERNAL || `http://localhost:${PORT}`;
const DIST = '.next-shots';
const DATA = process.env.SHOTS_DATA_DIR || '/tmp/ss-shots-data';
const OUT = path.join(ROOT, 'docs', 'img');
const ONLY = opt('only')?.split(',').filter(Boolean);
const MAX_KB = 240;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[capturas]', ...a);
const demoEnv = { ...process.env, ALLOW_DEMO_MODE: 'true', FORCE_DEMO_MODE: 'true', DEV_HIDE_BANNER: 'true', NEXT_DIST_DIR: DIST, DEMO_DATA_DIR: DATA };

let server = null;
function cleanup() {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  if (!flag('keep') && !EXTERNAL) {
    rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
    rmSync(DATA, { recursive: true, force: true });
  }
}
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

async function startServer() {
  if (EXTERNAL) return;
  if (flag('rebuild') || !existsSync(path.join(ROOT, DIST, 'BUILD_ID'))) {
    log('compilando la build aislada en', DIST, '(1–3 min)…');
    const b = spawnSync('npx', ['next', 'build'], { cwd: ROOT, env: demoEnv, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('Falló next build');
  }
  if (await fetch(`${BASE}/api/runtime`).then(() => true, () => false)) throw new Error(`El puerto ${PORT} ya está en uso: libéralo (fuser -k ${PORT}/tcp) o usa SHOTS_PORT`);
  rmSync(DATA, { recursive: true, force: true });
  log(`arrancando next start en el puerto ${PORT} (datos en ${DATA})`);
  server = spawn('npx', ['next', 'start', '-p', PORT], { cwd: ROOT, env: demoEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
}

async function waitReady() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/runtime`);
      if (r.ok) {
        const j = await r.json();
        if (j.mode && j.mode !== 'demo') throw new Error(`La app no está en modo demo (modo: ${j.mode}). No se captura nada.`);
        return;
      }
    } catch (e) {
      if (String(e.message).includes('modo demo')) throw e;
    }
    await sleep(1000);
  }
  throw new Error('La app no respondió a tiempo');
}

/** Guarda una captura como WebP ≤ MAX_KB (baja la calidad y, si hace falta, el ancho). */
async function save(name, buf, width) {
  mkdirSync(OUT, { recursive: true });
  let w = width;
  let out;
  for (const q of [88, 82, 76, 70, 62, 54]) {
    out = await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: q, effort: 5 }).toBuffer();
    if (out.length <= MAX_KB * 1024) break;
    if (q === 54) { w = Math.round(w * 0.85); out = await sharp(buf).resize({ width: w }).webp({ quality: 70 }).toBuffer(); }
  }
  writeFileSync(path.join(OUT, `${name}.webp`), out);
  log(`${name}.webp  ${(out.length / 1024).toFixed(0)} KB`);
}

const wanted = (name) => !ONLY || ONLY.some((o) => name.includes(o));

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); }))));
    await document.fonts?.ready;
  }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page, name, { width = 1280, full = false, clip, ms } = {}) {
  if (!wanted(name)) return;
  await settle(page, ms);
  const buf = await page.screenshot({ fullPage: full, clip, type: 'png' });
  await save(name, buf, width);
}

async function main() {
  await startServer();
  await waitReady();
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const mk = (viewport, extra = {}) => browser.newContext({ baseURL: BASE, viewport, reducedMotion: 'reduce', locale: 'es-ES', ...extra });
  const post = (ctx, url, data) => ctx.request.post(url, { data, headers: { origin: BASE } });

  try {
    // ---------- Inicio ----------
    if (wanted('inicio')) {
      const desk = await mk({ width: 1440, height: 900 });
      const p = await desk.newPage();
      await p.goto('/');
      await shot(p, 'inicio-escritorio', { width: 1440 });
      const mob = await mk({ width: 390, height: 844 }, { isMobile: true, deviceScaleFactor: 2, hasTouch: true });
      const m = await mob.newPage();
      await m.goto('/');
      await shot(m, 'inicio-movil', { width: 780 });
      await desk.close(); await mob.close();
    }

    // ---------- Asistente de nueva partida y plantillas ----------
    if (['asistente', 'plantilla', 'catalogo'].some(wanted)) {
      const ctx = await mk({ width: 1280, height: 900 });
      await post(ctx, '/api/auth/demo');
      const p = await ctx.newPage();
      await p.goto('/new-game');
      await p.getByTestId('template-import').waitFor({ timeout: 60_000 });
      await p.waitForTimeout(2500);
      await shot(p, 'asistente-paso1-quien-puja', { width: 1280 });
      await p.getByRole('radio', { name: /Cada jugador desde su móvil/ }).check();
      await p.getByRole('button', { name: /Siguiente/ }).click();
      await shot(p, 'asistente-paso2-casas', { width: 1280 });
      await p.getByRole('button', { name: /Siguiente/ }).click();
      await p.getByLabel('Nombre de la partida').fill('Noche de Subasta');
      // Importar una plantilla JSON y llegar al resumen
      if (wanted('plantilla') || wanted('catalogo')) {
        const tpl = {
          formato: 'subasta-salvaje/plantilla@1', nombre: 'Misión a la Luna', tematica: 'Base lunar',
          reglas: { presupuesto: 30, puja_minima: 1, rondas_maximas: 6, pujas_enteras: true, clasificacion: 'saldo', modo_juego: 'movil', modo_imagenes: 'pegatinas' },
          jugadores: ['Ana', 'Beto', 'Carla', 'Dani'],
          catalogo: [
            { titulo: 'Cráter', descripcion: 'Un cráter enorme para aparcar.', emoji: '🌑' },
            { titulo: 'Rover', descripcion: 'Vehículo lunar todoterreno.', emoji: '🚙' },
            { titulo: 'Bandera', descripcion: 'Para reclamar tu parcela.', emoji: '🚩' },
            { titulo: 'Cohete', descripcion: 'Billete de vuelta.', emoji: '🚀' },
            { titulo: 'Alienígena', descripcion: 'Vecino curioso.', emoji: '👽' },
            { titulo: 'Telescopio', descripcion: 'Para mirar la Tierra.', emoji: '🔭' },
          ],
        };
        const p2 = await (await mk({ width: 1280, height: 900 }).then(async (c) => { await post(c, '/api/auth/demo'); return c; })).newPage();
        await p2.goto('/new-game');
        await p2.getByTestId('template-import').waitFor({ timeout: 60_000 });
        await p2.waitForTimeout(2500);
        await p2.getByTestId('template-input').setInputFiles({ name: 'mision-luna.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tpl)) });
        await p2.getByTestId('wizard-step-6').waitFor();
        await p2.setViewportSize({ width: 1280, height: 1000 });
        await shot(p2, 'plantilla-importada-resumen', { width: 1280 });
        if (wanted('catalogo')) {
          await p2.getByRole('button', { name: 'Editar el catálogo' }).click();
          await p2.getByTestId('catalog-editor').waitFor();
          await p2.setViewportSize({ width: 1280, height: 1500 });
          await p2.evaluate(() => window.scrollTo(0, 0));
          await shot(p2, 'catalogo-editor', { width: 1280 });
        }
      }
      await ctx.close();
    }

    // ---------- Partida móvil completa: sala de espera → subasta → podio ----------
    const needGame = ['tv-', 'anfitrion', 'jugador', 'podio', 'resultados'].some(wanted);
    if (needGame) {
      const hostCtx = await mk({ width: 1440, height: 900 });
      const host = hostCtx;
      await post(host, '/api/auth/demo');
      const created = await post(host, '/api/games', {
        name: 'Noche de Subasta', play_mode: 'mobile', initial_budget_cents: 2000,
        players: ['Lucía', 'Marcos', 'Irene', 'Pablo'].map((name) => ({ name })),
      });
      if (!created.ok()) throw new Error('No se pudo crear la partida: ' + (await created.text()));
      const code = (await created.json()).room_code;
      log('partida de ejemplo', code);
      const act = async (data) => {
        const r = await post(host, `/api/games/${code}/actions`, data);
        if (!r.ok()) throw new Error(`${data.type}: ${r.status()} ${await r.text()}`);
        return r.json();
      };
      const state = async () => (await (await host.request.get(`/api/games/${code}`)).json()).snapshot;
      const names = ['Lucía', 'Marcos', 'Irene', 'Pablo'];
      const ids = Object.fromEntries((await state()).players.map((p) => [p.name, p.id]));
      const phones = {};
      for (const n of names) {
        phones[n] = await mk({ width: 390, height: 844 }, { isMobile: true, deviceScaleFactor: 2, hasTouch: true });
        const r = await post(phones[n], `/api/play/${code}/join`, { player_id: ids[n] });
        if (!r.ok()) throw new Error('join ' + n + ': ' + (await r.text()));
      }
      await act({ type: 'image.set_initial_all', catalog_id: 'house' });
      const uid = () => crypto.randomUUID();
      const processJobs = async () => { await post(host, `/api/games/${code}/jobs`, {}); };
      const waitJobs = async () => {
        for (let i = 0; i < 40; i++) {
          await processJobs();
          const s = await state();
          if (!(s.jobs ?? []).some((j) => ['queued', 'running', 'pending'].includes(j.status))) break;
          await sleep(500);
        }
      };

      // Sala de espera (TV)
      const tvCtx = await mk({ width: 1920, height: 1080 });
      const tv = await tvCtx.newPage();
      await tv.goto(`/game/${code}/screen`);
      await tv.waitForTimeout(3000);
      await shot(tv, 'tv-sala-de-espera', { width: 1600, ms: 1500 });

      // Compras previas para que las imágenes tengan pegatinas
      await act({ type: 'game.start' });
      const buys = [['Lucía', 400], ['Marcos', 600], ['Lucía', 300], ['Irene', 200]];
      for (const [who, price] of buys) {
        const s = await state();
        const item = s.items.find((i) => i.status === 'available');
        const a = await act({ type: 'auction.announce', item_id: item.id });
        const aid = a.snapshot.auction.id;
        await act({ type: 'auction.bid', auction_id: aid, player_id: ids[who], amount_cents: price, idempotency_key: uid() });
        await act({ type: 'auction.award', auction_id: aid, expected_winner_id: ids[who], expected_price_cents: price, idempotency_key: uid() });
      }
      await waitJobs();

      // Entre subastas: las imágenes en primer plano
      if (wanted('entre')) {
        await tv.reload();
        await tv.waitForTimeout(3000);
        await shot(tv, 'tv-entre-subastas', { width: 1600, ms: 1500 });
      }

      // Subasta abierta con pujas
      const s2 = await state();
      const item = s2.items.find((i) => i.status === 'available');
      const a = await act({ type: 'auction.announce', item_id: item.id });
      const aid = a.snapshot.auction.id;
      await act({ type: 'auction.bid', auction_id: aid, player_id: ids['Pablo'], amount_cents: 300, idempotency_key: uid() });
      await act({ type: 'auction.bid', auction_id: aid, player_id: ids['Marcos'], amount_cents: 500, idempotency_key: uid() });
      await sleep(1500);

      await tv.reload();
      await tv.waitForTimeout(3000);
      await shot(tv, 'tv-subasta-en-curso', { width: 1600, ms: 1500 });

      if (wanted('espectador')) {
        const sc = await mk({ width: 390, height: 844 }, { isMobile: true, deviceScaleFactor: 2, hasTouch: true });
        const sp = await sc.newPage();
        const watchKey = (await state()).spectator_token;
        await sp.goto(`/game/${code}/watch?k=${watchKey}`);
        await sp.waitForTimeout(2500);
        await shot(sp, 'espectador-movil', { width: 780, ms: 1500 });
        await sc.close();
      }

      if (wanted('anfitrion')) {
        const hp = await hostCtx.newPage();
        await hp.goto(`/game/${code}/host`);
        await hp.waitForLoadState('domcontentloaded');
        await hp.getByRole('tab', { name: /Subasta/ }).click({ timeout: 60_000 });
        await shot(hp, 'anfitrion-panel-subasta', { width: 1440, ms: 1500 });
      }
      if (wanted('jugador')) {
        const pp = await phones['Irene'].newPage();
        await pp.goto(`/game/${code}/play`);
        await pp.waitForTimeout(2500);
        await shot(pp, 'jugador-movil-pujando', { width: 780, ms: 1500 });
      }

      // Tarjeta «¿Quién puja?» (Resumen) y jugadores con su estado de conexión (Jugadores) en el panel del anfitrión
      if (wanted('anfitrion')) {
        const hq = await hostCtx.newPage();
        await hq.goto(`/game/${code}/host`);
        await hq.waitForLoadState('domcontentloaded');
        await hq.getByRole('tab', { name: /Resumen/ }).click({ timeout: 60_000 });
        await hq.getByTestId('access-card').scrollIntoViewIfNeeded({ timeout: 60_000 });
        await shot(hq, 'anfitrion-quien-puja', { width: 1440, ms: 1500 });
        await hq.close();
      }

      // Un móvil se desconecta: Pablo deja de dar señales (>40 s) mientras los demás siguen latiendo
      if (wanted('desconectado') || wanted('anfitrion')) {
        const beat = () => Promise.all(names.map((n) => (n === 'Pablo' && beatCount > 0 ? null : post(phones[n], `/api/play/${code}/ping`, {}))));
        let beatCount = 0;
        await beat(); // primer latido de todos
        beatCount = 1;
        for (let t = 0; t < 46; t += 10) { await sleep(10_000); await beat(); } // ~46 s: Pablo ya no late
        await tv.reload();
        await tv.waitForTimeout(3000);
        await shot(tv, 'tv-desconectado', { width: 1600, ms: 1500 });
        if (wanted('anfitrion')) {
          const hj = await hostCtx.newPage();
          await hj.goto(`/game/${code}/host`);
          await hj.waitForLoadState('domcontentloaded');
          await hj.getByRole('tab', { name: /Jugadores/ }).click({ timeout: 60_000 });
          await hj.getByText(/Desconectado/).first().waitFor({ timeout: 60_000 });
          await hj.getByText(/Desconectado/).first().scrollIntoViewIfNeeded();
          await hj.evaluate(() => window.scrollBy(0, -140)); // un poco de aire por encima de su tarjeta
          await shot(hj, 'anfitrion-jugadores-presencia', { width: 1440, ms: 1500 });
          await hj.close();
        }
      }

      // Cerrar la subasta y terminar la partida; votar para llegar al podio
      if (wanted('podio') || wanted('resultados')) {
        await act({ type: 'auction.award', auction_id: aid, expected_winner_id: ids['Marcos'], expected_price_cents: 500, idempotency_key: uid() });
        await waitJobs();
        await act({ type: 'game.finish' });
        await tv.reload();
        await tv.getByTestId('gallery-open').waitFor({ timeout: 60_000 });
        const vp = await phones['Irene'].newPage();
        await vp.goto(`/game/${code}/play`);
        await vp.getByTestId('gallery-vote').waitFor({ timeout: 60_000 });
        await shot(vp, 'jugador-movil-votacion', { width: 780, ms: 1500 });
        const vote = (who, target) => post(phones[who], `/api/play/${code}/vote`, { target_id: ids[target] });
        for (const [who, target] of [['Lucía', 'Marcos'], ['Marcos', 'Lucía'], ['Irene', 'Marcos'], ['Pablo', 'Marcos']]) {
          const r = await vote(who, target);
          if (!r.ok()) throw new Error(`voto ${who}: ${await r.text()}`);
        }
        await tv.getByTestId('podium-view').waitFor({ timeout: 60_000 });
        await shot(tv, 'tv-podio-resultados', { width: 1600, ms: 2500 });
        const rp = await (await mk({ width: 1280, height: 900 })).newPage();
        await rp.goto(`/game/${code}/results`);
        await rp.getByTestId('podium-view').waitFor({ timeout: 60_000 });
        await shot(rp, 'resultados-podio', { width: 1280, full: true, ms: 2000 });
      }
      for (const c of [hostCtx, tvCtx, ...Object.values(phones)]) await c.close();
    }

    // ---------- Superadmin ----------
    if (wanted('admin')) {
      const ctx = await mk({ width: 1440, height: 900 });
      await post(ctx, '/api/auth/demo');
      const p = await ctx.newPage();
      await p.goto('/admin');
      await p.getByRole('heading', { name: /Peso: base de datos y almacenamiento/ }).waitFor({ timeout: 60_000 });
      await shot(p, 'superadmin-resumen', { width: 1440, ms: 1500 });
      if (wanted('observabilidad')) {
        await p.goto('/admin/observabilidad');
        await p.getByText('Errores agrupados').first().waitFor({ timeout: 60_000 });
        await shot(p, 'admin-observabilidad', { width: 1440, ms: 1500 });
      }
      if (wanted('biblioteca')) {
        await p.goto('/admin/biblioteca');
        await p.getByText('Cobertura y calidad').first().waitFor({ timeout: 60_000 });
        await shot(p, 'admin-biblioteca', { width: 1440, ms: 1500 });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  log('listo. Revisa docs/img/ y recuerda que son capturas del modo demo (pegatinas locales sin IA).');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
