import { matchNodes } from './match';
import type {
  CosmeticSummary,
  DiffReport,
  LinkChange,
  ModeChange,
  NodeParamChanges,
  NodeRef,
  NodeSummary,
  NormGraph,
  NormNode,
  ParamChange,
  Value,
} from './types';
import { formatValue, isLongText, isSeedName, valuesEqual } from './values';
import { wordDiff } from './worddiff';


const OUTPUT_NAMES: Record<string, string[]> = {
  CheckpointLoaderSimple: ['MODEL', 'CLIP', 'VAE'],
  CheckpointLoader: ['MODEL', 'CLIP', 'VAE'],
  unCLIPCheckpointLoader: ['MODEL', 'CLIP', 'VAE', 'CLIP_VISION'],
  ImageOnlyCheckpointLoader: ['MODEL', 'CLIP_VISION', 'VAE'],
  LoraLoader: ['MODEL', 'CLIP'],
};

const MODEL_FILE = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx|pkl)$/i;


export function topoOrder(g: NormGraph): string[] {
  const ids = [...g.nodes.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const n of g.nodes.values()) {
    for (const ref of Object.values(n.inputs)) {
      if (!g.nodes.has(ref.from) || ref.from === n.id) continue;
      indeg.set(n.id, indeg.get(n.id)! + 1);
      if (!out.has(ref.from)) out.set(ref.from, []);
      out.get(ref.from)!.push(n.id);
    }
  }
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const res: string[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    ready.sort((x, y) => index.get(x)! - index.get(y)!);
    const id = ready.shift()!;
    res.push(id);
    seen.add(id);
    for (const t of out.get(id) ?? []) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) ready.push(t);
    }
  }
  for (const id of ids) if (!seen.has(id)) res.push(id);
  return res;
}


function role(g: NormGraph, id: string): string | undefined {
  const roles = new Set<string>();
  for (const n of g.nodes.values()) {
    for (const [input, ref] of Object.entries(n.inputs)) {
      if (ref.from === id && /^(positive|negative)$/.test(input)) roles.add(input);
    }
  }
  return roles.size === 1 ? [...roles][0] : undefined;
}

function hint(g: NormGraph, n: NormNode, stableRole: boolean): string | undefined {
  if (stableRole) {
    const r = role(g, n.id);
    if (r) return r;
  }
  for (const v of Object.values(n.params)) {
    if (typeof v === 'string' && MODEL_FILE.test(v)) return v.replace(/^.*[\\/]/, '').replace(MODEL_FILE, '');
  }
  for (const v of Object.values(n.params)) {
    if (typeof v === 'string' && v.trim().length > 12) {
      const words = v.trim().split(/\s+/).slice(0, 4).join(' ');
      return `"${words.length > 28 ? words.slice(0, 27) : words}…"`;
    }
  }
  return undefined;
}

class Labeler {
  private labels = new Map<string, string>();
  constructor(
    private a: NormGraph,
    private b: NormGraph,
    private aToB: Map<string, string>,
  ) {

    const count = new Map<string, number>();
    for (const n of b.nodes.values()) count.set(n.type, (count.get(n.type) ?? 0) + 1);
    for (const n of a.nodes.values()) if (!aToB.has(n.id)) count.set(n.type, (count.get(n.type) ?? 0) + 1);
    const used = new Map<string, number>();
    const bToA = new Map([...aToB].map(([x, y]) => [y, x]));
    const make = (side: 'a' | 'b', g: NormGraph, n: NormNode) => {
      let label = n.title ?? n.type;
      if (!n.title && (count.get(n.type) ?? 0) > 1) {

        const partner = side === 'b' ? bToA.get(n.id) : undefined;
        const stable = side === 'a' || partner === undefined || role(a, partner) === role(b, n.id);
        const h = hint(g, n, stable);
        label = h ? `${n.type} (${h})` : `${n.type} #${n.id}`;
      }
      used.set(label, (used.get(label) ?? 0) + 1);
      this.labels.set(`${side}:${n.id}`, label);
    };
    for (const n of b.nodes.values()) make('b', b, n);
    for (const n of a.nodes.values()) if (!aToB.has(n.id)) make('a', a, n);

    for (const [k, label] of this.labels) {
      if ((used.get(label) ?? 0) > 1 && !label.endsWith(`#${k.slice(2)}`)) this.labels.set(k, `${label} #${k.slice(2)}`);
    }
  }
  refA(idA: string): NodeRef {
    const idB = this.aToB.get(idA);
    if (idB !== undefined) return this.refB(idB, idA);
    const n = this.a.nodes.get(idA)!;
    return { idA, type: n.type, label: this.labels.get(`a:${idA}`) ?? n.type };
  }
  refB(idB: string, idA?: string): NodeRef {
    const n = this.b.nodes.get(idB)!;
    const r: NodeRef = { idB, type: n.type, label: this.labels.get(`b:${idB}`) ?? n.type };
    if (idA !== undefined) r.idA = idA;
    return r;
  }
}

