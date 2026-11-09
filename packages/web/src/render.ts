import {
  compactWords,
  formatValue,
  ignoredLine,
  linkSource,
  modeVerb,
  notes,
  type DiffReport,
  type LinkChange,
  type NodeParamChanges,
  type NodeRef,
  type NodeSummary,
  type ParamChange,
  type WordToken,
} from '@comfydiff/core';
import { h } from './dom';

const KNOWN_TYPES = new Set(['MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'LATENT', 'IMAGE', 'MASK', 'CONTROL_NET', 'CLIP_VISION']);
const INPUT_TYPES: Record<string, string> = {
  model: 'MODEL',
  clip: 'CLIP',
  vae: 'VAE',
  positive: 'CONDITIONING',
  negative: 'CONDITIONING',
  conditioning: 'CONDITIONING',
  latent_image: 'LATENT',
  samples: 'LATENT',
  latent: 'LATENT',
  image: 'IMAGE',
  images: 'IMAGE',
  pixels: 'IMAGE',
  mask: 'MASK',
  control_net: 'CONTROL_NET',
  clip_vision: 'CLIP_VISION',
};

function linkType(l: LinkChange): string {
  const out = (l.to ?? l.from)?.output;
  if (out && KNOWN_TYPES.has(out)) return out;
  return INPUT_TYPES[l.input] ?? 'OTHER';
}

function ids(n: NodeRef): string {
  if (n.idA !== undefined && n.idB !== undefined) return n.idA === n.idB ? `#${n.idB}` : `#${n.idA} → #${n.idB}`;
  return `#${n.idB ?? n.idA}`;
}

function title(n: NodeRef, extra?: Node | string | null): HTMLElement {
  return h('div', { class: 'mini-title' }, h('span', { class: 'title-dot' }), h('span', { class: 'mini-name', title: n.type }, n.label), h('span', { class: 'mini-id' }, ids(n)), extra ?? null);
}

function widget(label: Node | string, value: Node | string, cls = ''): HTMLElement {
  return h('div', { class: `w ${cls}` }, h('span', { class: 'w-l' }, label), h('span', { class: 'w-v' }, value));
}

function paramLabel(c: ParamChange): HTMLElement {
  return c.named ? h('span', null, c.name) : h('span', { class: 'unnamed', title: 'name unknown, position in the node' }, `param ${c.name}`);
}

function change(c: ParamChange): HTMLElement {
  const v = (x: unknown) => formatValue(x as never, 60);
  if (c.from === undefined) return widget(paramLabel(c), h('span', null, h('b', { class: 'new' }, v(c.to)), h('i', null, ' added')));
  if (c.to === undefined) return widget(paramLabel(c), h('span', null, h('s', { class: 'old' }, v(c.from)), h('i', null, ' removed')));
  return widget(paramLabel(c), h('span', null, h('s', { class: 'old' }, v(c.from)), h('span', { class: 'to' }, ' → '), h('b', { class: 'new' }, v(c.to))));
}

function words(tokens: WordToken[]): DocumentFragment {
  const f = document.createDocumentFragment();
  tokens.forEach((t, i) => {
    if (t.op === 'add' && tokens[i - 1]?.op === 'del') f.append(' ');
    f.append(t.op === 'eq' ? document.createTextNode(t.text) : h(t.op === 'add' ? 'ins' : 'del', null, t.text));
  });
  return f;
}

function textChange(c: ParamChange): HTMLElement {
  const full = c.words!;
  const compact = compactWords(full, 4);
  const shortened = compact.some((t, i) => t.text !== full[i]?.text);
  const box = h('div', { class: 'textw' }, words(compact));
  const head = h('div', { class: 'textw-head' }, paramLabel(c));
  if (shortened) {
    let open = false;
    const btn = h('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false' }, 'full text');
    btn.addEventListener('click', () => {
      open = !open;
      box.replaceChildren(words(open ? full : compact));
      btn.textContent = open ? 'changes only' : 'full text';
      btn.setAttribute('aria-expanded', String(open));
    });
    head.append(btn);
  }
  return h('div', { class: 'textw-wrap' }, head, box);
}

function paramCard(p: NodeParamChanges): HTMLElement {
  const short = p.changes.filter((c) => !c.words);
  const texts = p.changes.filter((c) => c.words);
  return h(
    'div',
    { class: `mini${texts.length ? ' wide' : ''}` },
    title(p.node),
    h('div', { class: 'mini-body' }, short.map(change), p.seedChanged ? widget('seed', 'changed', 'dim') : null, texts.map(textChange)),
  );
}

function keyWidget(k: string): HTMLElement {
  const m = /^(\S+) (.+)$/.exec(k);
  return m ? widget(m[1]!, m[2]!.replace(/^"|"$/g, '')) : widget('file', k);
}

function summaryCard(s: NodeSummary, kind: 'added' | 'removed'): HTMLElement {
  return h(
    'div',
    { class: `mini ${kind}${s.mode !== 'active' ? ' ' + s.mode : ''}` },
    title(s.node, h('span', { class: 'tag' }, s.mode === 'active' ? kind : `${kind}, ${s.mode}`)),
    s.keyParams.length ? h('div', { class: 'mini-body' }, s.keyParams.map(keyWidget)) : null,
  );
}

function modeCard(m: DiffReport['modes'][number]): HTMLElement {
  return h('div', { class: `mini ${m.to}` }, title(m.node, h('span', { class: 'tag' }, modeVerb(m))), h('div', { class: 'mini-body' }, widget('mode', `${m.from} → ${m.to}`)));
}

function linkRow(l: LinkChange): HTMLElement {
  const to = l.to ? linkSource(l.to) : 'nothing';
  const from = l.from ? linkSource(l.from) : 'nothing';
  return h(
    'li',
    { class: 'link' },
    h('span', { class: 'sock', 'data-type': linkType(l) }),
    h('span', { class: 'link-target' }, `${l.node.label}.`, h('b', null, l.input)),
    h('span', { class: 'link-from' }, h('span', { class: 'to' }, '← '), h('span', { class: 'new-src' }, to), h('span', { class: 'was' }, ` was ${from}`)),
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summary(r: DiffReport): string {
  if (!r.significant) return 'no differences that affect the output';
  const parts: string[] = [];
  if (r.params.length) parts.push(count(r.params.length, 'node changed', 'nodes changed'));
  if (r.added.length) parts.push(`${r.added.length} added`);
  if (r.removed.length) parts.push(`${r.removed.length} removed`);
  if (r.links.length) parts.push(count(r.links.length, 'link', 'links'));
  if (r.modes.length) parts.push(count(r.modes.length, 'toggled', 'toggled'));
  return parts.join(', ');
}

export function renderReport(r: DiffReport): HTMLElement {
  const cards: HTMLElement[] = [
    ...r.params.map(paramCard),
    ...r.added.map((s) => summaryCard(s, 'added')),
    ...r.removed.map((s) => summaryCard(s, 'removed')),
    ...r.modes.map(modeCard),
  ];
  const links = r.links.length
    ? h('div', { class: 'mini wide' }, h('div', { class: 'mini-title' }, h('span', { class: 'title-dot' }), h('span', { class: 'mini-name' }, 'Links')), h('ul', { class: 'links' }, r.links.map(linkRow)))
    : null;
  const ign = ignoredLine(r);
  return h(
    'div',
    { class: 'report' },
    r.significant ? null : h('p', { class: 'same' }, 'No differences that affect the output. Same nodes, settings and links.'),
    cards.length ? h('div', { class: 'cards' }, cards) : null,
    links,
    notes(r).map((t) => h('p', { class: 'fine' }, t)),
    ign ? h('p', { class: 'fine' }, `${ign[0]!.toUpperCase()}${ign.slice(1)}.`) : null,
  );
}
