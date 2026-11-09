import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'fixtures');

type W = [name: string, value: unknown];
interface SpecNode {
  id: number;
  type: string;
  title?: string;
  mode?: 0 | 2 | 4;
  pos: [number, number];
  size?: [number, number];
  color?: string;
  widgets: W[];
  inputs?: { name: string; type: string; from?: [number, number] }[];
  outputs?: { name: string; type: string }[];
}
interface Spec {
  nodes: SpecNode[];
  groups?: { title: string; bounding: [number, number, number, number] }[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const POSITIVE =
  'a watercolor painting of a lighthouse on a rocky coast, golden hour, soft warm light, seagulls, highly detailed, masterpiece';
const NEGATIVE = 'blurry, low quality, watermark, text, jpeg artifacts';

function base(): Spec {
  return {
    nodes: [
      {
        id: 4,
        type: 'CheckpointLoaderSimple',
        pos: [40, 200],
        widgets: [['ckpt_name', 'sd_xl_base_1.0.safetensors']],
        outputs: [
          { name: 'MODEL', type: 'MODEL' },
          { name: 'CLIP', type: 'CLIP' },
          { name: 'VAE', type: 'VAE' },
        ],
      },
      {
        id: 6,
        type: 'CLIPTextEncode',
        pos: [420, 120],
        widgets: [['text', POSITIVE]],
        inputs: [{ name: 'clip', type: 'CLIP', from: [4, 1] }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }],
      },
      {
        id: 7,
        type: 'CLIPTextEncode',
        pos: [420, 380],
        widgets: [['text', NEGATIVE]],
        inputs: [{ name: 'clip', type: 'CLIP', from: [4, 1] }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }],
      },
      {
        id: 5,
        type: 'EmptyLatentImage',
        pos: [420, 620],
        widgets: [
          ['width', 1024],
          ['height', 1024],
          ['batch_size', 1],
        ],
        outputs: [{ name: 'LATENT', type: 'LATENT' }],
      },
      {
        id: 3,
        type: 'KSampler',
        pos: [880, 200],
        widgets: [
          ['seed', 156680208700286],
          ['control_after_generate', 'randomize'],
          ['steps', 20],
          ['cfg', 7],
          ['sampler_name', 'euler'],
          ['scheduler', 'normal'],
          ['denoise', 1],
        ],
        inputs: [
          { name: 'model', type: 'MODEL', from: [4, 0] },
          { name: 'positive', type: 'CONDITIONING', from: [6, 0] },
          { name: 'negative', type: 'CONDITIONING', from: [7, 0] },
          { name: 'latent_image', type: 'LATENT', from: [5, 0] },
        ],
        outputs: [{ name: 'LATENT', type: 'LATENT' }],
      },
      {
        id: 8,
        type: 'VAEDecode',
        pos: [1240, 200],
        widgets: [],
        inputs: [
          { name: 'samples', type: 'LATENT', from: [3, 0] },
          { name: 'vae', type: 'VAE', from: [4, 2] },
        ],
        outputs: [{ name: 'IMAGE', type: 'IMAGE' }],
      },
      {
        id: 9,
        type: 'SaveImage',
        pos: [1480, 200],
        widgets: [['filename_prefix', 'ComfyUI']],
        inputs: [{ name: 'images', type: 'IMAGE', from: [8, 0] }],
      },
    ],
  };
}

