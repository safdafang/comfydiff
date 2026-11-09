import { describe, expect, it } from 'vitest';
import { compactWords, tokenize, wordDiff } from '../src/worddiff';

const side = (tokens: ReturnType<typeof wordDiff>, op: 'del' | 'add') =>
  tokens.filter((t) => t.op === 'eq' || t.op === op).map((t) => t.text).join('');

describe('wordDiff', () => {
  it('marks only the changed words', () => {
    expect(wordDiff('a red car', 'a blue car')).toEqual([
      { op: 'eq', text: 'a ' },
      { op: 'del', text: 'red' },
      { op: 'add', text: 'blue' },
      { op: 'eq', text: ' car' },
    ]);
  });

  it('merges neighbouring changes separated only by spaces or commas', () => {
    const d = wordDiff('1girl, orange hair, short hair, smile', '1girl, green skin, fish girl, smile');
    expect(d.filter((t) => t.op !== 'eq')).toEqual([
      { op: 'del', text: 'orange hair, short hair' },
      { op: 'add', text: 'green skin, fish girl' },
    ]);
  });

  it('keeps decimals together', () => {
    expect(tokenize('(masterpiece:1.25)')).toEqual(['(', 'masterpiece', ':', '1.25', ')']);
  });

  it('handles identical, empty and one-sided texts', () => {
    expect(wordDiff('same text', 'same text')).toEqual([{ op: 'eq', text: 'same text' }]);
    expect(wordDiff('', 'new')).toEqual([{ op: 'add', text: 'new' }]);
    expect(wordDiff('old', '')).toEqual([{ op: 'del', text: 'old' }]);
  });

  it('always reconstructs both sides exactly', () => {
    const samples = [
      ['masterpiece, best quality, 1girl, red hair\nsmile', 'best quality, 1girl, (blue hair:1.2)\n\nsmile, outdoors'],
      ['a  b   c', 'a b c'],
      ['привет мир, котик', 'привет, мир котики'],
      ['x', 'y'],
      ['lorem ipsum dolor sit amet, consectetur', 'lorem dolor sit amet consectetur adipiscing'],
    ];
    for (const [a, b] of samples) {
      const d = wordDiff(a!, b!);
      expect(side(d, 'del')).toBe(a);
      expect(side(d, 'add')).toBe(b);
    }
  });

  it('is fast on long prompts', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `tag${i}`);
    const a = words.join(', ');
    const b = words.map((w, i) => (i % 97 === 0 ? 'changed' : w)).join(', ');
    const t0 = performance.now();
    const d = wordDiff(a, b);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(side(d, 'add')).toBe(b);
  });
});

describe('compactWords', () => {
  it('keeps a few words of context around changes', () => {
    const a = 'one two three four five six seven eight nine ten eleven twelve red thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    const b = a.replace('red', 'blue');
    const c = compactWords(wordDiff(a, b));
    expect(c[0]!.text.startsWith('…')).toBe(true);
    expect(c[0]!.text).toContain('eleven twelve ');
    expect(c[c.length - 1]!.text.endsWith('…')).toBe(true);
    expect(c.find((t) => t.op === 'del')!.text).toBe('red');
  });
});
