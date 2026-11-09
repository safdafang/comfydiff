import type { NormGraph, NormNode, Value } from './types';
import { formatNumber } from './values';


export function canonicalText(g: NormGraph): string {
  const out: string[] = [];
  out.push(`# ComfyUI workflow, comfydiff textconv (source: ${g.format}). Layout omitted.`);
  const order = stableOrder(g);
  for (const id of order) {
    const n = g.nodes.get(id)!;
    out.push('');
    let head = `[${id}] ${n.type}`;
    if (n.title) head += `  "${n.title}"`;
    if (n.mode !== 'active') head += `  (${n.mode})`;
    out.push(head);
    for (const [k, v] of Object.entries(n.params)) out.push(...valueLines(k, v));
    for (const [k, ref] of Object.entries(n.inputs).sort(([x], [y]) => x.localeCompare(y))) {
      const src = g.nodes.get(ref.from);
      const outName = src?.outputNames?.[ref.slot] ?? (ref.slot ? `#${ref.slot}` : '');
      out.push(`    ${k} <- [${ref.from}] ${src?.type ?? '?'}${outName ? '.' + outName : ''}`);
    }
  }
  if (g.groups.length) {
    out.push('', '# groups');
    for (const t of [...g.groups].sort()) out.push(`    "${t}"`);
  }
  if (g.notes.size) {
    out.push('', '# notes');
    for (const [id, t] of [...g.notes].sort(([x], [y]) => compareIds(x, y))) out.push(...valueLines(`note [${id}]`, t));
  }
  return out.join('\n') + '\n';
}

function valueLines(k: string, v: Value): string[] {
  if (typeof v === 'string' && (v.length > 80 || v.includes('\n'))) {
    const lines = ['    ' + k + ' = """'];
    for (const raw of v.split(/\r?\n/)) {
      for (const piece of splitLong(raw)) lines.push('      ' + piece);
    }
    lines.push('    """');
    return lines;
  }
  return [`    ${k} = ${scalar(v)}`];
}

function splitLong(line: string): string[] {
  if (line.length <= 80) return [line];

  const parts = line.split(/(?<=,)\s*/);
  return parts.length > 1 ? parts : [line];
}

function scalar(v: Value): string {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v);
}

function compareIds(x: string, y: string): number {
  const nx = Number(x);
  const ny = Number(y);
  if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
  return x.localeCompare(y, 'en', { numeric: true });
}


function stableOrder(g: NormGraph): string[] {
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let d = 0;
    for (const ref of Object.values(g.nodes.get(id)!.inputs)) {
      if (g.nodes.has(ref.from) && ref.from !== id) d = Math.max(d, depthOf(ref.from) + 1);
    }
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const ids = [...g.nodes.keys()];
  for (const id of ids) depthOf(id);
  return ids.sort((x, y) => {
    const a: NormNode = g.nodes.get(x)!;
    const b: NormNode = g.nodes.get(y)!;
    return depth.get(x)! - depth.get(y)! || a.type.localeCompare(b.type) || compareIds(x, y);
  });
}
