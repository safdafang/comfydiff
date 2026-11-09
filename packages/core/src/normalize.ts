import type { ApiPrompt, EditorNode, EditorSubgraph, EditorWorkflow, LoadedWorkflow } from './load';
import type { LinkRef, NodeLayout, NodeMode, NormGraph, NormNode, Value } from './types';
import { isPlainObject, toValue } from './values';
import { CONTROL, NameRegistry, isControlValue, unwrapApiValue } from './widgets';


const NOTE_TYPES = new Set(['Note', 'MarkdownNote', 'Note Plus (mtb)', 'Label (rgthree)']);
const REROUTE_TYPES = new Set(['Reroute', 'Reroute (rgthree)']);
const VIRTUAL_TYPES = new Set([
  ...NOTE_TYPES,
  ...REROUTE_TYPES,
  'PrimitiveNode',
  'SetNode',
  'GetNode',
  'Fast Groups Bypasser (rgthree)',
  'Fast Groups Muter (rgthree)',
  'Fast Bypasser (rgthree)',
  'Fast Muter (rgthree)',
  'Bookmark (rgthree)',
]);

export function modeFromNumber(m: unknown): NodeMode {
  return m === 2 ? 'muted' : m === 4 ? 'bypassed' : 'active';
}



function isApiLinkIn(v: unknown, api: ApiPrompt): v is [string | number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[1] === 'number' && (typeof v[0] === 'string' || typeof v[0] === 'number') && String(v[0]) in api;
}

export function normalizeApi(api: ApiPrompt): NormGraph {
  const nodes = new Map<string, NormNode>();
  for (const [id, n] of Object.entries(api)) {
    const params: Record<string, Value> = {};
    const inputs: Record<string, LinkRef> = {};
    for (const [k, raw] of Object.entries(n.inputs ?? {})) {
      if (isApiLinkIn(raw, api)) inputs[k] = { from: String(raw[0]), slot: raw[1] };
      else params[k] = toValue(unwrapApiValue(raw));
    }
    nodes.set(id, { id, type: n.class_type, mode: 'active', params, namedParams: true, inputs });
  }
  return { format: 'api', nodes, groups: [], notes: new Map(), warnings: [] };
}



interface LinkObj {
  id: number;
  origin: string;
  originSlot: number;
  target: string;
  targetSlot: number;
}

function parseLinks(arr: unknown[] | undefined): Map<number, LinkObj> {
  const m = new Map<number, LinkObj>();
  for (const l of arr ?? []) {
    if (Array.isArray(l) && l.length >= 5) {
      m.set(Number(l[0]), { id: Number(l[0]), origin: String(l[1]), originSlot: Number(l[2]), target: String(l[3]), targetSlot: Number(l[4]) });
    } else if (isPlainObject(l) && 'origin_id' in l) {
      m.set(Number(l['id']), {
        id: Number(l['id']),
        origin: String(l['origin_id']),
        originSlot: Number(l['origin_slot']),
        target: String(l['target_id']),
        targetSlot: Number(l['target_slot']),
      });
    }
  }
  return m;
}

interface Scope {
  prefix: string;
  nodes: Map<string, EditorNode>;
  links: Map<number, LinkObj>;
  
  parent?: { scope: Scope; instance: EditorNode };
  children: Map<string, Scope>;
}


const SUBGRAPH_INPUT = '-10';
const SUBGRAPH_OUTPUT = '-20';

export interface FlatEditorNode {
  gid: string;
  node: EditorNode;
  scope: Scope;
  mode: NodeMode;
}


export class EditorGraph {
  readonly flat: FlatEditorNode[] = [];
  readonly warnings: string[] = [];
  private defs = new Map<string, EditorSubgraph>();
  private setNodes = new Map<string, { scope: Scope; node: EditorNode }>();

  constructor(readonly wf: EditorWorkflow) {
    collectDefs(wf.definitions?.subgraphs, this.defs);
    this.build(wf.nodes, wf.links, '', undefined, 'active');
  }

  private build(nodes: EditorNode[] | undefined, links: unknown[] | undefined, prefix: string, parent: Scope['parent'], inherited: NodeMode, depth = 0): Scope {
    const scope: Scope = { prefix, nodes: new Map(), links: parseLinks(links), parent, children: new Map() };
    for (const n of nodes ?? []) scope.nodes.set(String(n.id), n);
    for (const n of nodes ?? []) {
      const own = modeFromNumber(n.mode);
      const mode = inherited !== 'active' ? inherited : own;
      const def = this.defs.get(n.type);
      if (def) {
        if (depth > 16) continue;
        const child = this.build(def.nodes, def.links, `${prefix}${n.id}:`, { scope, instance: n }, mode, depth + 1);
        collectDefs(def.definitions?.subgraphs, this.defs);
        scope.children.set(String(n.id), child);
        continue;
      }
      if (n.type === 'SetNode') {
        const name = firstWidget(n);
        if (typeof name === 'string') this.setNodes.set(name, { scope, node: n });
      }
      this.flat.push({ gid: prefix + String(n.id), node: n, scope, mode });
    }
    return scope;
  }

