import { isLocalPhotoPath, parseTemplate, templateToForm, type TemplateFormValues, type TemplateParse } from './template';

/**
 * Lectura de un ZIP de plantilla (en el navegador, sin dependencias): `plantilla.json` en la raíz y las fotos en `fotos/`.
 * Soporta entradas «stored» y «deflate» (sin cifrar, sin ZIP64). El archivo es entrada NO confiable: límites de entradas y de
 * tamaño real descomprimido (contra «zip bombs»), nombres normalizados y nunca se escribe nada en disco.
 */
export const ZIP_LIMITS = { entries: 300, photoBytes: 7 * 1024 * 1024, totalBytes: 40 * 1024 * 1024, fileBytes: 40 * 1024 * 1024 } as const;
export class ZipError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

async function inflate(data: Uint8Array, max: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new ZipError('Un archivo del ZIP descomprimido es demasiado grande.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Devuelve las entradas (nombre normalizado en minúsculas → bytes). */
export async function readZip(bytes: Uint8Array): Promise<Map<string, { name: string; data: Uint8Array }>> {
  if (bytes.length > ZIP_LIMITS.fileBytes) throw new ZipError('El ZIP es demasiado grande.');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('No es un archivo ZIP válido.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new ZipError('Los ZIP64 no se admiten.');
  if (count > ZIP_LIMITS.entries) throw new ZipError(`El ZIP tiene demasiados archivos (máximo ${ZIP_LIMITS.entries}).`);
  const out = new Map<string, { name: string; data: Uint8Array }>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new ZipError('El ZIP está dañado.');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const csize = u32(bytes, p + 20);
    const usize = u32(bytes, p + 24);
    const nlen = u16(bytes, p + 28);
    const elen = u16(bytes, p + 30);
    const clen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const rawName = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    const name = rawName.replace(/\\/g, '/');
    if (name.endsWith('/')) continue; // carpeta
    if (name.startsWith('__MACOSX/') || name.split('/').pop()!.startsWith('.')) continue; // basura de macOS / ocultos
    if (flags & 1) throw new ZipError('Los ZIP con contraseña no se admiten.');
    if (usize > ZIP_LIMITS.photoBytes) throw new ZipError(`«${name}» es demasiado grande (máximo 7 MB por archivo).`);
    if (u32(bytes, local) !== 0x04034b50) throw new ZipError('El ZIP está dañado.');
    const dataStart = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const comp = bytes.subarray(dataStart, dataStart + csize);
    let data: Uint8Array;
    if (method === 0) data = comp;
    else if (method === 8) data = await inflate(comp, ZIP_LIMITS.photoBytes);
    else throw new ZipError(`«${name}» usa una compresión no admitida.`);
    total += data.length;
    if (total > ZIP_LIMITS.totalBytes) throw new ZipError('El contenido del ZIP es demasiado grande.');
    out.set(name.toLowerCase(), { name, data });
  }
  return out;
}

export interface ZipFormValues extends Omit<TemplateFormValues, 'items'> {
  items: (NonNullable<TemplateFormValues['items']>[number] & { photoFile: { data: Uint8Array; type: string; name: string } | null })[] | null;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Lee un ZIP de plantilla: valida `plantilla.json` y resuelve las fotos incrustadas (`fotos/archivo.jpg`). */
export async function parseTemplateZip(bytes: Uint8Array): Promise<{ ok: true; values: ZipFormValues; warnings: string[]; summary: Extract<TemplateParse, { ok: true }>['template'] } | { ok: false; errors: string[] }> {
  let files: Awaited<ReturnType<typeof readZip>>;
  try {
    files = await readZip(bytes);
  } catch (e) {
    return { ok: false, errors: [e instanceof ZipError ? e.message : 'No se pudo leer el ZIP.'] };
  }
  const json = files.get('plantilla.json');
  if (!json) return { ok: false, errors: ['El ZIP debe contener «plantilla.json» en la raíz (y las fotos en la carpeta «fotos/»).'] };
  const parsed = parseTemplate(new TextDecoder().decode(json.data), { zip: true });
  if (!parsed.ok) return parsed;
  const base = templateToForm(parsed.template);
  const warnings = [...parsed.warnings];
  const items = base.items?.map((it) => {
    let photoFile: ZipFormValues['items'] extends (infer U)[] | null ? (U extends { photoFile: infer F } ? F : never) : never = null;
    if (it.photoPath && isLocalPhotoPath(it.photoPath)) {
      const key = it.photoPath.toLowerCase();
      const hit = files.get(key) ?? files.get(`fotos/${key}`);
      const ext = (hit?.name.split('.').pop() ?? '').toLowerCase();
      if (!hit) warnings.push(`«${it.name}»: no se encontró la foto «${it.photoPath}» dentro del ZIP.`);
      else if (!MIME[ext]) warnings.push(`«${it.name}»: la foto «${hit.name}» no es PNG, JPG ni WebP.`);
      else photoFile = { data: hit.data, type: MIME[ext]!, name: hit.name };
    }
    return { ...it, photoFile };
  });
  return { ok: true, values: { ...base, items: items ?? null }, warnings, summary: parsed.template };
}
