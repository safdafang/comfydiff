import { describe, expect, it } from 'vitest';
import { loadWorkflow, type ApiPrompt, type EditorWorkflow, type LoadedWorkflow } from '../src/load';
import { learnNames, normalize, normalizeApi, normalizeEditor } from '../src/normalize';
import { NameRegistry } from '../src/widgets';
import { fixture, fixtureJson } from './helpers';

const api = (rel: string) => fixtureJson(rel) as ApiPrompt;
const ed = (rel: string) => fixtureJson(rel) as EditorWorkflow;
const KS = [1, 'fixed', 20, 7, 'euler', 'normal', 1];

describe('normalizeApi', () => {
  it('separates literals from links', () => {
    const ks = normalizeApi(api('pairs/param-changed/a.api.json')).nodes.get('3')!;
    expect(ks.type).toBe('KSampler');
    expect(ks.params).toEqual({ seed: 156680208700286, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 });
    expect(ks.inputs['model']).toEqual({ from: '4', slot: 0 });
    expect(ks.namedParams).toBe(true);
  });

  it('unwraps {__value__} array literals', () => {
    const g = normalizeApi({ '1': { class_type: 'X', inputs: { sizes: { __value__: [1, 2] } } } });
    expect(g.nodes.get('1')!.params['sizes']).toEqual([1, 2]);
  });

  it('treats a [string, int] pair pointing nowhere as a literal', () => {
    const g = normalizeApi({ '1': { class_type: 'X', inputs: { pair: ['99', 0] } } });
    expect(g.nodes.get('1')!.params['pair']).toEqual(['99', 0]);
  });
});

describe('normalizeEditor', () => {
  it('names core widgets from the built-in table and drops control_after_generate', () => {
    const ks = normalizeEditor(ed('pairs/param-changed/a.workflow.json'), new NameRegistry()).nodes.get('3')!;
    expect(ks.namedParams).toBe(true);
    expect(ks.params).toEqual({ seed: 156680208700286, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 });
    expect(ks.inputs['positive']).toEqual({ from: '6', slot: 0 });
    expect(ks.layout?.pos).toEqual([880, 200]);
  });

  it('falls back to positions for unknown nodes and never guesses names', () => {
    const wf: EditorWorkflow = { nodes: [{ id: 1, type: 'SomeCustomNode', mode: 0, widgets_values: [12345, 'randomize', 20, 'abc'] }], links: [] };
    const n = normalizeEditor(wf, new NameRegistry()).nodes.get('1')!;
    expect(n.namedParams).toBe(false);
    expect(n.params).toEqual({ '#1': 12345, '#3': 20, '#4': 'abc' });
  });

  it('does not apply a table entry whose length does not match', () => {
    const wf: EditorWorkflow = { nodes: [{ id: 1, type: 'KSampler', widgets_values: [1, 2, 3] }], links: [] };
    expect(normalizeEditor(wf, new NameRegistry()).nodes.get('1')!.namedParams).toBe(false);
  });

  it('uses inputs[].widget.name from newer frontends', () => {
    const wf: EditorWorkflow = {
      nodes: [
        {
          id: 1,
          type: 'MyNoise',
          widgets_values: [42, 'fixed', 0.5],
          inputs: [
            { name: 'noise_seed', widget: { name: 'noise_seed' }, link: null },
            { name: 'amount', widget: { name: 'amount' }, link: null },
          ],
        },
      ],
      links: [],
    };
    expect(normalizeEditor(wf, new NameRegistry()).nodes.get('1')!.params).toEqual({ noise_seed: 42, amount: 0.5 });
  });

  it('reads object-form widgets_values (named)', () => {
    const wf: EditorWorkflow = { nodes: [{ id: 1, type: 'VHS_VideoCombine', widgets_values: { frame_rate: 8, format: 'video/h264-mp4' } }], links: [] };
    expect(normalizeEditor(wf, new NameRegistry()).nodes.get('1')!.params).toEqual({ frame_rate: 8, format: 'video/h264-mp4' });
  });

  it('resolves links through Reroute and Set/Get nodes, and keeps notes aside', () => {
    const wf: EditorWorkflow = {
      nodes: [
        { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['m.safetensors'], outputs: [{ name: 'MODEL' }, { name: 'CLIP' }, { name: 'VAE' }] },
        { id: 2, type: 'Reroute', inputs: [{ name: '', link: 1 }] },
        { id: 3, type: 'SetNode', widgets_values: ['clip'], inputs: [{ name: 'CLIP', link: 2 }] },
        { id: 4, type: 'GetNode', widgets_values: ['clip'] },
        { id: 5, type: 'CLIPTextEncode', widgets_values: ['hello'], inputs: [{ name: 'clip', link: 3 }] },
        { id: 6, type: 'KSampler', widgets_values: KS, inputs: [{ name: 'model', link: 4 }] },
        { id: 7, type: 'Note', widgets_values: ['remember to upscale'] },
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 1, 1, 3, 0, 'CLIP'],
        [3, 4, 0, 5, 0, 'CLIP'],
        [4, 2, 0, 6, 0, 'MODEL'],
      ],
    };
    const g = normalizeEditor(wf, new NameRegistry());
    expect([...g.nodes.keys()].sort()).toEqual(['1', '5', '6']);
    expect(g.nodes.get('5')!.inputs['clip']).toEqual({ from: '1', slot: 1 });
    expect(g.nodes.get('6')!.inputs['model']).toEqual({ from: '1', slot: 0 });
    expect([...g.notes.values()]).toEqual(['remember to upscale']);
  });

  it('drops links from legacy PrimitiveNodes (the value lives in the target widget)', () => {
    const wf: EditorWorkflow = {
      nodes: [
        { id: 1, type: 'PrimitiveNode', widgets_values: [30, 'fixed'] },
        { id: 2, type: 'KSampler', widgets_values: [1, 'fixed', 30, 7, 'euler', 'normal', 1], inputs: [{ name: 'steps', widget: { name: 'steps' }, link: 1 }] },
      ],
      links: [[1, 1, 0, 2, 0, 'INT']],
    };
    const n = normalizeEditor(wf, new NameRegistry()).nodes.get('2')!;
    expect(n.inputs).toEqual({});
    expect(n.params['steps']).toBe(30);
  });

  it('flattens subgraphs with instance:inner ids and traces the boundary', () => {
    const sub = {
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Encode',
      nodes: [{ id: 1, type: 'CLIPTextEncode', widgets_values: ['inside'], inputs: [{ name: 'clip', link: 10 }] }],
      links: [
        { id: 10, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'CLIP' },
        { id: 11, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: 'CONDITIONING' },
      ],
    };
    const wf: EditorWorkflow = {
      version: 1,
      nodes: [
        { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['m.safetensors'] },
        { id: 2, type: sub.id, inputs: [{ name: 'clip', link: 1 }], mode: 4 },
        { id: 3, type: 'KSampler', widgets_values: KS, inputs: [{ name: 'positive', link: 2 }] },
      ],
      links: [
        { id: 1, origin_id: 1, origin_slot: 1, target_id: 2, target_slot: 0, type: 'CLIP' },
        { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0, type: 'CONDITIONING' },
      ],
      definitions: { subgraphs: [sub] },
    };
    const g = normalizeEditor(wf, new NameRegistry());
    const inner = g.nodes.get('2:1')!;
    expect(inner.type).toBe('CLIPTextEncode');
    expect(inner.mode).toBe('bypassed');
    expect(inner.inputs['clip']).toEqual({ from: '1', slot: 1 });
    expect(g.nodes.get('3')!.inputs['positive']).toEqual({ from: '2:1', slot: 0 });
  });
});