  isSubgraphType(type: string): boolean {
    return this.defs.has(type);
  }

  
  resolve(scope: Scope, linkId: number | null | undefined, depth = 0): LinkRef | 'primitive' | undefined {
    if (linkId === null || linkId === undefined || depth > 64) return undefined;
    const l = scope.links.get(Number(linkId));
    if (!l) return undefined;
    if (l.origin === SUBGRAPH_INPUT) {
      const p = scope.parent;
      if (!p) return undefined;
      return this.resolve(p.scope, p.instance.inputs?.[l.originSlot]?.link, depth + 1);
    }
    const node = scope.nodes.get(l.origin);
    if (!node) return undefined;
    if (this.defs.has(node.type)) {
      const child = scope.children.get(String(node.id));
      if (!child) return undefined;
      for (const inner of child.links.values()) {
        if (inner.target === SUBGRAPH_OUTPUT && inner.targetSlot === l.originSlot) return this.resolve(child, inner.id, depth + 1);
      }
      return undefined;
    }
    if (REROUTE_TYPES.has(node.type)) return this.resolve(scope, node.inputs?.[0]?.link, depth + 1);
    if (node.type === 'GetNode') {
      const name = firstWidget(node);
      const set = typeof name === 'string' ? this.setNodes.get(name) : undefined;
      return set ? this.resolve(set.scope, set.node.inputs?.[0]?.link, depth + 1) : undefined;
    }
    if (node.type === 'PrimitiveNode') return 'primitive';
    if (VIRTUAL_TYPES.has(node.type)) return undefined;
    return { from: scope.prefix + l.origin, slot: l.originSlot };
  }
}

function collectDefs(list: EditorSubgraph[] | undefined, into: Map<string, EditorSubgraph>): void {
  for (const d of list ?? []) {
    if (d && typeof d.id === 'string' && !into.has(d.id)) {
      into.set(d.id, d);
      collectDefs(d.definitions?.subgraphs, into);
    }
  }
}

function firstWidget(n: EditorNode): unknown {
  return Array.isArray(n.widgets_values) ? n.widgets_values[0] : undefined;
}

function vec2(v: unknown): [number, number] | undefined {
  if (Array.isArray(v) && v.length >= 2) return [Number(v[0]), Number(v[1])];
  if (isPlainObject(v) && '0' in v && '1' in v) return [Number(v['0']), Number(v['1'])];
  return undefined;
}

function inputKey(inp: { name: string; widget?: { name?: string } }): string {
  return inp.widget?.name || inp.name;
}

function editorToNorm(f: FlatEditorNode, g: EditorGraph, registry: NameRegistry): NormNode {
  const n = f.node;
  const inputs: Record<string, LinkRef> = {};
  for (const inp of n.inputs ?? []) {
    const r = g.resolve(f.scope, inp.link);
    if (r && r !== 'primitive') inputs[inputKey(inp)] = r;
  }
  const params: Record<string, Value> = {};
  let namedParams = true;
  const wv = n.widgets_values;
  if (isPlainObject(wv)) {
    for (const [k, v] of Object.entries(wv)) params[k] = toValue(v);
  } else if (Array.isArray(wv) && wv.length) {
    const values = wv.map(toValue);
    const widgetInputs = (n.inputs ?? []).filter((i) => i.widget?.name).map((i) => i.widget!.name!);
    const names = registry.resolve(n.type, values, widgetInputs);
    if (names) {
      names.forEach((name, i) => {
        if (name !== CONTROL) params[name] = values[i]!;
      });

      for (const k of Object.keys(inputs)) delete params[k];
    } else {
      namedParams = false;
      values.forEach((v, i) => {
        if (!isControlValue(v, values[i - 1])) params[`#${i + 1}`] = v;
      });
    }
  }
  const layout: NodeLayout = {};
  const pos = vec2(n.pos);
  const size = vec2(n.size);
  if (pos) layout.pos = pos;
  if (size) layout.size = size;
  if (n.color) layout.color = n.color;
  if (n.bgcolor) layout.bgcolor = n.bgcolor;
  if (n.flags?.collapsed) layout.collapsed = true;
  const node: NormNode = { id: f.gid, type: n.type, mode: f.mode, params, namedParams, inputs, layout };
  if (typeof n.title === 'string' && n.title.trim() && n.title !== n.type) node.title = n.title;
  const outs = (n.outputs ?? []).map((o) => o?.name ?? '');
  if (outs.length) {
    node.outputNames = outs;
    node.outputTypes = (n.outputs ?? []).map((o) => String(o?.type ?? ''));
  }
  if (n.inputs?.length) node.inputTypes = Object.fromEntries(n.inputs.map((i) => [inputKey(i), String(i.type ?? '')]));
  return node;
}

