// The GSD specs a restricted fast map needs, and which files they are (plan 04-34, owner ruling (a) after the second D-04 stop). The restricted host confines the
// file tools to the working directory, so the specs that sit outside it in GSD's own directory cannot be read; AVARICE copies the closure of the files the fast map
// reads into the staging copy, where the map skill looks first for a project-local spec, and takes it out again when the invocation is settled. This file is the pure
// part: where they go, which files seed the closure, how a file names the files it references, and the closure with its caps. Nothing here reads a file: the caller
// hands in a reader, so the adapter owns every path it touches.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

// Under the staging copy. The map skill reads `.claude/gsd-core/workflows/map-codebase.md` of the working directory before the global install.
export const RESTRICTED_SPEC_DIR = '.claude/gsd-core';

// The files the fast map starts from, relative to the gsd-core directory: the map workflow, the fast scan workflow the skill hands a `--fast` map to, and the one
// reference the mapper agent's definition loads.
export const RESTRICTED_SPEC_SEEDS: readonly string[] = ['workflows/map-codebase.md', 'workflows/scan.md', 'references/agent-skills-bootstrap.md'];

// A closure past either cap is refused, never cut short: a spec the model is told to read and cannot would be a refused read, which ends the map.
export const MAX_SPEC_FILES = 32;
export const MAX_SPEC_BYTES = 512 * 1024;

export interface SpecFile {
  // Relative to the gsd-core directory, with `/` separators.
  path: string;
  text: string;
}

// `gsd-core/<workflows|references|templates>/<path>.md`, however a file writes the part before it (`@~/.claude/`, `$HOME/.claude/`, `@`, nothing).
const REFERENCE = /gsd-core\/((?:workflows|references|templates)\/[A-Za-z0-9_./-]*\.md)/g;

// A path a spec may be staged from: plain segments, none empty, hidden or climbing out of the directory.
function isSpecPath(path: string): boolean {
  if (!/^(?:workflows|references|templates)\/[A-Za-z0-9_./-]+\.md$/.test(path)) return false;
  return path.split('/').every((segment) => segment.length > 0 && !segment.startsWith('.'));
}

// The files a text names, by their path under gsd-core, sorted and unique. A path that leaves its directory, is hidden, or is not a Markdown file of the three
// directories GSD keeps its specs in is not a reference.
export function specReferences(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(REFERENCE)) {
    const path = match[1] as string;
    if (isSpecPath(path)) found.add(path);
  }
  return [...found].sort();
}

// The seeds and every file they name, transitively, each once, sorted by path. A seed the reader cannot find is `not_found`; a referenced file it cannot find is a
// reference in prose and is skipped. A read error is returned as it came.
export function specClosure(seeds: readonly string[], read: (path: string) => Result<string | null>): Result<SpecFile[]> {
  const isSeed = new Set(seeds);
  for (const seed of seeds) {
    if (!isSpecPath(seed)) return err({ kind: 'invalid', field: 'seeds', reason: `${seed} is not a spec path` });
  }
  const queue = [...seeds];
  const files = new Map<string, string>();
  let bytes = 0;
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (files.has(next)) continue;
    const text = read(next);
    if (!text.ok) return text;
    if (text.value === null) {
      if (isSeed.has(next)) return err({ kind: 'not_found', ref: `gsd-core/${next}` });
      continue;
    }
    bytes += new TextEncoder().encode(text.value).length;
    if (files.size + 1 > MAX_SPEC_FILES) return err({ kind: 'invalid', field: 'specs', reason: `the specs name more than ${String(MAX_SPEC_FILES)} files` });
    if (bytes > MAX_SPEC_BYTES) return err({ kind: 'invalid', field: 'specs', reason: `the specs are larger than ${String(MAX_SPEC_BYTES)} bytes` });
    files.set(next, text.value);
    queue.push(...specReferences(text.value));
  }
  return ok([...files.entries()].map(([path, text]) => ({ path, text })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}
