// Canonical JSON and digests (SKELETON.md "Digests").
// Canonical form: object keys sorted by UTF-16 code unit, no whitespace, undefined properties
// omitted. Values with no canonical form (NaN, Infinity, undefined in an array, functions,
// bigint, class instances) throw TypeError, so two different values can never share a digest by
// accident of coercion.
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`no canonical form for ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((item) => canonicalJson(item === undefined ? rejectUndefined() : item)).join(',') + ']';
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError('no canonical form for a non-plain object');
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const item = record[key];
        if (item === undefined) continue;
        parts.push(JSON.stringify(key) + ':' + canonicalJson(item));
      }
      return '{' + parts.join(',') + '}';
    }
    default:
      throw new TypeError(`no canonical form for a value of type ${typeof value}`);
  }
}

function rejectUndefined(): never {
  throw new TypeError('no canonical form for undefined in an array');
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function digestOf(value: unknown): string {
  return 'sha256:' + sha256Hex(canonicalJson(value));
}
