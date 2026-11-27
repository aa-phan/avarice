// One of the two competing processes of test/fault/bindings-race.test.ts (plan 04-43; WR-15, T-04-117; plan 04-59, GWR-07). It waits for the start time both
// processes were given, then binds `count` distinct repositories to personal-local in a tight loop, one call each. It prints one JSON line per call: the
// repository it bound, whether the registry took it, and when the call was made and when it returned (`calledAt`, `returnedAt`, ms since the epoch), so the test
// can show that a call of one process was in flight while a call of the other was.
//
//   node bindings-race-child.ts <configHome> <label> <startAtMs> <count> [locked|unlocked]
//
// `locked` (the default) calls writeBinding. `unlocked` does what writeBinding does without its lock: it reads the registry, appends the entry and renames a
// temporary file over bindings.json. That writer exists only here, so the test can show that the same race loses bindings when there is no lock; the source
// tree has no such writer.
//
// `node --test` with no file list also loads every file under test/; under the runner NODE_TEST_CONTEXT is set (the race test deletes it for its real
// children), so the helper does nothing there.
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { bindingsPathFor, readBindings, writeBinding } from '../../src/adapters/fs/profile-bindings.ts';
import type { Binding } from '../../src/adapters/fs/profile-bindings.ts';

// A distinct 40-hex root commit and git root per label and index, so no two calls in the whole race name the same repository.
export function identityOf(label: string, index: number): { gitRoot: string; rootCommit: string } {
  return { gitRoot: `/race/${label}/repo-${String(index)}`, rootCommit: index.toString(16).padStart(2, '0') + (label === 'A' ? 'a' : 'b').repeat(38) };
}

const epochMs = (): number => performance.timeOrigin + performance.now();

// The read-add-rename of writeBinding with no lock, in the file format it writes: read the registry, append, write a temporary file in the same directory
// (flushed, as writeBinding flushes it) and rename it over the registry. Two of these that read before either renames drop the earlier entry.
function writeUnlocked(configHome: string, binding: Binding): { ok: boolean; error?: unknown } {
  const existing = readBindings(configHome);
  if (!existing.ok) return { ok: false, error: existing.error };
  const path = bindingsPathFor(configHome);
  const temp = `${path}.${String(process.pid)}.tmp`;
  const fd = openSync(temp, 'w', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify({ schema: 1, bindings: [...existing.value, binding] }, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  return { ok: true };
}

function main(): void {
  const [configHome, label, startAt, count, modeArg] = process.argv.slice(2) as [string, string, string, string, string | undefined];
  const mode = modeArg === 'unlocked' ? 'unlocked' : 'locked';
  const startAtMs = Number(startAt);
  while (Date.now() < startAtMs) {
    // spin: the two processes leave this loop within a millisecond of each other
  }
  for (let i = 0; i < Number(count); i += 1) {
    const binding: Binding = { ...identityOf(label, i), profile: 'personal-local', boundAt: new Date().toISOString() };
    const calledAt = epochMs();
    const written = mode === 'unlocked' ? writeUnlocked(configHome, binding) : writeBinding(configHome, binding);
    const returnedAt = epochMs();
    const error = written.ok ? undefined : 'error' in written ? written.error : undefined;
    process.stdout.write(`${JSON.stringify({ label, index: i, ok: written.ok, error, calledAt, returnedAt })}\n`);
  }
}

if (process.env['NODE_TEST_CONTEXT'] === undefined) main();
