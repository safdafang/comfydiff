import type { WordToken } from './types';


export function tokenize(s: string): string[] {

  return s.match(/\s+|\d+(?:\.\d+)+|[\p{L}\p{N}_'’\-]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

const MAX_CELLS = 4_000_000;


export function wordDiff(a: string, b: string): WordToken[] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  let pre = 0;
  while (pre < ta.length && pre < tb.length && ta[pre] === tb[pre]) pre++;
  let suf = 0;
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf] === tb[tb.length - 1 - suf]) suf++;
  const ma = ta.slice(pre, ta.length - suf);
  const mb = tb.slice(pre, tb.length - suf);

  const out: WordToken[] = [];
  const push = (op: WordToken['op'], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  push('eq', ta.slice(0, pre).join(''));

  if (ma.length * mb.length > MAX_CELLS) {
    push('del', ma.join(''));
    push('add', mb.join(''));
  } else {

    const n = ma.length;
    const m = mb.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        push('eq', ma[i]!);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) push('del', ma[i++]!);
      else push('add', mb[j++]!);
    }
    while (i < n) push('del', ma[i++]!);
    while (j < m) push('add', mb[j++]!);
  }
  push('eq', ta.slice(ta.length - suf).join(''));
  return cleanup(out);
}


function cleanup(tokens: WordToken[]): WordToken[] {
  const out: WordToken[] = [];
  const emit = (op: WordToken['op'], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let del: string[] = [];
  let add: string[] = [];
  let hasDel = false;
  let hasAdd = false;
  const flush = () => {
    let d = hasDel ? del.join('') : '';
    let a = hasAdd ? add.join('') : '';

    const lead = d && a ? commonWs(d, a, false) : '';
    const trail = d && a ? commonWs(d.slice(lead.length), a.slice(lead.length), true) : '';
    d = d.slice(lead.length, d.length - trail.length);
    a = a.slice(lead.length, a.length - trail.length);
    emit('eq', lead);
    emit('del', d);
    emit('add', a);
    emit('eq', trail);
    del = [];
    add = [];
    hasDel = hasAdd = false;
  };
  tokens.forEach((t, k) => {
    if (t.op === 'del') {
      del.push(t.text);
      hasDel = true;
    } else if (t.op === 'add') {
      add.push(t.text);
      hasAdd = true;
    } else if (/^[\s,.;:|]+$/.test(t.text) && (hasDel || hasAdd) && tokens[k + 1] && tokens[k + 1]!.op !== 'eq') {

      del.push(t.text);
      add.push(t.text);
    } else {
      flush();
      emit('eq', t.text);
    }
  });
  flush();
  return out;
}

function commonWs(a: string, b: string, fromEnd: boolean): string {
  const ra = (fromEnd ? /\s*$/ : /^\s*/).exec(a)![0];
  const rb = (fromEnd ? /\s*$/ : /^\s*/).exec(b)![0];
  let n = 0;
  while (n < ra.length && n < rb.length && (fromEnd ? ra[ra.length - 1 - n] === rb[rb.length - 1 - n] : ra[n] === rb[n])) n++;
  return fromEnd ? ra.slice(ra.length - n) : ra.slice(0, n);
}


export function compactWords(tokens: WordToken[], contextWords = 3): WordToken[] {
  const keep = contextWords * 2;
  return tokens.map((t, k) => {
    if (t.op !== 'eq') return t;
    const parts = tokenize(t.text);
    const hasPrev = k > 0;
    const hasNext = k < tokens.length - 1;
    const budget = (hasPrev ? keep : 0) + (hasNext ? keep : 0);
    if (parts.length <= budget + 2) return t;
    const head = hasPrev ? parts.slice(0, keep).join('') : '';
    const tail = hasNext ? parts.slice(parts.length - keep).join('') : '';
    return { op: 'eq' as const, text: `${head}…${tail}` };
  });
}
