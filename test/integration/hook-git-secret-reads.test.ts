// CR-01: the secret-glob read denial must hold for the admitted git read commands. This file runs the real hook entry and
// real git on scratch repositories under the temp directory, never on the AVARICE checkout: each form is judged by the hook,
// and the same words are run by git to show what the refusal protects (no refusal here is vacuous).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';

import { canonicalAbsolute } from '../../src/adapters/fs/canonical-path.ts';
import { decideToolCall } from '../../src/domain/hook-decision.ts';
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
  // The object name of `.env` at HEAD, for the forms that name a blob by its hash.
  blob: string;
}

// A repository that tracks `.env` (two commits, then a third version staged), `certs/server.pem` and ordinary files, and a hook
// fixture whose policy points at it.
function rig(): Rig {
  const repo = makeScratchRepo({
    files: {
      '.env': `TOKEN=${SENTINEL}-v1\n`,
      'certs/server.pem': `${SENTINEL}-pem\n`,
      '.env.example': 'TOKEN=changeme\n',
      'src/a.ts': 'export const a = 1;\n',
      'sub/b.txt': 'b\n',
    },
    commits: [{ '.env': `TOKEN=${SENTINEL}-v2\n`, 'sub/.env': `TOKEN=${SENTINEL}-sub\n` }],
    modified: { '.env': `TOKEN=${SENTINEL}-v3\n` },
  });
  git(repo.path, ['add', '.env']);
  const fx = makeHookFixture({ policy: { stagingPath: repo.path } });
  cleanup.push(
    () => repo.dispose(),
    () => rmSync(fx.dir, { recursive: true, force: true }),
  );
  return { repo, fx, blob: git(repo.path, ['rev-parse', 'HEAD:.env']).trim() };
}

// The pure decision, with the production canon, for a Bash command run in the repository.
function decide({ repo, fx }: Rig, command: string): { decision: string; rule?: string } {
  return decideToolCall({ kind: 'shell', command, background: false, cwd: repo.path }, fx.policy, canonicalAbsolute);
}

// The real hook entry's verdict: the denial rule, or 'allow' when the hook prints nothing.
function hookVerdict({ repo, fx }: Rig, command: string): string {
  const result = runHook(fx, 'pre', { cwd: repo.path, tool_name: 'Bash', tool_input: { command } });
  assert.equal(result.code, 0, result.stderr);
  if (result.stdout === '') return 'allow';
  const reason = (JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason;
  return reason.replace(/^avarice: /, '');
}

// What real git prints (stdout and stderr) for the words of a corpus line; the corpus uses no quoted words.
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
  });
});

describe('admitted git forms print no secret content', () => {
  const r = rig();
  const admitted = [
    'git log', 'git log --oneline', 'git log -1 --stat', 'git log --stat --format=%h', 'git log --name-status -2', 'git log --all --graph --oneline --decorate',
    'git log -n 1 --format=%H', `git log -1 --stat ${r.blob}`, 'git log --follow --oneline -- src/a.ts', 'git show HEAD:src/a.ts', 'git show :src/a.ts', 'git show HEAD:',
    'git show HEAD:.env.example', 'git show HEAD:sub', 'git status', 'git status --short', 'git status -sb', 'git status -uall', 'git status --porcelain=v2',
    'git ls-files -s', 'git rev-parse HEAD', 'git rev-parse HEAD:src/a.ts',
    // git takes the word after -n as its count, so a patch option there is refused by git itself and prints nothing.
    'git log -n -p', 'git status -u', 'git status -u -s', 'git status -uno',
  ];
  for (const command of admitted) {
    it(`${command}: allowed by the hook, and git prints no sentinel`, () => {
      const d = decide(r, command);
      assert.deepEqual([d.decision, d.rule], ['allow', 'shell-identity'], command);
      assert.ok(!gitOutput(r, command).includes(SENTINEL), `${command} printed the sentinel`);
    });
  }
});

