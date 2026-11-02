// Canonical form of an absolute path for the hook and for the hook policy (docs/containment.md "File-edit
// safeguards": the hook resolves the target and every parent before comparing). Component by component from
// the root: an existing component is replaced by its realpath (which also gives the on-disk case on a
// case-insensitive volume), a dangling symlink is followed through its target (a Write through it would create
// the target), `..` is applied to the real directory reached so far (the kernel's meaning), and what does not
// exist yet is appended literally. Returns null for anything that cannot be decided (a loop, a permission
// error, a name that is too long), which callers treat as a denial. Imports only node:fs and node:path so the
// lean hook entry can load it.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_LINK_DEPTH = 40;

function code(e: unknown): string | undefined {
  return (e as { code?: string }).code;
}

function resolveFrom(start: string, parts: readonly string[], depth: number): string | null {
  if (depth > MAX_LINK_DEPTH) return null;
  let cur = start;
  for (let i = 0; i < parts.length; i += 1) {
    const seg = parts[i] as string;
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, seg);
    try {
      cur = realpathSync.native(next);
      continue;
    } catch (e) {
      if (code(e) !== 'ENOENT' && code(e) !== 'ENOTDIR') return null;
    }
    // Not resolvable: a dangling symlink, or a path that does not exist yet.
    let link: string | null = null;
    try {
      if (lstatSync(next).isSymbolicLink()) link = readlinkSync(next);
    } catch (e) {
      if (code(e) !== 'ENOENT' && code(e) !== 'ENOTDIR') return null;
    }
    const rest = parts.slice(i + 1);
    if (link !== null) {
      const base = link.startsWith('/') ? '/' : cur;
      return resolveFrom(base, [...link.split('/'), ...rest], depth + 1);
    }
    // Nothing from here on exists, so no further component can be a symlink.
    let tail = next;
    for (const part of rest) {
      if (part === '' || part === '.') continue;
      tail = part === '..' ? dirname(tail) : join(tail, part);
    }
    return tail;
  }
  return cur;
}

export function canonicalAbsolute(path: string): string | null {
  if (!path.startsWith('/')) return null;
  try {
    return resolveFrom('/', path.split('/'), 0);
  } catch {
    return null;
  }
}
