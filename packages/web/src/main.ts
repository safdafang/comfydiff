import './style.css';
import { compareLoaded, formatMarkdown, isComfyDiffError, loadWorkflow, sniff, type ContainerKind, type DiffReport, type LoadedWorkflow } from '@comfydiff/core';
import exampleA from '../../../fixtures/example/a.png?inline';
import exampleB from '../../../fixtures/example/b.png?inline';
import { h, svg } from './dom';
import { renderReport, summary } from './render';

type SlotId = 'a' | 'b';

interface SlotState {
  name: string;
  kind: ContainerKind;
  thumb?: string;
  loaded?: LoadedWorkflow;
  error?: { title: string; message: string };
}

const state: Record<SlotId, SlotState | undefined> = { a: undefined, b: undefined };
let lastActive: SlotId | undefined;
let report: DiffReport | undefined;

const $ = (id: string) => document.getElementById(id)!;
const slotEls: Record<SlotId, HTMLElement> = { a: $('slot-a'), b: $('slot-b') };
const diffEl = $('diff');
const graphEl = $('graph');
const wiresEl = $('wires') as unknown as SVGSVGElement;

const ACCEPT = 'image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg,.json,application/json';
const MIME: Partial<Record<ContainerKind, string>> = { png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' };
const ERROR_TITLES: Record<string, string> = {
  'no-metadata': 'no workflow in this image',
  'not-workflow': 'not a ComfyUI workflow',
  'unsupported-format': 'unsupported file type',
  'invalid-json': 'broken JSON',
  'corrupt-file': 'cannot read this file',
};

async function loadInto(slot: SlotId, name: string, bytes: Uint8Array): Promise<void> {
  const old = state[slot];
  if (old?.thumb) URL.revokeObjectURL(old.thumb);
  const kind = sniff(bytes);
  const s: SlotState = { name, kind };
  const mime = MIME[kind];
  if (mime) s.thumb = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    s.loaded = await loadWorkflow(bytes);
  } catch (e) {
    s.error = isComfyDiffError(e)
      ? { title: ERROR_TITLES[e.code] ?? 'cannot read this file', message: e.message }
      : { title: 'cannot read this file', message: e instanceof Error ? e.message : String(e) };
  }
  state[slot] = s;
  render();
}

async function loadFiles(files: File[], target: SlotId): Promise<void> {
  const list = [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })).slice(0, 2);
  const bytes = (f: File) => f.arrayBuffer().then((b) => new Uint8Array(b));
  if (list.length === 2) {
    const [first, second] = list as [File, File];
    await Promise.all([loadInto('a', first.name, await bytes(first)), loadInto('b', second.name, await bytes(second))]);
  } else if (list.length === 1) {
    await loadInto(target, list[0]!.name, await bytes(list[0]!));
  }
}

function freeSlot(): SlotId {
  return !state.a ? 'a' : !state.b ? 'b' : (lastActive ?? 'b');
}

function clear(slot: SlotId): void {
  const s = state[slot];
  if (s?.thumb) URL.revokeObjectURL(s.thumb);
  state[slot] = undefined;
  render();
}

function describe(w: LoadedWorkflow, kind: ContainerKind): [string, string] {
  const container = kind === 'json' ? 'json' : kind;
  const fmt = w.api && w.editor ? 'workflow + prompt' : w.editor ? 'workflow' : 'api prompt';
  const n = w.api ? Object.keys(w.api).length : (w.editor?.nodes.length ?? 0);
  return [`${container}, ${fmt}`, String(n)];
}

function row(label: string, value: string | Node, cls = ''): HTMLElement {
  return h('div', { class: `w ${cls}` }, h('span', { class: 'w-l' }, label), h('span', { class: 'w-v' }, value));
}

function loadNode(slot: SlotId): HTMLElement[] {
  const s = state[slot];
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });
  input.addEventListener('change', () => {
    if (input.files?.length) void loadFiles([...input.files], slot);
  });
  const pick = h('button', { type: 'button', class: 'wbtn' }, s ? 'choose another file' : 'choose file to upload');
  pick.addEventListener('click', () => input.click());

  const head = h('div', { class: 'title' }, h('span', { class: 'title-dot' }), `Load ${slot.toUpperCase()}`);
  if (s) {
    const x = h('button', { type: 'button', class: 'title-x', 'aria-label': `remove ${s.name}`, title: 'remove' }, '×');
    x.addEventListener('click', () => clear(slot));
    head.append(x);
  }

  const body = h('div', { class: 'body' });
  if (!s) {
    const drop = h('div', { class: 'preview empty', role: 'button', tabindex: 0, 'aria-label': `drop or choose a file for workflow ${slot.toUpperCase()}` }, h('span', { class: 'hint-drop' }, 'drop image or .json'), h('span', { class: 'hint-tap' }, 'tap to choose a file'));
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    body.append(row('file', h('span', { class: 'muted' }, 'none')), drop, pick, input);
  } else {
    body.append(row('file', h('span', { class: 'fname', title: s.name }, s.name)));
    body.append(s.thumb ? h('img', { class: 'preview', src: s.thumb, alt: s.name }) : h('div', { class: 'preview json' }, h('span', null, '{ }')));
    if (s.loaded) {
      const [fmt, n] = describe(s.loaded, s.kind);
      body.append(row('format', fmt, 'meta'), row('nodes', n, 'meta'));
    } else if (s.error) {
      body.append(h('div', { class: 'err', role: 'alert' }, h('b', null, s.error.title), h('p', null, s.error.message)));
    }
    body.append(pick, input);
  }
  const out = h('div', { class: 'sockets out' }, h('span', { class: 'sock-row' }, 'WORKFLOW', h('span', { class: 'sock', 'data-type': s?.loaded ? 'IMAGE' : 'NONE', id: `out-${slot}` })));
  slotEls[slot].classList.toggle('error', Boolean(s?.error));
  return [head, body, out];
}

