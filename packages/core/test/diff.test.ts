import { describe, expect, it } from 'vitest';
import { compareFiles, formatMarkdown, formatText, type DiffReport } from '../src/index';
import { CASES, fixture } from './helpers';

type Combo = 'api' | 'workflow' | 'mixed';
const COMBOS: Combo[] = ['api', 'workflow', 'mixed'];

async function pair(name: string, combo: Combo): Promise<DiffReport> {
  const fa = combo === 'api' ? 'api' : 'workflow';
  const fb = combo === 'workflow' ? 'workflow' : 'api';
  return compareFiles(fixture(`pairs/${name}/a.${fa}.json`), fixture(`pairs/${name}/b.${fb}.json`));
}

const counts = (r: DiffReport) => ({
  params: r.params.length,
  added: r.added.length,
  removed: r.removed.length,
  links: r.links.length,
  modes: r.modes.length,
});

describe('every fixture pair is covered', () => {
  it('has expectations for each case', () => {
    expect(CASES.sort()).toEqual(
      ['ids-changed', 'moved-only', 'node-added', 'node-bypassed', 'node-muted', 'param-changed', 'prompt-text', 'rewired'].sort(),
    );
  });
});

describe.each(COMBOS)('fixture pairs (%s)', (combo) => {
  it('param-changed: changed values, seed as a mark only', async () => {
    const r = await pair('param-changed', combo);
    expect(counts(r)).toEqual({ params: 1, added: 0, removed: 0, links: 0, modes: 0 });
    const ks = r.params[0]!;
    expect(ks.node.label).toBe('KSampler');
    expect(ks.seedChanged).toBe(true);
    expect(ks.changes.map((c) => [c.name, c.from, c.to])).toEqual([
      ['steps', 20, 30],
      ['cfg', 7, 5.5],
      ['sampler_name', 'euler', 'dpmpp_2m'],
      ['scheduler', 'normal', 'karras'],
    ]);
    expect(r.significant).toBe(true);
  });

  it('node-added: the new node with key params, plus the inputs it now feeds', async () => {
    const r = await pair('node-added', combo);
    expect(counts(r)).toEqual({ params: 0, added: 1, removed: 0, links: 3, modes: 0 });
    expect(r.added[0]!.node.type).toBe('LoraLoader');
    expect(r.added[0]!.keyParams).toEqual(['detail_tweaker.safetensors', 'strength_model 0.6', 'strength_clip 0.6']);
    const ks = r.links.find((l) => l.node.type === 'KSampler')!;
    expect(ks.input).toBe('model');
    expect(ks.to!.node.type).toBe('LoraLoader');
    expect(ks.from!.node.type).toBe('CheckpointLoaderSimple');
  });

  it('rewired: swapped positive/negative are link changes, not parameter changes', async () => {
    const r = await pair('rewired', combo);
    expect(counts(r)).toEqual({ params: 0, added: 0, removed: 0, links: 2, modes: 0 });
    expect(r.links.map((l) => l.input).sort()).toEqual(['negative', 'positive']);
  });

  it('moved-only: nothing significant', async () => {
    const r = await pair('moved-only', combo);
    expect(r.significant).toBe(false);
    expect(counts(r)).toEqual({ params: 0, added: 0, removed: 0, links: 0, modes: 0 });
    if (combo === 'workflow') expect(r.cosmetic).toMatchObject({ moved: 7, resized: 1, recolored: 1, total: 9 });
    else expect(r.cosmetic.total).toBe(0);
  });

  it('ids-changed: rebuilt graph matches by content', async () => {
    const r = await pair('ids-changed', combo);
    expect(r.significant).toBe(false);
    expect(r.stats.matched).toBe(7);
    expect(r.stats.matchedById).toBe(0);
  });

  it('prompt-text: word-level diff of the prompt only', async () => {
    const r = await pair('prompt-text', combo);
    expect(counts(r)).toEqual({ params: 1, added: 0, removed: 0, links: 0, modes: 0 });
    const p = r.params[0]!;
    expect(p.node.label).toBe('CLIPTextEncode (positive)');
    const words = p.changes[0]!.words!;
    expect(words.filter((w) => w.op === 'del').map((w) => w.text)).toEqual(['rocky', 'golden', 'warm']);
    expect(words.filter((w) => w.op === 'add').map((w) => w.text)).toEqual(['stormy', 'blue', 'cold', ', dramatic clouds']);
  });

  it('node-bypassed', async () => {
    const r = await pair('node-bypassed', combo);
    if (combo === 'workflow') {

      expect(counts(r)).toEqual({ params: 0, added: 0, removed: 0, links: 0, modes: 1 });
      expect(r.modes[0]).toMatchObject({ from: 'active', to: 'bypassed', node: { type: 'LoraLoader' } });
    } else {

      expect(r.removed.map((s) => s.node.type)).toEqual(['LoraLoader']);
      expect(r.warnings.join(' ')).toMatch(/leaves out bypassed and muted nodes/);
    }
  });

  it('node-muted', async () => {
    const r = await pair('node-muted', combo);
    if (combo === 'workflow') {
      expect(counts(r)).toEqual({ params: 0, added: 0, removed: 0, links: 0, modes: 1 });
      expect(r.modes[0]).toMatchObject({ from: 'active', to: 'muted', node: { type: 'PreviewImage' } });
    } else {
      expect(r.removed.map((s) => s.node.type)).toEqual(['PreviewImage']);
    }
  });
});

