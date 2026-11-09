import { ComfyDiffError } from './errors';

export type TextMeta = Record<string, string>;

export type ContainerKind = 'png' | 'webp' | 'jpeg' | 'json' | 'unknown';

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

export function sniff(bytes: Uint8Array): ContainerKind {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';

  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0x7b ) return 'json';
  return 'unknown';
}

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = off; i < off + len && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

const defaultInflate: Inflate = async (data) => {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => unknown }).DecompressionStream;
  const R = (globalThis as unknown as { Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> } }).Response;
  const B = (globalThis as unknown as { Blob?: new (parts: unknown[]) => { stream(): { pipeThrough(t: unknown): unknown } } }).Blob;
  if (!DS || !R || !B) throw new ComfyDiffError('unsupported-format', 'Compressed PNG text chunks are not supported in this environment.');
  const out = new B([data]).stream().pipeThrough(new DS('deflate'));
  return new Uint8Array(await new R(out).arrayBuffer());
};

export async function readPngText(bytes: Uint8Array, inflate: Inflate = defaultInflate): Promise<TextMeta> {
  if (sniff(bytes) !== 'png') throw new ComfyDiffError('corrupt-file', 'Not a PNG file.');
  const out: TextMeta = {};
  let o = 8;
  while (o + 8 <= bytes.length) {
    const len = u32be(bytes, o);
    const type = ascii(bytes, o + 4, 4);
    const start = o + 8;
    const end = start + len;
    if (end > bytes.length) break;
    if (type === 'IEND') break;
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'comf') {
      const data = bytes.subarray(start, end);
      const z = data.indexOf(0);
      if (z > 0) {
        const keyword = latin1.decode(data.subarray(0, z));
        try {
          const text = await decodeTextChunk(type, data, z, inflate);
          if (text !== undefined && !(keyword in out)) out[keyword] = text;
        } catch {
        }
      }
    }
    o = end + 4;
  }
  return out;
}

async function decodeTextChunk(type: string, data: Uint8Array, z: number, inflate: Inflate): Promise<string | undefined> {
  if (type === 'tEXt') return latin1.decode(data.subarray(z + 1));
  if (type === 'comf') return utf8.decode(data.subarray(z + 1));
  if (type === 'zTXt') {
    return latin1.decode(await inflate(data.subarray(z + 2)));
  }

  const compressed = data[z + 1] === 1;
  let p = z + 3;
  const lang0 = data.indexOf(0, p);
  if (lang0 < 0) return undefined;
  const tk0 = data.indexOf(0, lang0 + 1);
  if (tk0 < 0) return undefined;
  p = tk0 + 1;
  const body = data.subarray(p);
  return utf8.decode(compressed ? await inflate(body) : body);
}

export function readExifAscii(tiff: Uint8Array): Map<number, string> {
  const res = new Map<number, string>();
  if (tiff.length < 8) return res;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return res;
  const le = order === 'II';
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return res;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    if (type !== 2 && type !== 7) continue;
    const off = count <= 4 ? e + 8 : u32(e + 8);
    if (off + count > tiff.length) continue;
    let s = utf8.decode(tiff.subarray(off, off + count));
    if (s.endsWith('\0')) s = s.slice(0, -1);
    res.set(tag, s);
  }
  return res;
}

function exifToMeta(tags: Map<number, string>): TextMeta {
  const out: TextMeta = {};
  for (const [, v] of [...tags].sort((a, b) => b[0] - a[0])) {
    const m = /^([A-Za-z_][\w-]*):\s*([{[][\s\S]*)$/.exec(v);
    if (m && !(m[1]! in out)) out[m[1]!] = m[2]!;
  }
  return out;
}

function stripExifHeader(b: Uint8Array): Uint8Array {
  return ascii(b, 0, 6) === 'Exif\0\0' ? b.subarray(6) : b;
}

export function readWebpText(bytes: Uint8Array): TextMeta {
  if (sniff(bytes) !== 'webp') throw new ComfyDiffError('corrupt-file', 'Not a WebP file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12;
  while (o + 8 <= bytes.length) {
    const type = ascii(bytes, o, 4);
    const len = view.getUint32(o + 4, true);
    const start = o + 8;
    if (start + len > bytes.length) break;
    if (type === 'EXIF') return exifToMeta(readExifAscii(stripExifHeader(bytes.subarray(start, start + len))));
    o = start + len + (len & 1);
  }
  return {};
}

export function readJpegText(bytes: Uint8Array): TextMeta {
  let o = 2;
  while (o + 4 <= bytes.length && bytes[o] === 0xff) {
    const marker = bytes[o + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const len = (bytes[o + 2]! << 8) | bytes[o + 3]!;
    const seg = bytes.subarray(o + 4, o + 2 + len);
    if (marker === 0xe1 && ascii(seg, 0, 6) === 'Exif\0\0') return exifToMeta(readExifAscii(seg.subarray(6)));
    o += 2 + len;
  }
  return {};
}

export function decodeUtf8(bytes: Uint8Array): string {
  const s = utf8.decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