const node = (s: Spec, id: number) => {
  const n = s.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
const setW = (n: SpecNode, name: string, v: unknown) => {
  const w = n.widgets.find((x) => x[0] === name);
  if (!w) throw new Error(`no widget ${name}`);
  w[1] = v;
};
const setIn = (n: SpecNode, name: string, from: [number, number] | undefined) => {
  const i = n.inputs!.find((x) => x.name === name)!;
  if (from) i.from = from;
  else delete i.from;
};

function withLora(s: Spec, mode: 0 | 4 = 0, title?: string): Spec {
  const lora: SpecNode = {
    id: 10,
    type: 'LoraLoader',
    pos: [420, 860],
    mode,
    widgets: [
      ['lora_name', 'detail_tweaker.safetensors'],
      ['strength_model', 0.6],
      ['strength_clip', 0.6],
    ],
    inputs: [
      { name: 'model', type: 'MODEL', from: [4, 0] },
      { name: 'clip', type: 'CLIP', from: [4, 1] },
    ],
    outputs: [
      { name: 'MODEL', type: 'MODEL' },
      { name: 'CLIP', type: 'CLIP' },
    ],
  };
  if (title) lora.title = title;
  s.nodes.splice(1, 0, lora);
  setIn(node(s, 3), 'model', [10, 0]);
  setIn(node(s, 6), 'clip', [10, 1]);
  setIn(node(s, 7), 'clip', [10, 1]);
  return s;
}

function toEditor(s: Spec): unknown {
  const links: unknown[][] = [];
  let linkId = 0;
  const outLinks = new Map<string, number[]>();
  const nodes = s.nodes.map((n, order) => {
    const inputs = (n.inputs ?? []).map((i) => {
      let link: number | null = null;
      if (i.from) {
        link = ++linkId;
        const src = node(s, i.from[0]);
        links.push([link, i.from[0], i.from[1], n.id, (n.inputs ?? []).indexOf(i), src.outputs![i.from[1]]!.type]);
        const k = `${i.from[0]}:${i.from[1]}`;
        outLinks.set(k, [...(outLinks.get(k) ?? []), link]);
      }
      return { name: i.name, type: i.type, link };
    });
    return { n, inputs, order };
  });
  const out = nodes.map(({ n, inputs, order }) => {
    const e: Record<string, unknown> = {
      id: n.id,
      type: n.type,
      pos: n.pos,
      size: n.size ?? [315, 100 + 26 * n.widgets.length],
      flags: {},
      order,
      mode: n.mode ?? 0,
      inputs,
      outputs: (n.outputs ?? []).map((o, slot) => ({ name: o.name, type: o.type, links: outLinks.get(`${n.id}:${slot}`) ?? [], slot_index: slot })),
      properties: { 'Node name for S&R': n.type },
      widgets_values: n.widgets.map((w) => w[1]),
    };
    if (n.title) e['title'] = n.title;
    if (n.color) e['color'] = n.color;
    return e;
  });
  return {
    last_node_id: Math.max(...s.nodes.map((n) => n.id)),
    last_link_id: linkId,
    nodes: out,
    links,
    groups: (s.groups ?? []).map((g) => ({ title: g.title, bounding: g.bounding, color: '#3f789e', font_size: 24, flags: {} })),
    config: {},
    extra: { ds: { scale: 1, offset: [0, 0] } },
    version: 0.4,
  };
}

function toApi(s: Spec): Record<string, unknown> {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));

  const resolve = (from: [number, number]): [string, number] | undefined => {
    const src = byId.get(from[0])!;
    if ((src.mode ?? 0) === 2) return undefined;
    if ((src.mode ?? 0) === 4) {
      const t = src.outputs![from[1]]!.type;
      const inp = (src.inputs ?? []).find((i) => i.type === t && i.from);
      return inp ? resolve(inp.from!) : undefined;
    }
    return [String(from[0]), from[1]];
  };
  const api: Record<string, unknown> = {};
  for (const n of s.nodes) {
    if ((n.mode ?? 0) !== 0) continue;
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of n.widgets) if (k !== 'control_after_generate') inputs[k] = v;
    for (const i of n.inputs ?? []) {
      const r = i.from ? resolve(i.from) : undefined;
      if (r) inputs[i.name] = r;
    }
    api[String(n.id)] = { inputs, class_type: n.type, _meta: { title: n.title ?? n.type } };
  }
  return api;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

type TextChunk = { kind: 'tEXt' | 'iTXt' | 'iTXt-z' | 'zTXt'; key: string; text: string };

function textChunk(t: TextChunk): Buffer {
  const k = Buffer.from(t.key + '\0', 'latin1');
  if (t.kind === 'tEXt') return chunk('tEXt', Buffer.concat([k, Buffer.from(t.text, 'latin1')]));
  if (t.kind === 'zTXt') return chunk('zTXt', Buffer.concat([k, Buffer.from([0]), deflateSync(Buffer.from(t.text, 'latin1'))]));
  const compressed = t.kind === 'iTXt-z';
  const body = compressed ? deflateSync(Buffer.from(t.text, 'utf8')) : Buffer.from(t.text, 'utf8');
  return chunk('iTXt', Buffer.concat([k, Buffer.from([compressed ? 1 : 0, 0]), Buffer.from('\0\0', 'latin1'), body]));
}

