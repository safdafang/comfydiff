import { describe, expect, it } from 'vitest';
import { textconv } from '../src/index';
import { fixture } from './helpers';

describe('canonical text (textconv)', () => {
  it('ignores layout: moved-only files produce identical text', async () => {
    const a = await textconv(fixture('pairs/moved-only/a.workflow.json'));
    const b = await textconv(fixture('pairs/moved-only/b.workflow.json'));
    expect(a).toBe(b);
    expect(a).not.toMatch(/\bpos\b|\bsize\b|880/);
  });

  it('is stable regardless of node order in the file', async () => {
    const orig = JSON.parse(new TextDecoder().decode(fixture('pairs/param-changed/a.workflow.json')));
    const shuffled = { ...orig, nodes: [...orig.nodes].reverse() };
    const a = await textconv(fixture('pairs/param-changed/a.workflow.json'));
    const b = await textconv(new TextEncoder().encode(JSON.stringify(shuffled)));
    expect(a).toBe(b);
  });

  it('lists nodes in dependency order with named params and links', async () => {
    const t = await textconv(fixture('pairs/param-changed/a.api.json'));
    const order = [...t.matchAll(/^\[\d+\] (\S+)/gm)].map((m) => m[1]);
    expect(order).toEqual(['CheckpointLoaderSimple', 'EmptyLatentImage', 'CLIPTextEncode', 'CLIPTextEncode', 'KSampler', 'VAEDecode', 'SaveImage']);
    expect(t).toContain('    steps = 20');
    expect(t).toContain('    model <- [4] CheckpointLoaderSimple');
  });

  it('an inserted node does not reshuffle unrelated nodes', async () => {
    const order = async (f: string) => [...(await textconv(fixture(f))).matchAll(/^\[(\d+)\]/gm)].map((m) => m[1]);
    const before = await order('pairs/node-added/a.workflow.json');
    const after = (await order('pairs/node-added/b.workflow.json')).filter((id) => id !== '10');
    expect(after).toEqual(before);
  });

  it('splits long prompts one clause per line so git diff is word-friendly', async () => {
    const t = await textconv(fixture('pairs/prompt-text/a.workflow.json'));
    expect(t).toContain('    text = """\n      a watercolor painting of a lighthouse on a rocky coast,\n      golden hour,');
  });

  it('marks disabled nodes', async () => {
    const t = await textconv(fixture('pairs/node-bypassed/b.workflow.json'));
    expect(t).toMatch(/\[10\] LoraLoader {2}\(bypassed\)/);
  });
});
