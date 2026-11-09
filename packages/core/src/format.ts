import type { DiffReport, LinkChange, ModeChange, NodeMode, NodeParamChanges, NodeSummary, ParamChange, WordToken } from './types';
import { formatValue } from './values';
import { compactWords } from './worddiff';


export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  add(s: string): string;
  del(s: string): string;
  warn(s: string): string;
  
  insWord(s: string): string;
  delWord(s: string): string;
  
  replaceSep?: string;
}

export const plainStyle: Style = {
  bold: (s) => s,
  dim: (s) => s,
  add: (s) => s,
  del: (s) => s,
  warn: (s) => s,
  insWord: (s) => `{+${s}+}`,
  delWord: (s) => `[-${s}-]`,
};

const MODE_WORD: Record<NodeMode, string> = { active: 'active', muted: 'muted', bypassed: 'bypassed' };

export function linkSource(s: LinkChange['from']): string {
  if (!s) return 'nothing';
  return s.output ? `${s.node.label}.${s.output}` : s.node.label;
}

export function modeVerb(m: ModeChange): string {
  if (m.to === 'active') return m.from === 'bypassed' ? 'un-bypassed' : 'enabled';
  return m.to === 'bypassed' ? 'bypassed' : 'muted';
}

export function ignoredLine(r: DiffReport): string | undefined {
  const c = r.cosmetic;
  if (!c.total) return undefined;
  const parts: string[] = [];
  const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;
  if (c.moved) parts.push(`${n(c.moved, 'node')} moved`);
  if (c.resized) parts.push(`${n(c.resized, 'node')} resized`);
  if (c.recolored) parts.push(`${n(c.recolored, 'node')} recolored`);
  if (c.collapsed) parts.push(`${n(c.collapsed, 'node')} collapsed/expanded`);
  if (c.retitled) parts.push(`${n(c.retitled, 'title')} renamed`);
  if (c.notesChanged) parts.push(`${n(c.notesChanged, 'note')} edited`);
  if (c.groupsChanged) parts.push(`${n(c.groupsChanged, 'group')} changed`);
  return `ignored layout changes: ${parts.join(', ')}`;
}

export const NO_DIFF = 'No differences that affect the output.';

function paramName(c: ParamChange): string {
  return c.named ? c.name : `param ${c.name}`;
}


export const TEXT_DIFF_BUDGET = 480;

function wordsInline(tokens: WordToken[], st: Style, esc: (s: string) => string = (s) => s, budget = TEXT_DIFF_BUDGET): string {
  const parts: string[] = [];
  const compact = compactWords(tokens);
  let used = 0;
  for (let k = 0; k < compact.length; k++) {
    const t = compact[k]!;
    const raw = t.text.replace(/\s*\n\s*/g, ' ⏎ ');
    if (used + raw.length > budget && t.op !== 'eq' && used < budget - 40) {

      const cut = raw.slice(0, Math.max(80, budget - used)).replace(/\s+\S*$/, '') + '…';
      parts.push(t.op === 'add' ? st.insWord(esc(cut)) : st.delWord(esc(cut)));
      used = budget;
      continue;
    }
    if (used + raw.length > budget && used > 0) {
      const left = compact.slice(k).filter((x) => x.op !== 'eq').length;
      if (left) parts.push(st.dim(` … ${left} more change${left === 1 ? '' : 's'}`));
      else parts.push('…');
      break;
    }
    used += raw.length;
    if (t.op === 'add' && compact[k - 1]?.op === 'del' && st.replaceSep) parts.push(st.replaceSep);
    const text = esc(raw);
    parts.push(t.op === 'eq' ? text : t.op === 'add' ? st.insWord(text) : st.delWord(text));
  }
  return parts.join('');
}


export function formatChange(c: ParamChange, st: Style, esc: (s: string) => string = (s) => s, quote: (s: string) => string = (s) => s): string {
  const name = paramName(c);

  const sep = c.named ? ' ' : ': ';
  if (c.words) return `${name}: ${wordsInline(c.words, st, esc)}`;
  if (c.from === undefined) return `${name}${sep}${st.add('added')} (${quote(esc(formatValue(c.to)))})`;
  if (c.to === undefined) return `${name}${sep}${st.del('removed')} (was ${quote(esc(formatValue(c.from)))})`;
  return `${name}${sep}${quote(esc(formatValue(c.from)))} → ${quote(esc(formatValue(c.to)))}`;
}

function shortChanges(p: NodeParamChanges): ParamChange[] {
  return p.changes.filter((c) => !c.words);
}

function summaryText(s: NodeSummary, esc: (s: string) => string = (x) => x): string {
  const params = s.keyParams.length ? ` (${s.keyParams.map(esc).join(', ')})` : '';
  const mode = s.mode !== 'active' ? `, ${MODE_WORD[s.mode]}` : '';
  return `${esc(s.node.label)}${params}${mode}`;
}