function groupOf(pos: [number, number] | undefined, groups: EditorWorkflow['groups']): string | undefined {
  if (!pos) return undefined;
  for (const gr of groups ?? []) {
    const b = gr.bounding;
    if (Array.isArray(b) && b.length === 4 && pos[0] >= b[0]! && pos[1] >= b[1]! && pos[0] <= b[0]! + b[2]! && pos[1] <= b[1]! + b[3]!) {
      return gr.title;
    }
  }
  return undefined;
}

export function normalizeEditor(wf: EditorWorkflow, registry: NameRegistry): NormGraph {
  const g = new EditorGraph(wf);
  const nodes = new Map<string, NormNode>();
  const notes = new Map<string, string>();
  for (const f of g.flat) {
    if (NOTE_TYPES.has(f.node.type)) {
      const t = firstWidget(f.node);
      notes.set(f.gid, typeof t === 'string' ? t : JSON.stringify(f.node.widgets_values ?? ''));
      continue;
    }
    if (VIRTUAL_TYPES.has(f.node.type)) continue;
    const nn = editorToNorm(f, g, registry);
    const grp = f.scope.prefix === '' ? groupOf(nn.layout?.pos, wf.groups) : undefined;
    if (grp) nn.group = grp;
    nodes.set(f.gid, nn);
  }
  const groups = (wf.groups ?? []).map((x) => String(x.title ?? '')).filter(Boolean);
  return { format: 'editor', nodes, groups, notes, warnings: g.warnings };
}




export function learnNames(loaded: LoadedWorkflow, registry: NameRegistry): void {
  if (!loaded.api || !loaded.editor) return;
  const g = new EditorGraph(loaded.editor);
  for (const f of g.flat) {
    const api = loaded.api[f.gid];
    const wv = f.node.widgets_values;
    if (api && api.class_type === f.node.type && Array.isArray(wv)) registry.learn(f.node.type, wv.map(toValue), api.inputs);
  }
}


export interface NormalizeOptions {
  
  effective?: boolean;
}

export function normalize(loaded: LoadedWorkflow, registry = new NameRegistry(), opts: NormalizeOptions = {}): NormGraph {
  if (loaded.api && !loaded.editor) return normalizeApi(loaded.api);
  if (!loaded.api && loaded.editor) {
    const g = normalizeEditor(loaded.editor, registry);
    if (opts.effective) routeAroundDisabled(g);
    return g;
  }
  if (!loaded.api || !loaded.editor) throw new Error('normalize: empty workflow');

  const api = normalizeApi(loaded.api);
  const ed = normalizeEditor(loaded.editor, registry);
  const nodes = new Map<string, NormNode>();
  for (const [id, n] of api.nodes) {
    const e = ed.nodes.get(id);
    if (e && e.type === n.type) {
      if (e.title) n.title = e.title;
      if (e.layout) n.layout = e.layout;
      if (e.group) n.group = e.group;
      if (e.outputNames) n.outputNames = e.outputNames;
    }
    nodes.set(id, n);
  }
  for (const [id, e] of ed.nodes) if (!nodes.has(id) && e.mode !== 'active') nodes.set(id, e);

  for (const [id, e] of opts.effective ? [] : ed.nodes) {
    const n = nodes.get(id);
    if (!n || !api.nodes.has(id)) continue;
    for (const [k, ref] of Object.entries(e.inputs)) {
      if (!api.nodes.has(ref.from) && nodes.has(ref.from)) n.inputs[k] = ref;
    }
  }
  return { format: 'api+editor', nodes, groups: ed.groups, notes: ed.notes, warnings: ed.warnings };
}


// Same rule the frontend's graphToPrompt uses for bypassed nodes.
export function routeAroundDisabled(g: NormGraph): void {
  const resolve = (ref: LinkRef, wantType: string | undefined, depth: number): LinkRef | undefined => {
    const src = g.nodes.get(ref.from);
    if (!src || src.mode === 'active' || depth > 64) return ref;
    if (src.mode === 'muted') return undefined;
    const type = wantType || src.outputTypes?.[ref.slot];
    const names = Object.keys(src.inputTypes ?? {});
    let pick: string | undefined;
    const atSlot = names[ref.slot];
    if (atSlot !== undefined && src.inputTypes![atSlot] === type) pick = atSlot;
    else pick = names.find((k) => src.inputTypes![k] === type);
    const next = pick !== undefined ? src.inputs[pick] : undefined;
    return next ? resolve(next, type, depth + 1) : undefined;
  };
  for (const n of g.nodes.values()) {
    for (const [k, ref] of Object.entries(n.inputs)) {
      const r = resolve(ref, n.inputTypes?.[k], 0);
      if (r) n.inputs[k] = r;
      else delete n.inputs[k];
    }
  }
}
