/**
 * Laboratorio de prompts de edición con IA: prueba contra el proveedor REAL configurado (gasta cuota gratuita) cómo se mezclan
 * una imagen base y una o varias imágenes de elementos, encadenando cada resultado como base del siguiente, igual que en la partida
 * (con las mismas funciones: prompt, tamaño y guardia de zona).
 *
 *   npm run ai:lab -- --base casa.jpg --items pikachu.jpg,barca.jpg --out lab-salida
 *   npm run ai:lab -- --base batido.jpg --items fresa.jpg,galleta.jpg --names "Fresa,Galleta" --theme "batido de leche"
 *
 * Escribe `paso-1.png`, `paso-2.png`… y `prompts.txt` en la carpeta de salida. Requiere IMAGE_PROVIDERS (o IMAGE_PROVIDER) y las
 * credenciales del proveedor en .env.local. No guarda nada en la base de datos ni en el almacenamiento.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { getContext } from '@/lib/services/context';
import { buildEditPrompt } from '@/lib/ai/prompts';
import { preserveOutsideZone } from '@/lib/ai/region-guard';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const mimeOf = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');

async function main() {
  const baseFile = arg('base');
  const itemFiles = (arg('items') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!baseFile || itemFiles.length === 0) {
    console.error('Uso: npm run ai:lab -- --base base.jpg --items uno.jpg,dos.jpg [--names "Uno,Dos"] [--theme "texto"] [--out carpeta] [--no-guard]');
    process.exit(1);
  }
  const names = (arg('names') ?? '').split(',').map((s) => s.trim());
  const theme = arg('theme') ?? 'free';
  const out = arg('out') ?? 'lab-salida';
  mkdirSync(out, { recursive: true });
  const ctx = await getContext();
  if (!ctx.provider) { console.error('No hay proveedor de IA configurado (IMAGE_PROVIDERS y credenciales en .env.local).'); process.exit(1); }
  console.log(`Proveedor: ${ctx.provider.id} · edición ${ctx.provider.capabilities.edit ? 'real' : 'por composición'}`);

  let current: { bytes: Uint8Array; mime: string } = { bytes: new Uint8Array(readFileSync(baseFile)), mime: mimeOf(baseFile) };
  const previousItems: string[] = [];
  const log: string[] = [];
  for (const [i, f] of itemFiles.entries()) {
    const name = names[i] || basename(f, extname(f));
    const input = { base: current, itemImage: { bytes: new Uint8Array(readFileSync(f)), mime: mimeOf(f) }, theme, itemName: name, itemDescription: '', itemEmoji: null, previousItems: [...previousItems] };
    console.log(`Paso ${i + 1}: añadiendo «${name}»…`);
    const edited = await ctx.provider.editScene(input);
    let bytes = edited.bytes;
    let note = 'sin guardia';
    if (previousItems.length > 0 && !process.argv.includes('--no-guard') && !edited.model.endsWith('+compose')) {
      const g = await preserveOutsideZone(current.bytes, edited.bytes, previousItems.length);
      bytes = g.bytes;
      note = `guardia: ${g.applied ? 'aplicada' : 'no aplicada'} (${g.note})`;
    }
    writeFileSync(join(out, `paso-${i + 1}.png`), bytes);
    log.push(`## Paso ${i + 1} · ${name} · ${edited.model} · ${note}\n${buildEditPrompt(input)}\n`);
    current = { bytes, mime: 'image/png' };
    previousItems.push(name);
  }
  writeFileSync(join(out, 'prompts.txt'), log.join('\n'));
  console.log(`Listo: ${out}/paso-N.png y prompts.txt`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
