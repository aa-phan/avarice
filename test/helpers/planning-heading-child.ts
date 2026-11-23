// Child process for the planning heading timing regression (plan 04-41, CR-05). The regular expression that used to parse a heading backtracks without end on a
// crafted line, and synchronous regular-expression work cannot be interrupted by the test runner's own timeout; the test spawns this file with a spawn timeout instead.
// Usage: node planning-heading-child.ts <staging-directory>. It writes a `.planning/PROJECT.md` whose only heading line is `# a`, 200,000 spaces and `x` into the
// directory it is given, runs one `find` for the term `a`, prints the handle count and exits 0.
//
// `node --test` with no file list also loads every file under test/; under the runner NODE_TEST_CONTEXT is set (the heading test deletes it for its real child), so the
// helper does nothing there.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GsdPlanningContext } from '../../src/adapters/context/gsd-planning.ts';

async function main(): Promise<void> {
  const staging = process.argv[2];
  if (staging === undefined) {
    console.error('usage: planning-heading-child.ts <staging-directory>');
    process.exit(2);
  }
  mkdirSync(join(staging, '.planning'), { recursive: true });
  writeFileSync(join(staging, '.planning', 'PROJECT.md'), `# a${' '.repeat(200_000)}x\n\nbody text\n`);

  const source = new GsdPlanningContext({ nowMs: () => Date.parse('2026-11-17T00:00:00Z') });
  const found = await source.find({ term: 'a', workspace: { stagingPath: staging, repoPath: staging }, indexRevision: 'git:0123456789abcdef' }, 4000);
  if (!found.ok) {
    console.error(JSON.stringify(found));
    process.exit(1);
  }
  console.log(`handles=${found.value.length}`);
}

if (process.env['NODE_TEST_CONTEXT'] === undefined) await main();
