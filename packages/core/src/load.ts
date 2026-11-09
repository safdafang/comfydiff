import { decodeUtf8, readJpegText, readPngText, readWebpText, sniff, type ContainerKind, type TextMeta } from './container';
import { ComfyDiffError } from './errors';
import { isPlainObject } from './values';


export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ApiPrompt = Record<string, ApiNode>;


export interface EditorWorkflow {
  nodes: EditorNode[];
  links?: unknown[];
  groups?: { title?: string; bounding?: number[] }[];
  definitions?: { subgraphs?: EditorSubgraph[] };
  version?: number;
  [k: string]: unknown;
}
export interface EditorNode {
  id: number | string;
  type: string;
  title?: string;
  mode?: number;
  pos?: unknown;
  size?: unknown;
  flags?: { collapsed?: boolean };
  color?: string;
  bgcolor?: string;
  inputs?: { name: string; type?: unknown; link?: number | null; widget?: { name?: string } }[];
  outputs?: { name: string; type?: unknown; links?: number[] | null }[];
  widgets_values?: unknown;
  properties?: Record<string, unknown>;
}
export interface EditorSubgraph {
  id: string;
  name?: string;
  nodes?: EditorNode[];
  links?: unknown[];
  inputs?: unknown[];
  outputs?: unknown[];
  definitions?: { subgraphs?: EditorSubgraph[] };
}

export interface LoadedWorkflow {
  container: ContainerKind;
  api?: ApiPrompt;
  editor?: EditorWorkflow;
}

const SUPPORTED = 'PNG or WebP images saved by ComfyUI, or workflow .json files';


export async function loadWorkflow(bytes: Uint8Array): Promise<LoadedWorkflow> {
  const kind = sniff(bytes);
  if (kind === 'json') return { container: 'json', ...parseWorkflowText(decodeUtf8(bytes)) };
  if (kind === 'unknown') {
    throw new ComfyDiffError('unsupported-format', `Unsupported file type. comfydiff reads ${SUPPORTED}.`);
  }
  let meta: TextMeta;
  if (kind === 'png') meta = await readPngText(bytes);
  else if (kind === 'webp') meta = readWebpText(bytes);
  else meta = readJpegText(bytes);
  return { container: kind, ...fromImageMeta(meta, kind) };
}

function fromImageMeta(meta: TextMeta, kind: ContainerKind): Omit<LoadedWorkflow, 'container'> {
  const out: Omit<LoadedWorkflow, 'container'> = {};
  const p = safeParse(meta['prompt']);
  const w = safeParse(meta['workflow']);
  if (p !== undefined && isApiPrompt(p)) out.api = p;
  if (w !== undefined && isEditorWorkflow(w)) out.editor = w;
  if (out.api || out.editor) return out;

  if (meta['parameters'] !== undefined) {
    throw new ComfyDiffError(
      'not-workflow',
      'This image has generation info from another tool (A1111 / Forge "parameters"), not a ComfyUI workflow.',
    );
  }
  const what = kind === 'png' ? 'PNG' : kind === 'webp' ? 'WebP' : 'JPEG';
  throw new ComfyDiffError(
    'no-metadata',
    `This ${what} has no ComfyUI workflow inside. Discord, Telegram, WhatsApp, Reddit, X and most image hosts strip metadata on upload. ` +
      "Use the original file from ComfyUI's output folder, or share the workflow .json instead.",
  );
}

function safeParse(s: string | undefined): unknown {
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}


export function parseWorkflowText(text: string): Omit<LoadedWorkflow, 'container'> {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new ComfyDiffError('invalid-json', `The file is not valid JSON (${(e as Error).message}).`);
  }
  const found = detectJson(obj);
  if (!found.api && !found.editor) {
    throw new ComfyDiffError(
      'not-workflow',
      'This JSON is not a ComfyUI workflow. Expected either the editor format ("Save" / "Export": has "nodes" and "links") or the API format ("Export (API)": node ids mapping to class_type + inputs).',
    );
  }
  return found;
}

export function detectJson(obj: unknown): Omit<LoadedWorkflow, 'container'> {
  if (isEditorWorkflow(obj)) return { editor: obj };
  if (isApiPrompt(obj)) return { api: obj };
  if (isPlainObject(obj)) {

    const out: Omit<LoadedWorkflow, 'container'> = {};
    const p = maybeJson(obj['prompt']);
    if (isApiPrompt(p)) out.api = p;
    const extra = isPlainObject(obj['extra_data']) ? obj['extra_data'] : undefined;
    const pnginfo = extra && isPlainObject(extra['extra_pnginfo']) ? extra['extra_pnginfo'] : undefined;
    const w = maybeJson(obj['workflow'] ?? pnginfo?.['workflow']);
    if (isEditorWorkflow(w)) out.editor = w;
    return out;
  }
  return {};
}

function maybeJson(v: unknown): unknown {
  return typeof v === 'string' ? safeParse(v) : v;
}

export function isEditorWorkflow(v: unknown): v is EditorWorkflow {
  if (!isPlainObject(v) || !Array.isArray(v['nodes'])) return false;
  return (v['nodes'] as unknown[]).every((n) => isPlainObject(n) && 'id' in n && typeof n['type'] === 'string');
}

export function isApiPrompt(v: unknown): v is ApiPrompt {
  if (!isPlainObject(v)) return false;
  const vals = Object.values(v);
  return vals.length > 0 && vals.every((n) => isPlainObject(n) && typeof n['class_type'] === 'string' && isPlainObject(n['inputs']));
}