function outputName(n: NormNode | undefined, slot: number): string {
  if (!n) return '';
  const names = n.outputNames ?? OUTPUT_NAMES[n.type];

  if (names && names.length > 1 && names[slot]) return names[slot]!;
  return slot === 0 ? '' : `output ${slot + 1}`;
}


function alignParams(x: NormNode, y: NormNode): [Record<string, Value>, Record<string, Value>] {
  if (x.namedParams === y.namedParams) return [x.params, y.params];
  const named = x.namedParams ? x : y;
  const pos = x.namedParams ? y : x;
  const nk = Object.keys(named.params);
  const pk = Object.keys(pos.params);
  if (nk.length !== pk.length) return [x.params, y.params];
  for (let i = 0; i < nk.length; i++) if (typeof named.params[nk[i]!] !== typeof pos.params[pk[i]!]) return [x.params, y.params];
  const mapped: Record<string, Value> = {};
  pk.forEach((k, i) => (mapped[nk[i]!] = pos.params[k]!));
  return x.namedParams ? [x.params, mapped] : [mapped, y.params];
}

function paramChanges(x: NormNode, y: NormNode): { changes: ParamChange[]; seed: boolean; positional: boolean } {
  const [pa, pb] = alignParams(x, y);
  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])];
  const changes: ParamChange[] = [];
  let seed = false;
  let positional = false;
  for (const k of keys) {
    const va = pa[k];
    const vb = pb[k];
    if (valuesEqual(va, vb)) continue;
    const named = !k.startsWith('#');
    if (!named) positional = true;
    if (named && isSeedName(k) && (typeof va === 'number' || typeof vb === 'number')) {
      seed = true;
      continue;
    }
    const c: ParamChange = { name: k, named };
    if (va !== undefined) c.from = va;
    if (vb !== undefined) c.to = vb;
    if (isLongText(va) || isLongText(vb)) c.words = wordDiff(typeof va === 'string' ? va : '', typeof vb === 'string' ? vb : '');
    changes.push(c);
  }
  return { changes, seed, positional };
}


export function keyParams(n: NormNode, max = 4): string[] {
  const entries = Object.entries(n.params).filter(([k, v]) => !isSeedName(k) && v !== null && v !== '');
  const files = entries.filter(([, v]) => typeof v === 'string' && MODEL_FILE.test(v));
  const rest = entries.filter(([, v]) => !(typeof v === 'string' && MODEL_FILE.test(v)));
  const out: string[] = files.map(([, v]) => String(v).replace(/^.*[\\/]/, ''));
  for (const [k, v] of rest) {
    if (out.length >= max) break;
    if (typeof v === 'object') continue;
    if (typeof v === 'string' && v.length > 40) out.push(`${k} "${formatValue(v, 40)}"`);
    else out.push(`${k} ${formatValue(v, 40)}`);
  }
  return out.slice(0, max);
}

function cosmetic(a: NormGraph, b: NormGraph, aToB: Map<string, string>): CosmeticSummary {
  const c: CosmeticSummary = { moved: 0, resized: 0, recolored: 0, retitled: 0, collapsed: 0, notesChanged: 0, groupsChanged: 0, total: 0 };
  const near = (p?: [number, number], q?: [number, number]) => !p || !q || (Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5);
  for (const [ia, ib] of aToB) {
    const x = a.nodes.get(ia)!;
    const y = b.nodes.get(ib)!;
    const lx = x.layout;
    const ly = y.layout;
    if (lx && ly) {
      if (!near(lx.pos, ly.pos)) c.moved++;
      if (!near(lx.size, ly.size)) c.resized++;
      if ((lx.color ?? '') !== (ly.color ?? '') || (lx.bgcolor ?? '') !== (ly.bgcolor ?? '')) c.recolored++;
      if (Boolean(lx.collapsed) !== Boolean(ly.collapsed)) c.collapsed++;
    }
    if (a.format !== 'api' && b.format !== 'api' && (x.title ?? '') !== (y.title ?? '')) c.retitled++;
  }
  if (a.format !== 'api' && b.format !== 'api') {
    c.notesChanged = multisetDelta([...a.notes.values()], [...b.notes.values()]);
    c.groupsChanged = multisetDelta(a.groups, b.groups);
  }
  c.total = c.moved + c.resized + c.recolored + c.retitled + c.collapsed + c.notesChanged + c.groupsChanged;
  return c;
}