describe('cross-format comparisons', () => {
  it('editor file with a bypassed node vs its own API export: no phantom rewiring', async () => {
    const r = await compareFiles(fixture('pairs/node-bypassed/b.workflow.json'), fixture('pairs/node-bypassed/b.api.json'));
    expect(r.links).toEqual([]);
    expect(r.params).toEqual([]);
    expect(r.removed.map((s) => [s.node.type, s.mode])).toEqual([['LoraLoader', 'bypassed']]);
  });

  it('identical workflow in PNG and JSON form: no differences', async () => {
    const r = await compareFiles(fixture('images/text-chunks.png'), fixture('pairs/param-changed/a.workflow.json'));
    expect(r.significant).toBe(false);
  });

  it('WebP vs PNG', async () => {
    const r = await compareFiles(fixture('images/text-chunks.png'), fixture('images/exif.webp'));
    expect(r.params[0]!.changes.map((c) => c.name)).toEqual(['steps', 'cfg', 'sampler_name', 'scheduler']);
  });

  it('the web example pair shows several kinds of change at once', async () => {
    const r = await compareFiles(fixture('example/a.png'), fixture('example/b.png'));
    expect(r.params.map((p) => p.node.label)).toEqual(['EmptyLatentImage', 'CLIPTextEncode (positive)', 'KSampler']);
    expect(r.added).toHaveLength(1);
    expect(r.links).toHaveLength(3);
    expect(r.cosmetic.moved).toBe(7);
  });
});

describe('formatting', () => {
  it('plain text', async () => {
    const t = formatText(await pair('param-changed', 'api'));
    expect(t).toContain('KSampler:');
    expect(t).toContain('steps 20 → 30, cfg 7 → 5.5, sampler_name euler → dpmpp_2m, scheduler normal → karras, seed changed');
  });

  it('says so explicitly when nothing affects the output', async () => {
    const t = formatText(await pair('moved-only', 'workflow'));
    expect(t).toContain('No differences that affect the output.');
    expect(t).toContain('(ignored layout changes: 7 nodes moved, 1 node resized, 1 node recolored)');
  });

  it('positional parameters are labelled as such', async () => {
    const wf = (v: number) =>
      new TextEncoder().encode(JSON.stringify({ nodes: [{ id: 1, type: 'MyCustomNode', widgets_values: ['x', v] }], links: [] }));
    const r = await compareFiles(wf(20), wf(30));
    expect(formatText(r)).toContain('param #2: 20 → 30');
    expect(r.unnamedTypes).toEqual(['MyCustomNode']);
    expect(formatText(r)).toMatch(/Parameter names unknown for MyCustomNode/);
  });

  it('markdown for Discord / Reddit / GitHub', async () => {
    const md = formatMarkdown(await pair('param-changed', 'api'), { a: 'a.json', b: 'b.json' });
    expect(md).toContain('- **KSampler**: steps `20` → `30`');
    expect(md).toContain('*seed changed*');
    const md2 = formatMarkdown(await pair('prompt-text', 'api'));
    expect(md2).toContain('~~rocky~~ **stormy**');
    expect(md2).toContain('masterpiece, **dramatic clouds**');
    const md3 = formatMarkdown(await pair('moved-only', 'api'));
    expect(md3).toContain('**No differences that affect the output.**');
  });

  it('markdown escapes user text', async () => {
    const wf = (t: string) =>
      new TextEncoder().encode(JSON.stringify({ nodes: [{ id: 1, type: 'SaveImage', title: 'my_*bold*_node', widgets_values: [t] }], links: [] }));
    const md = formatMarkdown(await compareFiles(wf('a'), wf('b')));
    expect(md).toContain('my\\_\\*bold\\*\\_node');
  });
});
