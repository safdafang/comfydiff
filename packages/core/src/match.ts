import type { NormGraph, NormNode } from './types';
import { isSeedName, valuesEqual } from './values';
import { tokenize } from './worddiff';

export interface Matching {
  
  aToB: Map<string, string>;
  
  bToA: Map<string, string>;
  matchedById: number;
}


function consumers(g: NormGraph): Map<string, { id: string; input: string }[]> {
  const m = new Map<string, { id: string; input: string }[]>();
  for (const n of g.nodes.values()) {
    for (const [input, ref] of Object.entries(n.inputs)) {
      if (!m.has(ref.from)) m.set(ref.from, []);
      m.get(ref.from)!.push({ id: n.id, input });
    }
  }
  return m;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function paramSim(x: NormNode, y: NormNode): number {
  const keys = new Set([...Object.keys(x.params), ...Object.keys(y.params)].filter((k) => !isSeedName(k)));
  if (keys.size === 0) return 1;
  let s = 0;
  for (const k of keys) {
    const a = x.params[k];
    const b = y.params[k];
    if (valuesEqual(a, b)) s += 1;
    else if (typeof a === 'string' && typeof b === 'string' && (a.length > 40 || b.length > 40)) {

      s += jaccard(new Set(tokenize(a.toLowerCase())), new Set(tokenize(b.toLowerCase())));
    }
  }
  return s / keys.size;
}

type Ident = (g: 'a' | 'b', id: string) => string;

function signature(side: 'a' | 'b', n: NormNode, cons: ReturnType<typeof consumers>, ident: Ident): Set<string> {
  const s = new Set<string>();
  for (const [input, ref] of Object.entries(n.inputs)) s.add(`<${input}:${ident(side, ref.from)}:${ref.slot}`);
  for (const c of cons.get(n.id) ?? []) s.add(`>${ident(side, c.id)}.${c.input}`);
  return s;
}


export function matchNodes(a: NormGraph, b: NormGraph): Matching {
  const consA = consumers(a);
  const consB = consumers(b);
  const byTypeIdent: Ident = (side, id) => (side === 'a' ? a : b).nodes.get(id)?.type ?? '?';
  let result = greedy(a, b, consA, consB, byTypeIdent);
  const r1 = result;
  const byPartnerIdent: Ident = (side, id) => {
    if (side === 'a') {
      const p = r1.aToB.get(id);
      return p !== undefined ? `m${p}` : byTypeIdent(side, id);
    }
    return r1.bToA.has(id) ? `m${id}` : byTypeIdent(side, id);
  };
  result = greedy(a, b, consA, consB, byPartnerIdent);
  return result;
}

function greedy(a: NormGraph, b: NormGraph, consA: ReturnType<typeof consumers>, consB: ReturnType<typeof consumers>, ident: Ident): Matching {
  const typeCountA = new Map<string, number>();
  const typeCountB = new Map<string, number>();
  for (const n of a.nodes.values()) typeCountA.set(n.type, (typeCountA.get(n.type) ?? 0) + 1);
  for (const n of b.nodes.values()) typeCountB.set(n.type, (typeCountB.get(n.type) ?? 0) + 1);

  const bByType = new Map<string, NormNode[]>();
  for (const n of b.nodes.values()) {
    if (!bByType.has(n.type)) bByType.set(n.type, []);
    bByType.get(n.type)!.push(n);
  }
  const sigA = new Map<string, Set<string>>();
  const sigB = new Map<string, Set<string>>();
  for (const n of a.nodes.values()) sigA.set(n.id, signature('a', n, consA, ident));
  for (const n of b.nodes.values()) sigB.set(n.id, signature('b', n, consB, ident));

  const pairs: { x: string; y: string; score: number; sameId: boolean }[] = [];
  const orderA = new Map([...a.nodes.keys()].map((k, i) => [k, i]));
  const orderB = new Map([...b.nodes.keys()].map((k, i) => [k, i]));
  for (const x of a.nodes.values()) {
    for (const y of bByType.get(x.type) ?? []) {
      const sim = 0.5 * paramSim(x, y) + 0.5 * jaccard(sigA.get(x.id)!, sigB.get(y.id)!);
      const sameId = x.id === y.id;
      const unique = typeCountA.get(x.type) === 1 && typeCountB.get(x.type) === 1;
      if (!sameId && !unique && sim < 0.35) continue;
      pairs.push({ x: x.id, y: y.id, score: sim + (sameId ? 0.5 : 0), sameId });
    }
  }
  pairs.sort(
    (p, q) =>
      q.score - p.score ||
      Number(q.sameId) - Number(p.sameId) ||
      orderA.get(p.x)! - orderA.get(q.x)! ||
      orderB.get(p.y)! - orderB.get(q.y)!,
  );
  const aToB = new Map<string, string>();
  const bToA = new Map<string, string>();
  let matchedById = 0;
  for (const p of pairs) {
    if (aToB.has(p.x) || bToA.has(p.y)) continue;
    aToB.set(p.x, p.y);
    bToA.set(p.y, p.x);
    if (p.sameId) matchedById++;
  }
  return { aToB, bToA, matchedById };
}
