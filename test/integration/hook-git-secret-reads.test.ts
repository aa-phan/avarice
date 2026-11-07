// CR-01: the secret-glob read denial must hold for the admitted git read commands. This file runs the real hook entry and
// real git on scratch repositories under the temp directory, never on the AVARICE checkout: each form is judged by the hook,
// and the same words are run by git to show what the refusal protects (no refusal here is vacuous).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';

import { makeHookFixture, runHook } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';
import { git, gitRun, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const SENTINEL = `AVARICE-CR01-SENTINEL-${randomBytes(4).toString('hex')}`;

const cleanup: Array<() => void> = [];
after(() => {
  for (const fn of cleanup) fn();
});

interface Rig {
  repo: ScratchRepo;
  fx: HookFixture;
}

// A repository that tracks `.env` (two commits) and `src/a.ts`, and a hook fixture whose policy points at it.
function rig(): Rig {
  const repo = makeScratchRepo({
    files: { '.env': `TOKEN=${SENTINEL}-v1\n`, 'src/a.ts': 'export const a = 1;\n' },
    commits: [{ '.env': `TOKEN=${SENTINEL}-v2\n` }],
  });
  const fx = makeHookFixture({ policy: { stagingPath: repo.path } });
  cleanup.push(
    () => repo.dispose(),
    () => rmSync(fx.dir, { recursive: true, force: true }),
  );
  return { repo, fx };
}

// The hook's verdict on a Bash command run in the repository: the denial rule, or 'allow' when the hook prints nothing.
function hookVerdict({ repo, fx }: Rig, command: string): string {
  const result = runHook(fx, 'pre', { cwd: repo.path, tool_name: 'Bash', tool_input: { command } });
  assert.equal(result.code, 0, result.stderr);
  if (result.stdout === '') return 'allow';
  const reason = (JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason;
  return reason.replace(/^avarice: /, '');
}

// What real git prints for the words of a corpus line (no quoted words in the corpus).
function gitOutput({ repo }: Rig, command: string): string {
  const out = gitRun(repo.path, command.split(' ').slice(1));
  return out.stdout + out.stderr;
}

describe('tracer: git show of a secret path through the real hook', () => {
  const r = rig();

  it('refuses git show HEAD:.env with deny-secret-read, and real git does print the secret (the refusal is not vacuous)', () => {
    assert.equal(hookVerdict(r, 'git show HEAD:.env'), 'deny-secret-read');
    assert.ok(gitOutput(r, 'git show HEAD:.env').includes(SENTINEL));
  });

  it('refuses git show :.env the same way', () => {
    assert.equal(hookVerdict(r, 'git show :.env'), 'deny-secret-read');
    assert.ok(gitOutput(r, 'git show :.env').includes(SENTINEL));
  });

  it('allows git show HEAD:src/a.ts, which git prints as the file text', () => {
    assert.equal(hookVerdict(r, 'git show HEAD:src/a.ts'), 'allow');
    assert.equal(gitOutput(r, 'git show HEAD:src/a.ts'), 'export const a = 1;\n');
    assert.equal(git(r.repo.path, ['rev-parse', 'HEAD']).trim(), r.repo.head);
  });
});