function diffNode(): HTMLElement[] {
  const head = h('div', { class: 'title' }, h('span', { class: 'title-dot' }), 'Diff');
  if (report) head.append(h('span', { class: 'title-info' }, summary(report)));
  const inputs = h(
    'div',
    { class: 'sockets in' },
    (['a', 'b'] as const).map((slot) =>
      h('span', { class: 'sock-row' }, h('span', { class: 'sock', 'data-type': state[slot]?.loaded ? 'IMAGE' : 'NONE', id: `in-${slot}` }), slot, h('span', { class: 'muted sock-name' }, state[slot]?.name ?? '')),
    ),
  );
  const body = h('div', { class: 'body' });
  if (report) {
    body.append(renderReport(report));
    const copy = h('button', { type: 'button', class: 'wbtn' }, 'copy as markdown');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(formatMarkdown(report!, { a: state.a?.name ?? 'A', b: state.b?.name ?? 'B' }));
        copy.textContent = 'copied';
      } catch {
        copy.textContent = 'copy failed';
      }
      setTimeout(() => (copy.textContent = 'copy as markdown'), 1500);
    });
    body.append(copy);
  } else {
    const example = h('button', { type: 'button', class: 'wbtn' }, 'load example');
    example.addEventListener('click', () => void loadExample());
    body.append(h('p', { class: 'waiting' }, state.a?.loaded || state.b?.loaded ? 'Waiting for the second workflow.' : 'Drop two workflows into the Load nodes, or try the example.'), example);
  }
  return [head, inputs, body];
}

function render(): void {
  for (const slot of ['a', 'b'] as const) slotEls[slot].replaceChildren(...loadNode(slot));
  const a = state.a?.loaded;
  const b = state.b?.loaded;
  report = undefined;
  if (a && b) {
    try {
      report = compareLoaded(a, b);
    } catch (e) {
      console.error(e);
    }
  }
  diffEl.replaceChildren(...diffNode());
  drawWires();
}

const stacked = window.matchMedia('(max-width: 899px)');

function drawWires(): void {
  wiresEl.replaceChildren();
  if (stacked.matches) return;
  const g = graphEl.getBoundingClientRect();
  wiresEl.setAttribute('width', String(g.width));
  wiresEl.setAttribute('height', String(g.height));
  for (const slot of ['a', 'b'] as const) {
    if (!state[slot]?.loaded) continue;
    const from = document.getElementById(`out-${slot}`)?.getBoundingClientRect();
    const to = document.getElementById(`in-${slot}`)?.getBoundingClientRect();
    if (!from || !to) continue;
    const x1 = from.left + from.width / 2 - g.left;
    const y1 = from.top + from.height / 2 - g.top;
    const x2 = to.left + to.width / 2 - g.left;
    const y2 = to.top + to.height / 2 - g.top;
    const dx = Math.max(40, (x2 - x1) / 2);
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    wiresEl.append(svg('path', { d, class: 'wire-under' }), svg('path', { d, class: 'wire' }));
  }
}

new ResizeObserver(drawWires).observe(graphEl);
stacked.addEventListener('change', drawWires);

function isFileDrag(e: DragEvent): boolean {
  return Boolean(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
}

for (const slot of ['a', 'b'] as const) {
  const el = slotEls[slot];
  el.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove('over');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('over');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void loadFiles(files, slot);
  });
  el.addEventListener('pointerenter', () => (lastActive = slot));
  el.addEventListener('focusin', () => (lastActive = slot));
}

window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void loadFiles(files, freeSlot());
});

document.addEventListener('paste', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) {
    e.preventDefault();
    void loadFiles(files, freeSlot());
    return;
  }
  const text = e.clipboardData?.getData('text/plain')?.trim();
  if (text?.startsWith('{')) {
    e.preventDefault();
    void loadInto(freeSlot(), 'pasted.json', new TextEncoder().encode(text));
  }
});

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadExample(): Promise<void> {
  await Promise.all([loadInto('a', 'lighthouse-day.png', dataUrlBytes(exampleA)), loadInto('b', 'lighthouse-dusk.png', dataUrlBytes(exampleB))]);
}

type Theme = 'auto' | 'light' | 'dark';
const themeBtn = $('theme');

function savedTheme(): Theme {
  try {
    const v = localStorage.getItem('comfydiff-theme');
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function applyTheme(t: Theme): void {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = `theme: ${t}`;
}

let theme = savedTheme();

themeBtn.addEventListener('click', () => {
  const order: Theme[] = ['auto', 'dark', 'light'];
  theme = order[(order.indexOf(theme) + 1) % order.length]!;
  try {
    localStorage.setItem('comfydiff-theme', theme);
  } catch {
    void 0;
  }
  applyTheme(theme);
});

applyTheme(theme);
render();
if (location.hash === '#example') void loadExample();
window.addEventListener('hashchange', () => {
  if (location.hash === '#example') void loadExample();
});
