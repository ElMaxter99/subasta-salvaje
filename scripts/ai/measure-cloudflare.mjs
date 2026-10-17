// Mide una llamada REAL a Cloudflare Workers AI (1 generación y, opcionalmente, 1 edición) para calcular cuánta cuota gratuita
// diaria (neuronas) gasta cada tipo de llamada con TUS ajustes. Lo ejecuta el propietario, a mano: gasta cuota gratuita real.
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/ai/measure-cloudflare.mjs --yes [--edit] [--size=768x512]
//
// Cloudflare no devuelve las neuronas gastadas en la respuesta: apunta el uso de «Workers AI» en su panel (dash.cloudflare.com →
// Workers AI → Usage) ANTES y DESPUÉS de ejecutarlo y divide la diferencia entre las llamadas (puede tardar unos minutos en
// reflejarse). Sin --yes no hace ninguna llamada. Nunca imprime el token. Honestidad: este script NO se ha ejecutado contra el servicio real.
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const GEN = process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-1-schnell';
const EDIT = process.env.CLOUDFLARE_EDIT_MODEL?.trim() || '@cf/black-forest-labs/flux-2-klein-4b';
const [w, h] = opt('size', '1024x768').split('x').map(Number);

if (!account || !token) {
  console.error('Faltan CLOUDFLARE_ACCOUNT_ID y/o CLOUDFLARE_API_TOKEN en el entorno (no los pegues en el chat ni los guardes en el repo).');
  process.exit(1);
}
if (!flag('yes')) {
  console.log(`Vista previa (no se llama a nada). Con --yes haría: 1 generación (${GEN}, 4 pasos)${flag('edit') ? ` y 1 edición (${EDIT}, ${w}×${h}, 2 referencias de 480 px)` : ''}.`);
  console.log('Apunta antes el uso de Workers AI en el panel de Cloudflare y compáralo después.');
  process.exit(0);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run`;
async function call(label, model, init) {
  const t0 = Date.now();
  const res = await fetch(`${base}/${model}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) }, body: init.form ?? JSON.stringify(init.json), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  const ms = Date.now() - t0;
  let kb = 0;
  try { kb = Math.round(Buffer.from(JSON.parse(text)?.result?.image ?? '', 'base64').length / 1024); } catch { /* respuesta no JSON */ }
  const msg = res.ok ? '' : ` · ${text.slice(0, 200).replaceAll(token, '***')}`;
  console.log(`${label}: HTTP ${res.status} · ${ms} ms · imagen ≈ ${kb} KB${msg}`);
  return res.ok ? JSON.parse(text).result.image : null;
}

const img = await call('generación', GEN, { json: { prompt: 'a small bright empty modern house, isometric cutaway, no text', steps: 4 } });
if (flag('edit')) {
  const ref = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#88aadd' } }).png().toBuffer();
  const item = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#cc4444' } }).png().toBuffer();
  const form = new FormData();
  form.set('prompt', 'Image 0 is the scene. Add the object from image 1 into the scene, keep everything else.');
  form.set('width', String(w));
  form.set('height', String(h));
  form.set('input_image_0', new Blob([img ? Buffer.from(img, 'base64') : ref], { type: 'image/png' }), 'scene.png');
  form.set('input_image_1', new Blob([item], { type: 'image/png' }), 'item.png');
  await call(`edición ${w}×${h}`, EDIT, { form });
}
console.log('\nSiguiente paso: mira el uso en Workers AI → Usage, resta el valor de antes y divide entre las llamadas hechas. Anótalo en docs/PLAN-PROVEEDORES-IA.md (§3) y ajusta IMAGE_QUOTA_PER_DAY.');
