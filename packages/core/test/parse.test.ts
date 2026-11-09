import { describe, expect, it } from 'vitest';
import { readExifAscii, readPngText, readWebpText, sniff } from '../src/container';
import { ComfyDiffError } from '../src/errors';
import { detectJson, loadWorkflow, parseWorkflowText } from '../src/load';
import { fixture, fixtureJson } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

describe('sniff', () => {
  it('detects containers by magic bytes', () => {
    expect(sniff(fixture('images/text-chunks.png'))).toBe('png');
    expect(sniff(fixture('images/exif.webp'))).toBe('webp');
    expect(sniff(fixture('pairs/param-changed/a.api.json'))).toBe('json');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(enc('﻿  {"a":1}'))).toBe('json');
    expect(sniff(enc('GIF89a'))).toBe('unknown');
  });
});

describe('PNG text chunks', () => {
  const expected = fixtureJson('pairs/param-changed/a.api.json');
  for (const f of ['text-chunks', 'itxt', 'itxt-compressed', 'ztxt']) {
    it(`reads prompt + workflow from ${f}.png`, async () => {
      const meta = await readPngText(fixture(`images/${f}.png`));
      expect(Object.keys(meta).sort()).toEqual(['prompt', 'workflow']);
      expect(JSON.parse(meta['prompt']!)).toEqual(expected);
      expect(JSON.parse(meta['workflow']!).nodes).toHaveLength(7);
    });
  }

  it('survives a truncated file', async () => {
    const meta = await readPngText(fixture('images/text-chunks.png').subarray(0, 200));
    expect(meta).toEqual({});
  });
});

describe('WebP EXIF', () => {
  it('reads prompt (0x0110) and workflow (0x010F)', () => {
    const meta = readWebpText(fixture('images/exif.webp'));
    expect(JSON.parse(meta['prompt']!)).toEqual(fixtureJson('pairs/param-changed/b.api.json'));
    expect(JSON.parse(meta['workflow']!).nodes).toHaveLength(7);
  });

  it('parses big-endian TIFF too', () => {
    const s = 'prompt:{}\0';
    const t = new Uint8Array(26 + s.length);
    const v = new DataView(t.buffer);
    t.set([0x4d, 0x4d], 0);
    v.setUint16(2, 42);
    v.setUint32(4, 8);
    v.setUint16(8, 1);
    v.setUint16(10, 0x0110);
    v.setUint16(12, 2);
    v.setUint32(14, s.length);
    v.setUint32(18, 26);
    t.set(enc(s), 26);
    expect(readExifAscii(t).get(0x0110)).toBe('prompt:{}');
  });
});

describe('loadWorkflow', () => {
  it('loads both formats from a ComfyUI PNG', async () => {
    const w = await loadWorkflow(fixture('images/text-chunks.png'));
    expect(w.container).toBe('png');
    expect(w.api).toBeDefined();
    expect(w.editor).toBeDefined();
  });

  it('loads prompt-only images', async () => {
    const w = await loadWorkflow(fixture('images/prompt-only.png'));
    expect(w.api).toBeDefined();
    expect(w.editor).toBeUndefined();
  });

  it('loads a WebP', async () => {
    const w = await loadWorkflow(fixture('images/exif.webp'));
    expect(w.container).toBe('webp');
    expect(w.api && w.editor).toBeTruthy();
  });

  it('explains stripped metadata', async () => {
    await expect(loadWorkflow(fixture('images/no-metadata.png'))).rejects.toMatchObject({ code: 'no-metadata' });
    await expect(loadWorkflow(fixture('images/no-metadata.png'))).rejects.toThrow(/strip metadata/);
  });

  it('recognises A1111 metadata as not a ComfyUI workflow', async () => {
    await expect(loadWorkflow(fixture('images/a1111.png'))).rejects.toMatchObject({ code: 'not-workflow' });
  });

  it('rejects unrelated JSON, broken JSON and unknown files', async () => {
    await expect(loadWorkflow(fixture('images/not-a-workflow.json'))).rejects.toMatchObject({ code: 'not-workflow' });
    await expect(loadWorkflow(enc('GIF89a...'))).rejects.toMatchObject({ code: 'unsupported-format' });
    await expect(loadWorkflow(enc('{"nodes": [}'))).rejects.toMatchObject({ code: 'invalid-json' });
  });

  it('throws ComfyDiffError instances', async () => {
    await expect(loadWorkflow(fixture('images/no-metadata.png'))).rejects.toBeInstanceOf(ComfyDiffError);
  });
});

describe('format detection', () => {
  it('detects editor and API JSON', () => {
    expect(Object.keys(parseWorkflowText(JSON.stringify(fixtureJson('pairs/node-added/a.workflow.json'))))).toEqual(['editor']);
    expect(Object.keys(parseWorkflowText(JSON.stringify(fixtureJson('pairs/node-added/a.api.json'))))).toEqual(['api']);
  });

  it('unwraps a /prompt request body', () => {
    const body = {
      client_id: 'x',
      prompt: fixtureJson('pairs/node-added/a.api.json'),
      extra_data: { extra_pnginfo: { workflow: fixtureJson('pairs/node-added/a.workflow.json') } },
    };
    const r = detectJson(body);
    expect(r.api).toBeDefined();
    expect(r.editor).toBeDefined();
  });

  it('accepts double-encoded JSON strings in wrappers', () => {
    expect(detectJson({ workflow: JSON.stringify(fixtureJson('pairs/node-added/a.workflow.json')) }).editor).toBeDefined();
  });
});
