import type { Value } from './types';

export function valuesEqual(a: Value | undefined, b: Value | undefined): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as Value[];
    return a.length === bb.length && a.every((x, i) => valuesEqual(x, bb[i]));
  }
  const ao = a as Record<string, Value>;
  const bo = b as Record<string, Value>;
  const ka = Object.keys(ao);
  if (ka.length !== Object.keys(bo).length) return false;
  return ka.every((k) => k in bo && valuesEqual(ao[k], bo[k]));
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number.parseFloat(n.toPrecision(12)));
}

export function formatValue(v: Value | undefined, maxLen = 60): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    const shown = s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
    return v === '' ? '""' : shown;
  }
  const json = JSON.stringify(v);
  return json.length > maxLen ? json.slice(0, maxLen - 1) + '…' : json;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function toValue(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(toValue);
  if (typeof v === 'object') {
    const out: Record<string, Value> = {};
    for (const [k, x] of Object.entries(v as object)) out[k] = toValue(x);
    return out;
  }
  return null;
}

export function isSeedName(name: string): boolean {
  return /(^|_)seed$/i.test(name) || name === 'noise_seed';
}

export function isLongText(v: Value | undefined): v is string {
  return typeof v === 'string' && (v.length > 40 || v.includes('\n'));
}
