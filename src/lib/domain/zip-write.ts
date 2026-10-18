import { deflateRawSync } from 'node:zlib';

/**
 * Escritor de ZIP en streaming, sin dependencias (solo servidor): complementa a `template-zip.ts` (lector).
 * Entradas «stored» (imágenes ya comprimidas) o «deflate» (texto), nombres UTF-8, sin cifrar ni ZIP64
 * (cada archivo y el total deben ser < 4 GB; el exportador impone límites mucho menores).
 */
export interface ZipEntry { name: string; data: Uint8Array; deflate?: boolean }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const w16 = (n: number) => Uint8Array.of(n & 255, (n >> 8) & 255);
const w32 = (n: number) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of a) { o.set(x, p); p += x.length; }
  return o;
};

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

/** Genera los trozos del ZIP a medida que se consumen las entradas (no hace falta tenerlas todas en memoria). */
export async function* zipChunks(entries: AsyncIterable<ZipEntry>, now = new Date()): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const central: Uint8Array[] = [];
  let offset = 0;
  for await (const e of entries) {
    const nameB = enc.encode(e.name);
    const comp = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const method = e.deflate ? 8 : 0;
    const crc = crc32(e.data);
    const local = cat(w32(0x04034b50), w16(20), w16(0x0800), w16(method), w16(time), w16(date), w32(crc), w32(comp.length), w32(e.data.length), w16(nameB.length), w16(0), nameB);
    central.push(cat(w32(0x02014b50), w16(20), w16(20), w16(0x0800), w16(method), w16(time), w16(date), w32(crc), w32(comp.length), w32(e.data.length), w16(nameB.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(offset), nameB));
    yield local;
    yield comp;
    offset += local.length + comp.length;
  }
  const cd = cat(...central);
  yield cd;
  yield cat(w32(0x06054b50), w16(0), w16(0), w16(central.length), w16(central.length), w32(cd.length), w32(offset), w16(0));
}

export function zipStream(entries: AsyncIterable<ZipEntry>, now?: Date): ReadableStream<Uint8Array> {
  const it = zipChunks(entries, now);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await it.next();
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() { await it.return(undefined); },
  });
}