function multisetDelta(xs: string[], ys: string[]): number {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let onlyB = 0;
  for (const y of ys) {
    const k = m.get(y) ?? 0;
    if (k > 0) m.set(y, k - 1);
    else onlyB++;
  }
  let onlyA = 0;
  for (const v of m.values()) onlyA += v;
  return Math.max(onlyA, onlyB);
}

const API_HIDES_DISABLED = (side: string, what: string) =>
  `${side} is in API format, which leaves out bypassed and muted nodes, so a node shown as ${what} may only be disabled.`;

export function diffGraphs(a: NormGraph, b: NormGraph): DiffReport {
  const { aToB, bToA, matchedById } = matchNodes(a, b);
  const L = new Labeler(a, b, aToB);
  const orderB = topoOrder(b);
  const orderA = topoOrder(a);

  const params: NodeParamChanges[] = [];
  const modes: ModeChange[] = [];
  const links: LinkChange[] = [];
  const unnamed = new Set<string>();

  for (const idB of orderB) {
    const idA = bToA.get(idB);
    if (idA === undefined) continue;
    const x = a.nodes.get(idA)!;
    const y = b.nodes.get(idB)!;
    const ref = L.refB(idB, idA);

    const pc = paramChanges(x, y);
    if (pc.positional) unnamed.add(y.type);
    if (pc.changes.length || pc.seed) {
      const entry: NodeParamChanges = { node: ref, changes: pc.changes };
      if (pc.seed) entry.seedChanged = true;
      params.push(entry);
    }

    if (x.mode !== y.mode) modes.push({ node: ref, from: x.mode, to: y.mode });

    const inputs = [...new Set([...Object.keys(x.inputs), ...Object.keys(y.inputs)])];
    for (const input of inputs) {
      const ra = x.inputs[input];
      const rb = y.inputs[input];
      if (ra && rb && aToB.get(ra.from) === rb.from && ra.slot === rb.slot) continue;
      const lc: LinkChange = { node: ref, input };
      if (ra) lc.from = { node: L.refA(ra.from), output: outputName(a.nodes.get(ra.from), ra.slot) };
      if (rb) lc.to = { node: L.refB(rb.from, bToA.get(rb.from)), output: outputName(b.nodes.get(rb.from), rb.slot) };
      links.push(lc);
    }
  }

  const summary = (n: NormNode, ref: NodeRef): NodeSummary => ({ node: ref, keyParams: keyParams(n), mode: n.mode });
  const added = orderB.filter((id) => !bToA.has(id)).map((id) => summary(b.nodes.get(id)!, L.refB(id)));
  const removed = orderA.filter((id) => !aToB.has(id)).map((id) => summary(a.nodes.get(id)!, L.refA(id)));
  for (const s of [...added, ...removed]) {
    const g = s.node.idB !== undefined ? b : a;
    const n = g.nodes.get(s.node.idB ?? s.node.idA!)!;
    if (!n.namedParams && Object.keys(n.params).length) unnamed.add(n.type);
  }

  const cos = cosmetic(a, b, aToB);
  return {
    significant: params.length > 0 || added.length > 0 || removed.length > 0 || links.length > 0 || modes.length > 0,
    formats: { a: a.format, b: b.format },
    params,
    added,
    removed,
    links,
    modes,
    cosmetic: cos,
    unnamedTypes: [...unnamed].sort(),
    warnings: [
      ...new Set([
        ...a.warnings,
        ...b.warnings,
        ...(removed.length && b.format === 'api' ? [API_HIDES_DISABLED('B', 'removed')] : []),
        ...(added.length && a.format === 'api' ? [API_HIDES_DISABLED('A', 'added')] : []),
      ]),
    ],
    stats: { nodesA: a.nodes.size, nodesB: b.nodes.size, matched: aToB.size, matchedById },
  };
}