export function formatText(r: DiffReport, st: Style = plainStyle): string {
  const lines: string[] = [];
  const labels = [
    ...r.params.map((p) => p.node.label),
    'removed',
    ...r.modes.map(modeVerb),
  ];
  const width = Math.min(34, Math.max(...labels.map((l) => l.length)) + 2);

  const pad = (s: string) => (s.length + 1 >= width ? s + ': ' : s + ':' + ' '.repeat(width - s.length - 1));

  for (const p of r.params) {
    const short = shortChanges(p).map((c) => formatChange(c, st));
    if (p.seedChanged) short.push(st.dim('seed changed'));
    const texts = p.changes.filter((c) => c.words);
    if (short.length) lines.push(`  ${st.bold(pad(p.node.label))}${short.join(', ')}`);
    else lines.push(`  ${st.bold(p.node.label + ':')}`);
    for (const t of texts) lines.push(`    ${formatChange(t, st)}`);
  }
  for (const s of r.added) lines.push(`${st.add('+')} ${pad('added')}${st.add(summaryText(s))}`);
  for (const s of r.removed) lines.push(`${st.del('-')} ${pad('removed')}${st.del(summaryText(s))}`);
  for (const l of r.links) lines.push(`${st.warn('~')} ${pad('rewired')}${linkLine(l)}`);
  for (const m of r.modes) lines.push(`${st.warn('!')} ${pad(modeVerb(m))}${m.node.label} ${st.dim(`(was ${MODE_WORD[m.from]})`)}`);

  if (!r.significant) lines.push(NO_DIFF);
  for (const note of notes(r)) lines.push(st.dim(note));
  const ign = ignoredLine(r);
  if (ign) lines.push(st.dim(`(${ign})`));
  return lines.join('\n');
}

export function linkLine(l: LinkChange, esc: (s: string) => string = (s) => s): string {
  const target = `${esc(l.node.label)}.${esc(l.input)}`;
  if (!l.to) return `${target} disconnected (was ${esc(linkSource(l.from))})`;
  if (!l.from) return `${target} now connected to ${esc(linkSource(l.to))}`;
  return `${target} now from ${esc(linkSource(l.to))}, not ${esc(linkSource(l.from))}`;
}

export function notes(r: DiffReport): string[] {
  const out: string[] = [];
  if (r.unnamedTypes.length) {
    out.push(
      `Parameter names unknown for ${r.unnamedTypes.join(', ')} (editor-format file without API data), shown by position.`,
    );
  }
  out.push(...r.warnings);
  return out;
}



const mdEsc = (s: string) => s.replace(/([\\`*_~|<>[\]#])/g, '\\$1');


function mdWrap(s: string, mark: string): string {
  const m = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u.exec(s)!;
  if (!m[2]) return `${mark}${s.trim()}${mark}`;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

const mdStyle: Style = {
  bold: (s) => `**${s}**`,
  dim: (s) => `*${s}*`,
  add: (s) => s,
  del: (s) => s,
  warn: (s) => s,
  insWord: (s) => mdWrap(s, '**'),
  delWord: (s) => mdWrap(s, '~~'),
  replaceSep: ' ',
};


export function formatMarkdown(r: DiffReport, title?: { a: string; b: string }): string {
  const lines: string[] = [];
  if (title) lines.push(`**ComfyUI workflow diff:** \`${title.a.replace(/`/g, "'")}\` → \`${title.b.replace(/`/g, "'")}\``, '');
  const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
  for (const p of r.params) {
    const short = shortChanges(p).map((c) => formatChange(c, mdStyle, (s) => s, code));
    if (p.seedChanged) short.push('*seed changed*');
    lines.push(`- **${mdEsc(p.node.label)}**${short.length ? ': ' + short.join(', ') : ''}`);
    for (const t of p.changes.filter((c) => c.words)) lines.push(`  - ${formatChange(t, mdStyle, mdEsc)}`);
  }
  for (const s of r.added) lines.push(`- **Added** ${summaryText(s, mdEsc)}`);
  for (const s of r.removed) lines.push(`- **Removed** ${summaryText(s, mdEsc)}`);
  for (const l of r.links) lines.push(`- **Rewired** ${linkLine(l, mdEsc)}`);
  for (const m of r.modes) lines.push(`- **${modeVerb(m)[0]!.toUpperCase() + modeVerb(m).slice(1)}** ${mdEsc(m.node.label)} (was ${MODE_WORD[m.from]})`);
  if (!r.significant) lines.push(`**${NO_DIFF}**`);
  const extra = [...notes(r), ignoredLine(r)].filter(Boolean) as string[];
  if (extra.length) lines.push('', ...extra.map((e) => `*${mdEsc(e)}*`));

  lines.push('', '*diffed with comfydiff*');
  return lines.join('\n');
}