function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number], texts: TextChunk[]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...texts.map(textChunk),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function landscape(palette: { skyTop: number[]; skyBottom: number[]; sun: number[]; hills: number[]; sea: number[]; sunX: number }) {
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as [number, number, number];
  return (x: number, y: number, W = 192): [number, number, number] => {
    const u = x / W;
    const v = y / W;
    const hill = 0.62 + 0.06 * Math.sin(u * 7 + 1) + 0.03 * Math.sin(u * 17);
    if (v > 0.8) {
      const shimmer = 0.08 * Math.sin(x * 0.9 + y * 2.3);
      return mix(palette.sea, [255, 255, 255], Math.max(0, shimmer));
    }
    if (v > hill) return mix(palette.hills, [20, 20, 30], (v - hill) * 2.2);
    const dx = u - palette.sunX;
    const dy = v - 0.38;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.09) return palette.sun as [number, number, number];
    const glow = Math.max(0, 0.25 - d) * 1.6;
    return mix(mix(palette.skyTop, palette.skyBottom, v / hill), palette.sun, glow);
  };
}

function webpWithExif(tags: [number, string][]): Buffer {
  const entries = tags.map(([tag, s]) => [tag, Buffer.from(s + '\0', 'utf8')] as const);
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataOff = 8 + ifdSize;
  const head = Buffer.alloc(8 + ifdSize);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(entries.length, 8);
  const datas: Buffer[] = [];
  entries.forEach(([tag, buf], i) => {
    const e = 10 + i * 12;
    head.writeUInt16LE(tag, e);
    head.writeUInt16LE(2, e + 2);
    head.writeUInt32LE(buf.length, e + 4);
    head.writeUInt32LE(dataOff, e + 8);
    dataOff += buf.length;
    datas.push(buf);
  });
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), head, ...datas]);
  const riffChunk = (type: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'latin1');
    h.writeUInt32LE(data.length, 4);
    return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };

  const vp8l = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08, 0x88, 0x88, 0x00]);
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08;
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), riffChunk('VP8X', vp8x), riffChunk('VP8L', vp8l), riffChunk('EXIF', exif)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

const cases: Record<string, { about: string; a: Spec; b: Spec }> = {};

{
  const b = base();
  setW(node(b, 3), 'steps', 30);
  setW(node(b, 3), 'cfg', 5.5);
  setW(node(b, 3), 'sampler_name', 'dpmpp_2m');
  setW(node(b, 3), 'scheduler', 'karras');
  setW(node(b, 3), 'seed', 987654321);
  cases['param-changed'] = { about: 'KSampler steps/cfg/sampler/scheduler changed, new seed', a: base(), b };
}
cases['node-added'] = { about: 'LoraLoader inserted between checkpoint and sampler/prompts', a: base(), b: withLora(base()) };
{
  const b = base();
  setIn(node(b, 3), 'positive', [7, 0]);
  setIn(node(b, 3), 'negative', [6, 0]);
  cases['rewired'] = { about: 'positive and negative inputs of KSampler swapped', a: base(), b };
}
{
  const b = base();
  for (const n of b.nodes) n.pos = [n.pos[0] + 137, n.pos[1] - 52 + n.id * 11];
  node(b, 3).size = [400, 300];
  node(b, 9).color = '#232';
  cases['moved-only'] = { about: 'only layout: nodes moved, one resized, one recolored', a: base(), b };
}
{
  const remap: Record<number, number> = { 4: 21, 6: 25, 7: 22, 5: 27, 3: 23, 8: 26, 9: 24 };
  const b = base();
  for (const n of b.nodes) {
    n.id = remap[n.id]!;
    n.pos = [n.pos[0] + 60, n.pos[1] + 30];
    for (const i of n.inputs ?? []) if (i.from) i.from = [remap[i.from[0]]!, i.from[1]];
  }
  b.nodes.reverse();
  cases['ids-changed'] = { about: 'same graph rebuilt: all ids renumbered and nodes reordered', a: base(), b };
}
{
  const b = base();
  setW(
    node(b, 6),
    'text',
    'a watercolor painting of a lighthouse on a stormy coast, blue hour, soft cold light, seagulls, highly detailed, masterpiece, dramatic clouds',
  );
  cases['prompt-text'] = { about: 'positive prompt edited (a few words)', a: base(), b };
}
cases['node-bypassed'] = {
  about: 'LoraLoader bypassed (API format routes around it)',
  a: withLora(base()),
  b: withLora(base(), 4),
};
{
  const a = base();
  a.nodes.push({ id: 11, type: 'PreviewImage', pos: [1480, 520], widgets: [], inputs: [{ name: 'images', type: 'IMAGE', from: [8, 0] }] });
  const b = clone(a);
  node(b, 11).mode = 2;
  cases['node-muted'] = { about: 'PreviewImage muted', a, b };
}

