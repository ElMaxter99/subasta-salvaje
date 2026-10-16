import { deflateRawSync } from 'node:zlib';

/** Escritor de ZIP mínimo para pruebas (stored o deflate). */
export function makeZip(files: Record<string, Uint8Array | string>, opts: { deflate?: boolean; flags?: number } = {}): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const w16 = (n: number) => Uint8Array.of(n & 255, (n >> 8) & 255);
  const w32 = (n: number) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const comp = opts.deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const method = opts.deflate ? 8 : 0;
    const nameB = enc.encode(name);
    const local = cat(w32(0x04034b50), w16(20), w16(opts.flags ?? 0), w16(method), w16(0), w16(0), w32(0), w32(comp.length), w32(data.length), w16(nameB.length), w16(0), nameB, comp);
    central.push(cat(w32(0x02014b50), w16(20), w16(20), w16(opts.flags ?? 0), w16(method), w16(0), w16(0), w32(0), w32(comp.length), w32(data.length), w16(nameB.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(offset), nameB));
    parts.push(local);
    offset += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, w32(0x06054b50), w16(0), w16(0), w16(central.length), w16(central.length), w32(cd.length), w32(offset), w16(0));
}
