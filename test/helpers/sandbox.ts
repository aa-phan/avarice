// Fixtures for the sandboxed-executor suites: a scratch staging tree with `src/`, `scripts/x.sh` and
// `.planning/`, a content digest of a tree, and a command spec builder. Everything lives under os.tmpdir().
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { CommandSpec } from '../../src/ports/command-executor.ts';

export const TEST_PATH = '/usr/bin:/bin:/opt/homebrew/bin';

export interface ScratchStaging {
  // Realpath of the staging root.
  root: string;
  base: string;
}

// {root}/src/a.ts, {root}/scripts/x.sh (writes src/b.ts), {root}/.planning/ (empty).
export function makeScratchStaging(): ScratchStaging {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-sbx-')));
  const root = join(base, 'staging');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'scripts', 'x.sh'), '#!/bin/sh\necho hostile > src/b.ts\n');
  return { root, base };
}

// Digest of every file name, content and symlink target under dir, in a stable order.
export function treeDigest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      const stat = lstatSync(full);
      const rel = relative(dir, full);
      if (stat.isSymbolicLink()) hash.update(`L ${rel} ${readlinkSync(full)}\n`);
      else if (stat.isDirectory()) {
        hash.update(`D ${rel}\n`);
        walk(full);
      } else hash.update(`F ${rel} ${createHash('sha256').update(readFileSync(full)).digest('hex')}\n`);
    }
  };
  walk(dir);
  return hash.digest('hex');
}

export function spec(cwd: string, argv: readonly string[], overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    argv,
    cwd,
    env: { PATH: TEST_PATH, HOME: tmpdir(), LANG: 'C' },
    timeoutMs: 20_000,
    invocationId: 'test',
    writePaths: [],
    denyReadPaths: [],
    ...overrides,
  };
}