function examplePair(): { a: Spec; b: Spec } {
  const a = base();
  a.groups = [{ title: 'Prompt', bounding: [400, 60, 400, 560] }];
  const b = withLora(base());
  b.groups = [{ title: 'Prompt', bounding: [400, 60, 400, 560] }];
  setW(node(b, 3), 'steps', 30);
  setW(node(b, 3), 'cfg', 5.5);
  setW(node(b, 3), 'seed', 425071882113577);
  setW(node(b, 6), 'text', 'a watercolor painting of a lighthouse on a rocky coast, blue hour, soft cold light, seagulls, highly detailed, masterpiece');
  setW(node(b, 5), 'width', 832);
  setW(node(b, 5), 'height', 1216);
  for (const n of b.nodes) n.pos = [n.pos[0] + 24, n.pos[1] + 18];
  return { a, b };
}

rmSync(OUT, { recursive: true, force: true });
const write = (rel: string, data: string | Buffer) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};
const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';

const index: Record<string, string> = {};
for (const [name, c] of Object.entries(cases)) {
  index[name] = c.about;
  write(`pairs/${name}/a.workflow.json`, json(toEditor(c.a)));
  write(`pairs/${name}/b.workflow.json`, json(toEditor(c.b)));
  write(`pairs/${name}/a.api.json`, json(toApi(c.a)));
  write(`pairs/${name}/b.api.json`, json(toApi(c.b)));
}
write('pairs/index.json', json(index));

const day = { skyTop: [70, 130, 200], skyBottom: [250, 210, 150], sun: [255, 236, 170], hills: [70, 100, 80], sea: [40, 90, 140], sunX: 0.68 };
const dusk = { skyTop: [30, 40, 90], skyBottom: [120, 110, 170], sun: [235, 235, 255], hills: [35, 45, 70], sea: [25, 40, 80], sunX: 0.3 };
const meta = (s: Spec, kind: TextChunk['kind'] = 'tEXt'): TextChunk[] => [
  { kind, key: 'prompt', text: JSON.stringify(toApi(s)) },
  { kind, key: 'workflow', text: JSON.stringify(toEditor(s)) },
];

const ex = examplePair();
const S = 192;
write('example/a.png', png(S, S, (x, y) => landscape(day)(x, y, S), meta(ex.a)));
write('example/b.png', png(S, S, (x, y) => landscape(dusk)(x, y, S), meta(ex.b)));

const tiny = (x: number, y: number): [number, number, number] => [x * 30, y * 30, 128];
const pa = cases['param-changed']!;
write('images/text-chunks.png', png(8, 8, tiny, meta(pa.a, 'tEXt')));
write('images/itxt.png', png(8, 8, tiny, meta(pa.a, 'iTXt')));
write('images/itxt-compressed.png', png(8, 8, tiny, meta(pa.a, 'iTXt-z')));
write('images/ztxt.png', png(8, 8, tiny, meta(pa.a, 'zTXt')));
write('images/prompt-only.png', png(8, 8, tiny, [{ kind: 'tEXt', key: 'prompt', text: JSON.stringify(toApi(pa.b)) }]));
write('images/no-metadata.png', png(8, 8, tiny, []));
write('images/a1111.png', png(8, 8, tiny, [{ kind: 'tEXt', key: 'parameters', text: 'a cat\nSteps: 20, Sampler: Euler a, CFG scale: 7' }]));
write(
  'images/exif.webp',
  webpWithExif([
    [0x0110, 'prompt:' + JSON.stringify(toApi(pa.b))],
    [0x010f, 'workflow:' + JSON.stringify(toEditor(pa.b))],
  ]),
);
write('images/not-a-workflow.json', json({ name: 'some-package', version: '1.0.0' }));

console.log(`fixtures written to ${OUT}: ${Object.keys(cases).length} pairs, example, images`);