describe('refused git forms are real leaks', () => {
  const r = rig();
  const leaks: Array<[string, string]> = [
    ['git show HEAD:.env', 'deny-secret-read'],
    ['git show :.env', 'deny-secret-read'],
    ['git show :0:.env', 'deny-secret-read'],
    ['git show HEAD~1:.env', 'deny-secret-read'],
    ['git show HEAD:./.env', 'deny-secret-read'],
    ['git show HEAD:certs/server.pem', 'deny-secret-read'],
    ['git show', 'shell-git-object'],
    ['git show HEAD', 'shell-git-object'],
    [`git show ${r.blob}`, 'shell-git-object'],
    [`git show -s ${r.blob}`, 'shell-git-output'],
    ['git log -p', 'shell-git-output'],
    ['git log -L1,1:.env', 'shell-git-output'],
    ['git status -v', 'shell-git-output'],
    ['git status -u -v', 'shell-git-output'],
    // `:^` is pathspec negation, like `:!`: git reads the word as an exclude pathspec and shows HEAD's patch for every other path.
    ['git show :^src/a.ts', 'shell-git-object'],
  ];
  for (const [command, rule] of leaks) {
    it(`${command}: denied ${rule}, and git does print the sentinel`, () => {
      const d = decide(r, command);
      assert.deepEqual([d.decision, d.rule], ['deny', rule], command);
      assert.ok(gitOutput(r, command).includes(SENTINEL), `${command} printed no sentinel: the refusal would be vacuous`);
    });
  }
});

describe('a quoted wildcard after a leading colon is a pathspec for git (review round 6)', () => {
  const r = rig();
  for (const word of [':*', ':.env*', ':?env', ':[.]env']) {
    it(`git show "${word}": denied shell-git-object, and git does print the sentinel`, () => {
      const d = decide(r, `git show "${word}"`);
      assert.deepEqual([d.decision, d.rule], ['deny', 'shell-git-object'], word);
      const out = gitRun(r.repo.path, ['show', word]);
      assert.ok((out.stdout + out.stderr).includes(SENTINEL), `${word} printed no sentinel: the refusal would be vacuous`);
    });
  }
});

describe('refused forms, git output reported', () => {
  const r = rig();
  const hookOnly: Array<[string, string]> = [
    ['git log --cc', 'shell-git-output'],
    ['git log --word-diff', 'shell-git-output'],
    ['git log --pat', 'shell-git-output'],
    ['git log -S TOKEN --oneline', 'shell-git-output'],
    ['git log --raw', 'shell-git-output'],
    ['git show HEAD:sub/../.env', 'deny-secret-read'],
  ];
  for (const [command, rule] of hookOnly) {
    it(`${command}: denied ${rule}`, (t) => {
      const d = decide(r, command);
      assert.deepEqual([d.decision, d.rule], ['deny', rule], command);
      t.diagnostic(`${command}: git printed the sentinel: ${gitOutput(r, command).includes(SENTINEL) ? 'yes' : 'no'}`);
    });
  }
});

describe('index form naming a directory (reported, not asserted)', () => {
  const r = rig();

  it('reports whether git show :sub prints the patch of HEAD for the files below sub, and what the hook decides', (t) => {
    const out = gitRun(r.repo.path, ['show', ':sub']);
    const printed = (out.stdout + out.stderr).includes(`${SENTINEL}-sub`);
    const d = decide(r, 'git show :sub');
    t.diagnostic(`git show :sub printed the sentinel of sub/.env: ${printed ? 'yes' : 'no'}; hook: ${d.decision} ${d.rule}`);
  });
});

describe('case variant of a secret path', () => {
  const r = rig();

  it('git show HEAD:.ENV prints no sentinel from real git, or the hook denies it', (t) => {
    const printed = gitOutput(r, 'git show HEAD:.ENV').includes(SENTINEL);
    t.diagnostic(`git show HEAD:.ENV printed the sentinel: ${printed ? 'yes' : 'no'}`);
    if (printed) assert.equal(decide(r, 'git show HEAD:.ENV').decision, 'deny');
  });
});
