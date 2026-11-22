// One of the two competing processes of test/fault/bindings-race.test.ts (plan 04-43; WR-15, T-04-117). It waits for the start time both processes
// were given, then binds `count` distinct repositories to personal-local in a tight loop, one writeBinding call each. It prints one JSON line per call:
// the repository it bound and whether the registry took it.
//
//   node bindings-race-child.ts <configHome> <label> <startAtMs> <count>
//
// `node --test` with no file list also loads every file under test/; under the runner NODE_TEST_CONTEXT is set (the race test deletes it for its real
// children), so the helper does nothing there.
import { writeBinding } from '../../src/adapters/fs/profile-bindings.ts';

// A distinct 40-hex root commit and git root per label and index, so no two calls in the whole race name the same repository.
export function identityOf(label: string, index: number): { gitRoot: string; rootCommit: string } {
  return { gitRoot: `/race/${label}/repo-${String(index)}`, rootCommit: index.toString(16).padStart(2, '0') + (label === 'A' ? 'a' : 'b').repeat(38) };
}

function main(): void {
  const [configHome, label, startAt, count] = process.argv.slice(2) as [string, string, string, string];
  const startAtMs = Number(startAt);
  while (Date.now() < startAtMs) {
    // spin: the two processes leave this loop within a millisecond of each other
  }
  for (let i = 0; i < Number(count); i += 1) {
    const identity = identityOf(label, i);
    const written = writeBinding(configHome, { ...identity, profile: 'personal-local', boundAt: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify({ label, index: i, ok: written.ok, error: written.ok ? undefined : written.error })}\n`);
  }
}

if (process.env['NODE_TEST_CONTEXT'] === undefined) main();