describe('normalize (both formats)', () => {
  it('learns names from the API prompt for nodes it leaves out', () => {
    const loaded: LoadedWorkflow = {
      container: 'json',
      api: { '1': { class_type: 'MyLoader', inputs: { file: 'x.bin', strength: 0.5 } } },
      editor: {
        nodes: [
          { id: 1, type: 'MyLoader', widgets_values: ['x.bin', 0.5] },
          { id: 2, type: 'MyLoader', mode: 4, widgets_values: ['y.bin', 0.8] },
        ],
        links: [],
      },
    };
    const reg = new NameRegistry();
    learnNames(loaded, reg);
    const g = normalize(loaded, reg);
    expect(g.nodes.get('2')!.params).toEqual({ file: 'y.bin', strength: 0.8 });
    expect(g.nodes.get('2')!.mode).toBe('bypassed');
  });

  it('restores editor wiring around bypassed nodes', async () => {
    const body = JSON.stringify({ prompt: fixtureJson('pairs/node-bypassed/b.api.json'), workflow: fixtureJson('pairs/node-bypassed/b.workflow.json') });
    const g = normalize(await loadWorkflow(new TextEncoder().encode(body)));
    expect(g.format).toBe('api+editor');
    expect(g.nodes.get('10')!.mode).toBe('bypassed');
    expect(g.nodes.get('3')!.inputs['model']).toEqual({ from: '10', slot: 0 });
  });

  it('takes titles, groups and layout from the editor part of a PNG', async () => {
    const g = normalize(await loadWorkflow(fixture('example/a.png')));
    expect(g.format).toBe('api+editor');
    expect(g.nodes.get('3')!.layout?.pos).toEqual([880, 200]);
    expect(g.groups).toEqual(['Prompt']);
    expect(g.nodes.get('6')!.group).toBe('Prompt');
  });
});
