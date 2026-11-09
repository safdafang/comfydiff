import { canonicalText } from './canonical';
import { diffGraphs } from './diff';
import { loadWorkflow, type LoadedWorkflow } from './load';
import { learnNames, normalize } from './normalize';
import type { DiffReport, NormGraph } from './types';
import { NameRegistry } from './widgets';

export * from './types';
export { ComfyDiffError, isComfyDiffError, type ComfyDiffErrorCode } from './errors';
export { loadWorkflow, parseWorkflowText, detectJson, type LoadedWorkflow, type ApiPrompt, type EditorWorkflow } from './load';
export { readPngText, readWebpText, readJpegText, sniff, type ContainerKind } from './container';
export { normalize, normalizeApi, normalizeEditor, routeAroundDisabled, type NormalizeOptions } from './normalize';
export { NameRegistry } from './widgets';
export { matchNodes } from './match';
export { diffGraphs } from './diff';
export { wordDiff, compactWords, tokenize } from './worddiff';
export { formatText, formatMarkdown, plainStyle, linkLine, linkSource, modeVerb, ignoredLine, notes, formatChange, NO_DIFF, type Style } from './format';
export { canonicalText } from './canonical';
export { formatValue, formatNumber } from './values';


export function normalizePair(a: LoadedWorkflow, b: LoadedWorkflow): [NormGraph, NormGraph] {
  const registry = new NameRegistry();
  learnNames(a, registry);
  learnNames(b, registry);

  const apiOnly = (w: LoadedWorkflow) => Boolean(w.api && !w.editor);
  const effective = apiOnly(a) !== apiOnly(b);
  return [normalize(a, registry, { effective }), normalize(b, registry, { effective })];
}

export function compareLoaded(a: LoadedWorkflow, b: LoadedWorkflow): DiffReport {
  const [ga, gb] = normalizePair(a, b);
  return diffGraphs(ga, gb);
}


export async function compareFiles(a: Uint8Array, b: Uint8Array): Promise<DiffReport> {
  const [la, lb] = await Promise.all([loadWorkflow(a), loadWorkflow(b)]);
  return compareLoaded(la, lb);
}


export async function textconv(bytes: Uint8Array): Promise<string> {
  const loaded = await loadWorkflow(bytes);
  const registry = new NameRegistry();
  learnNames(loaded, registry);
  return canonicalText(normalize(loaded, registry));
}
