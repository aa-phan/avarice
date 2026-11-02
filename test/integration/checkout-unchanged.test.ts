// S-29: uncommitted source edits and untracked files (including .env) are never mapped, never touched and never
// read. The checkout is compared byte for byte, with the porcelain status and HEAD, after an onboarding that is
// killed in the middle of the map invocation and then resumed. Scratch repositories and temp profiles only.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { EXPIRY_WAIT_MS, REPO_FILES, onboardingIdOf, resumeCli, rows, runWithFault, sleepSync } from '../helpers/fault-run.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';

const SECRET = 'CHECKOUT-UNCHANGED-SECRET-91b0c3d7e4';
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(root);
  return out;
}

describe('the user checkout is byte-identical through onboard, kill at mid-invocation and resume (S-29)', () => {
  it('leaves edits and untracked files alone, lists them as notMapped by name, and never stores their content', () => {
    const repo = makeScratchRepo({
      files: REPO_FILES,
      modified: { 'src/index.ts': 'export const answer = 43; // uncommitted\n' },
      untracked: { '.env': `API_KEY=${SECRET}\n`, 'scratch/todo.txt': 'local only\n', 'notes/idea.md': '# idea\n' },
    });
    const roots = makeRoots();
    cleanups.push(repo.dispose, () => rmSync(roots.base, { recursive: true, force: true }));
    const before = checkoutSnapshot(repo.path);

    runWithFault(roots, repo, 'mid-invocation');
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'unchanged after the kill');

    sleepSync(EXPIRY_WAIT_MS);
    const id = onboardingIdOf(roots);
    const resumed = resumeCli(roots, id);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout, new RegExp(`onboarding ${id}: active`));
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'unchanged after the resume');

    const expected = ['.env', 'notes/idea.md', 'scratch/todo.txt', 'src/index.ts'];
    const [record] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records');
    assert.deepEqual((JSON.parse(record?.body_json as string) as { notMapped: string[] }).notMapped, expected);
    const [onboarding] = rows<{ preflight_json: string; staging_worktree: string }>(roots, 'SELECT preflight_json, staging_worktree FROM onboardings');
    assert.deepEqual((JSON.parse(onboarding?.preflight_json as string) as { notMapped: string[] }).notMapped, expected);

    // The mapper saw the committed revision only: none of the uncommitted state exists in staging.
    const staging = onboarding?.staging_worktree as string;
    assert.equal(readFileSync(join(staging, 'src', 'index.ts'), 'utf8'), REPO_FILES['src/index.ts']);
    for (const absent of ['.env', 'scratch', 'notes']) assert.equal(existsSync(join(staging, absent)), false, absent);

    // The secret reached neither the ledger nor any other file AVARICE wrote.
    for (const file of [...filesUnder(roots.AVARICE_DATA_ROOT), ...filesUnder(staging).filter((f) => !f.includes(`${join(staging, '.git')}/`))]) {
      assert.equal(readFileSync(file).includes(SECRET), false, file);
    }
  });
});
