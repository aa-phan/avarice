// decideToolCall: the pure decision behind AVARICE's PreToolUse hook (CON-2, CON-3, ONB-3, ONB-4). Every path
// goes through an injected canon(), so symlink and `..` escapes are exercised without a filesystem.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex } from '../../src/domain/digest.ts';
import { decideReadBeforeEdit, decideToolCall, loopLimitOf, normalizeToolCall, parseHookPolicy } from '../../src/domain/hook-decision.ts';
import type { HookDecision, HookPolicy, NormalizedToolCall } from '../../src/domain/hook-decision.ts';
import { DENIED_COMMAND_PREFIXES, GSD_READ_VERBS, READ_ONLY_COMMANDS } from '../../src/domain/invocation-scope.ts';

const STAGING = '/work/onb-1/staging';
const WRITE_ROOT = `${STAGING}/.planning/codebase`;
const REPO = '/home/u/repo';
const DATA = '/home/u/.local/share/avarice/p1';

const PREAMBLE = '_GSD_SHIM_NAME="gsd-tools.cjs"; gsd_run() { "$GSD_TOOLS" "$@"; }; true';
const PREAMBLE_SHA = sha256Hex(PREAMBLE);
const PREAMBLE_LENGTH = new TextEncoder().encode(PREAMBLE).length;

function policy(overrides: Partial<HookPolicy> = {}, commands: Partial<HookPolicy['commands']> = {}): HookPolicy {
  return {
    schema: 1,
    onboardingId: 'onb_1',
    runId: 'run_1',
    invocationId: 'inv_1',
    purpose: 'map',
    ledgerPath: `${DATA}/state.db`,
    stagingPath: STAGING,
    writeRoots: [WRITE_ROOT],
    denyRead: [REPO, DATA, '/home/u/.ssh'],
    allowRead: [`${REPO}/.git`],
    denyReadGlobs: ['**/.env', '**/*.pem'],
    commands: {
      strategy: 'blanket-bash-hook-identity',
      readOnly: [...READ_ONLY_COMMANDS],
      gsdReadVerbs: [...GSD_READ_VERBS.map],
      deniedPrefixes: [...DENIED_COMMAND_PREFIXES],
      preambleSha256: PREAMBLE_SHA,
      preambleLength: PREAMBLE_LENGTH,
      ...commands,
    },
    subagentTypes: ['gsd-codebase-mapper'],
    subagentsConcurrent: 4,
    ...overrides,
  };
}

// A canon that normalizes `.`/`..` lexically and follows a symlink table (absolute path to target).
function makeCanon(links: Readonly<Record<string, string>> = {}): (path: string) => string | null {
  return (path) => {
    const out: string[] = [];
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    let current = '/' + out.join('/');
    for (const [from, to] of Object.entries(links)) {
      if (current === from || current.startsWith(from + '/')) current = to + current.slice(from.length);
    }
    return current;
  };
}

const canon = makeCanon();
const decide = (call: NormalizedToolCall, p: HookPolicy = policy(), c = canon) => decideToolCall(call, p, c);
const shell = (command: string, cwd = STAGING): NormalizedToolCall => ({ kind: 'shell', command, background: false, cwd });
const write = (...paths: string[]): NormalizedToolCall => ({ kind: 'file-write', tool: 'Write', paths });
const read = (...paths: string[]): NormalizedToolCall => ({ kind: 'file-read', tool: 'Read', paths });

describe('file writes (canonical path of target and every parent)', () => {
  it('allows a write inside the write root', () => {
    const d = decide(write(`${WRITE_ROOT}/STACK.md`));
    assert.equal(d.decision, 'allow');
    assert.equal(d.budget, 'toolCalls');
  });

  it('denies a write elsewhere in staging', () => {
    const d = decide(write(`${STAGING}/src/a.ts`));
    assert.deepEqual([d.decision, d.rule], ['deny', 'outside-write-set']);
  });

  it('denies a write through a symlink that points out of the write root', () => {
    const c = makeCanon({ [`${WRITE_ROOT}/link`]: `${STAGING}/src` });
    const d = decide(write(`${WRITE_ROOT}/link`), policy(), c);
    assert.deepEqual([d.decision, d.rule], ['deny', 'outside-write-set']);
    const nested = decide(write(`${WRITE_ROOT}/link/new.ts`), policy(), c);
    assert.equal(nested.decision, 'deny');
  });

  it('allows a symlink that stays inside the write root', () => {
    const c = makeCanon({ [`${WRITE_ROOT}/alias`]: `${WRITE_ROOT}/real` });
    assert.equal(decide(write(`${WRITE_ROOT}/alias/x.md`), policy(), c).decision, 'allow');
  });

  it('denies `..` traversal out of the write root', () => {
    const d = decide(write(`${WRITE_ROOT}/../../src/a.ts`));
    assert.deepEqual([d.decision, d.rule], ['deny', 'outside-write-set']);
  });

  it('denies a sibling that only shares the prefix of the write root', () => {
    assert.equal(decide(write(`${WRITE_ROOT}-other/x.md`)).decision, 'deny');
  });

  it('denies when one of several paths is outside, and when the path cannot be resolved', () => {
    assert.equal(decide(write(`${WRITE_ROOT}/a.md`, `${STAGING}/b.md`)).decision, 'deny');
    const d = decide(write(`${WRITE_ROOT}/a.md`), policy(), () => null);
    assert.deepEqual([d.decision, d.rule], ['deny', 'unresolvable-path']);
  });

  it('denies every write when the invocation has no write root', () => {
    assert.equal(decide(write(`${WRITE_ROOT}/STACK.md`), policy({ writeRoots: [] })).decision, 'deny');
  });
});

describe('reads', () => {
  it('denies the user checkout (an untracked .env included) and the data root', () => {
    assert.deepEqual(
      ((d) => [d.decision, d.rule])(decide(read(`${REPO}/.env`))),
      ['deny', 'deny-read'],
    );
    assert.equal(decide(read(`${DATA}/state.db`)).decision, 'deny');
    assert.equal(decide(read('/home/u/.ssh/id_ed25519')).decision, 'deny');
  });

  it('allows reads inside staging and re-allows the git directory under a denied root', () => {
    assert.equal(decide(read(`${STAGING}/src/a.ts`)).decision, 'allow');
    assert.equal(decide(read(`${REPO}/.git/config`)).decision, 'allow');
    assert.equal(decide(read(`${REPO}/.gitignore`)).decision, 'deny');
  });

  it('denies secret-bearing files inside staging', () => {
    const d = decide(read(`${STAGING}/config/.env`));
    assert.deepEqual([d.decision, d.rule], ['deny', 'deny-secret-read']);
    assert.equal(decide(read(`${STAGING}/keys/server.pem`)).decision, 'deny');
  });

  it('applies the same rules to a search path', () => {
    assert.equal(decide({ kind: 'search', tool: 'Grep', path: STAGING }).decision, 'allow');
    assert.equal(decide({ kind: 'search', tool: 'Grep', path: REPO }).decision, 'deny');
  });

  it('follows a symlink out of staging into a denied root', () => {
    const c = makeCanon({ [`${STAGING}/escape`]: DATA });
    assert.equal(decide(read(`${STAGING}/escape/state.db`), policy(), c).decision, 'deny');
  });
});

// CR-02 / gap P-3 (D-GAP-01): a read is judged against an allow-list (staging, the policy's readRoots, allowRead) after the deny
// rules, so a path nobody listed (a sibling onboarding, a credential store) is outside it. The rules apply in a fixed order:
// readConfine, deny-read, the allow-list (outside-read-set), then the secret globs (deny-secret-read).
describe('reads are confined to an allow-list (CR-02, D-GAP-01)', () => {
  const rule = (d: ReturnType<typeof decide>): string => `${d.decision}:${d.rule}`;
  const withRoots = (readRoots: string[]): HookPolicy => policy({ readRoots });

  it('denies a sibling onboarding staging file and a credential store outside every root', () => {
    assert.equal(rule(decide(shell('cat /work/onb-2/staging/secret.txt'))), 'deny:outside-read-set');
    assert.equal(rule(decide(shell('cat /home/u/.netrc'))), 'deny:outside-read-set');
    assert.equal(rule(decide(read('/home/u/.netrc'))), 'deny:outside-read-set');
    assert.equal(rule(decide({ kind: 'search', tool: 'Grep', path: '/home/u' })), 'deny:outside-read-set');
    assert.equal(rule(decide({ kind: 'search', tool: 'Glob', path: STAGING, patternRoot: '/home/u/' })), 'deny:outside-read-set');
  });

  it('names deny-read for the same sibling file once the work root is a denied root and staging is re-allowed', () => {
    const p = policy({ denyRead: [REPO, DATA, '/home/u/.ssh', '/work'], allowRead: [`${REPO}/.git`, STAGING] });
    assert.equal(rule(decide(shell('cat /work/onb-2/staging/secret.txt'), p)), 'deny:deny-read');
    assert.equal(rule(decide(shell('cat src/a.ts'), p)), 'allow:shell-identity');
  });

  it('applies the rules in a fixed order', () => {
    assert.equal(rule(decide(shell('cat /home/u/.ssh/id_rsa'))), 'deny:deny-read');
    assert.equal(rule(decide(shell('cat config/.env'))), 'deny:deny-secret-read');
    assert.equal(rule(decide(read(`${REPO}/.git/config`))), 'allow:read-set');
    assert.equal(rule(decide(read(`${STAGING}/src/a.ts`))), 'allow:read-set');
  });

  it('allows a read root only when the policy lists it, for shell and Read alike', () => {
    const doc = '/gsd/core/workflows/map-codebase.md';
    assert.equal(rule(decide(shell(`cat ${doc}`))), 'deny:outside-read-set');
    assert.equal(rule(decide(read(doc))), 'deny:outside-read-set');
    const p = withRoots(['/gsd/core']);
    assert.equal(rule(decide(shell(`cat ${doc}`), p)), 'allow:shell-identity');
    assert.equal(rule(decide(read(doc), p)), 'allow:read-set');
    assert.equal(rule(decide({ kind: 'search', tool: 'Glob', path: '/gsd/core/workflows' }, p)), 'allow:read-set');
    assert.equal(rule(decide(shell('ls /gsd/core'), p)), 'allow:shell-identity');
    assert.equal(rule(decide(shell(`ls ${STAGING}`), p)), 'allow:shell-identity');
  });

  it('treats a path that only shares a prefix with an allowed root as outside it, and the root itself as inside', () => {
    const p = withRoots(['/gsd/core']);
    assert.equal(rule(decide(shell('cat /gsd/core-x/y'), p)), 'deny:outside-read-set');
    assert.equal(rule(decide(read('/gsd/core-x/y'), p)), 'deny:outside-read-set');
    assert.equal(rule(decide(shell('cat /work/onb-1/staging-other/x'), p)), 'deny:outside-read-set');
    assert.equal(rule(decide(read('/gsd/core'), p)), 'allow:read-set');
    assert.equal(rule(decide(read(STAGING), p)), 'allow:read-set');
  });

  it('judges a symlink by its canonical target, so a link out of staging does not widen the allow-list', () => {
    const c = makeCanon({ [`${STAGING}/escape`]: '/home/u' });
    assert.equal(rule(decide(read(`${STAGING}/escape/.netrc`), policy(), c)), 'deny:outside-read-set');
    const inward = makeCanon({ '/tmp/alias': `${STAGING}/src` });
    assert.equal(rule(decide(read('/tmp/alias/a.ts'), policy(), inward)), 'allow:read-set');
  });

  it('treats an empty readRoots list like an absent one', () => {
    assert.equal(rule(decide(read('/gsd/core/x.md'), withRoots([]))), 'deny:outside-read-set');
    assert.equal(rule(decide(read(`${STAGING}/src/a.ts`), withRoots([]))), 'allow:read-set');
  });

  it('parses readRoots, refuses a malformed one, and parses a policy without it', () => {
    const good = withRoots(['/gsd/core']);
    assert.deepEqual(parseHookPolicy(JSON.parse(JSON.stringify(good))), { ok: true, policy: JSON.parse(JSON.stringify(good)) });
    for (const bad of [{ ...good, readRoots: 'x' }, { ...good, readRoots: [4] }, { ...good, readRoots: null }]) {
      const parsed = parseHookPolicy(bad);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.match(parsed.reason, /needs a list of strings readRoots/);
    }
    assert.equal(parseHookPolicy(policy()).ok, true);
    assert.equal(parseHookPolicy({ ...good, readRoots: [] }).ok, true);
  });
});

describe('Bash command identity', () => {
  it('allows the GSD preamble followed by a read verb, and the preamble alone', () => {
    assert.equal(decide(shell(`${PREAMBLE}\ngsd_run graphify status`)).decision, 'allow');
    assert.equal(decide(shell(`${PREAMBLE}\ngsd_run query init.map-codebase --raw`)).decision, 'allow');
    assert.equal(decide(shell(PREAMBLE)).decision, 'allow');
    assert.equal(decide(shell(`${PREAMBLE}\n\n# a comment\ngsd_run intel status | head -5`)).decision, 'allow');
  });

  it('allows the VAR=$(gsd_run verb) form after the preamble but no other substitution', () => {
    assert.equal(decide(shell(`${PREAMBLE}\nINIT=$(gsd_run query init.map-codebase)`)).decision, 'allow');
    assert.equal(decide(shell(`${PREAMBLE}\nINIT=$(gsd_run config-set x y)`)).decision, 'deny');
    assert.equal(decide(shell(`${PREAMBLE}\nINIT=$(rm -rf x)`)).decision, 'deny');
  });

  it('denies a GSD verb that writes, and a gsd_run line without the verified preamble', () => {
    const verb = decide(shell(`${PREAMBLE}\ngsd_run config-set commit_docs true`));
    assert.deepEqual([verb.decision, verb.rule], ['deny', 'shell-gsd-verb']);
    const bare = decide(shell('gsd_run graphify status'));
    assert.deepEqual([bare.decision, bare.rule], ['deny', 'shell-gsd-no-preamble']);
    const tampered = decide(shell(`${PREAMBLE.replace('shim', 'SHIM').replace('gsd-tools', 'gsd-toolz')}\ngsd_run graphify status`));
    assert.equal(tampered.decision, 'deny');
  });

  it('denies anything that follows the preamble on its own line', () => {
    assert.equal(decide(shell(`${PREAMBLE}; rm -rf /\ngsd_run graphify status`)).decision, 'deny');
    assert.equal(decide(shell(`${PREAMBLE}\ngsd_run graphify status; rm x`)).decision, 'deny');
    assert.equal(decide(shell(`${PREAMBLE}\nnpm test`)).decision, 'deny');
  });

  it('accepts the real GSD 1.17.0 preamble fingerprint recorded by spike S0-A', () => {
    const results = JSON.parse(readFileSync(join(import.meta.dirname, '../../spikes/slice-0-wave-0/results.json'), 'utf8')) as {
      spikes: { 'S0-A': { preamble: { firstLine: string; sha256: string } } };
    };
    const { firstLine, sha256 } = results.spikes['S0-A'].preamble;
    assert.equal(sha256, 'c71090e895dc5a024a60e879e621d201f1b7f1fc4a9d5649e90dcabfba52622b');
    const real = policy({}, { preambleSha256: sha256, preambleLength: new TextEncoder().encode(firstLine).length });
    assert.equal(decide(shell(`${firstLine}\ngsd_run graphify status`), real).decision, 'allow');
  });

  it('allows a pipeline of read-only commands', () => {
    assert.equal(decide(shell('cat src/a.ts | head -20')).decision, 'allow');
    assert.equal(decide(shell('git ls-files | wc -l')).decision, 'allow');
    assert.equal(decide(shell('find . -name "*.ts" -print')).decision, 'allow');
    assert.equal(decide(shell("ls -la 'my dir'")).decision, 'allow');
  });

  it('denies find actions, git configuration overrides and git output files', () => {
    for (const command of [
      'find . -name x -delete',
      'find . -exec cat {} +',
      'find . -fprint out.txt',
      'git -c core.hooksPath=x status',
      'git log --output=out.txt',
      'git show --ext-diff HEAD',
      'git push',
      'git commit -m x',
    ]) {
      assert.equal(decide(shell(command)).decision, 'deny', command);
    }
    // CON-2: the Bash tool may run `find` as the embedded bfs, where -rm is an alias of -delete.
    for (const command of ['find . -rm', 'find .planning/codebase -name x -rm']) {
      assert.deepEqual(((d) => [d.decision, d.rule])(decide(shell(command))), ['deny', 'shell-find-action'], command);
    }
    // bfs reads a file list with -files0-from; that stays refused as an option value.
    assert.deepEqual(((d) => [d.decision, d.rule])(decide(shell('find . -files0-from /home/u/.netrc'))), ['deny', 'shell-option-value']);
  });

  it('denies commands outside the read-only set, repository scripts and denied prefixes', () => {
    for (const command of ['npm test', 'bash scripts/build.sh', './scripts/build.sh', 'sh -c "ls"', 'curl https://example.com', 'python3 -c "print(1)"', 'gh pr list', 'avarice status', 'make']) {
      assert.equal(decide(shell(command)).decision, 'deny', command);
    }
  });

  it('denies redirection, chaining, substitution, expansion and backgrounding', () => {
    for (const command of [
      'echo x > src/a.ts',
      'cat a >> b',
      'cat < a',
      'ls; rm x',
      'ls && rm x',
      'ls || rm x',
      'ls & rm x',
      'cat `ls`',
      'cat $(ls)',
      'cat <(ls)',
      'ls 2>&1',
      'cat "$HOME/x"',
      'cat ~/.ssh/id_rsa',
      'ls | ',
      'ls\nrm x',
      '',
    ]) {
      assert.equal(decide(shell(command)).decision, 'deny', JSON.stringify(command));
    }
  });

  it('denies read-only commands aimed at denied or secret paths', () => {
    const repo = decide(shell(`cat ${REPO}/.env`));
    assert.deepEqual([repo.decision, repo.rule], ['deny', 'deny-read']);
    assert.equal(decide(shell(`cat ${DATA}/state.db`)).decision, 'deny');
    const secret = decide(shell('cat config/.env'));
    assert.deepEqual([secret.decision, secret.rule], ['deny', 'deny-secret-read']);
    assert.equal(decide(shell('cat ../../../../home/u/repo/.env', `${STAGING}/sub`)).decision, 'deny');
  });

  it('returns an explicit allow only for the hook-allow strategy', () => {
    const explicit = decide(shell('ls'), policy({}, { strategy: 'hook-allow' }));
    assert.equal(explicit.decision, 'allow');
    assert.equal(explicit.explicit, true);
    assert.notEqual(decide(shell('ls')).explicit, true);
    assert.notEqual(decide(shell('ls'), policy({}, { strategy: 'narrow-rules' })).explicit, true);
  });
});

describe('gsd_run arguments (WR-06)', () => {
  const gsd = (line: string, p: HookPolicy = policy()) => {
    const d = decide(shell(`${PREAMBLE}\n${line}`), p);
    return [d.decision, d.rule];
  };
  const intel = () => policy({ purpose: 'intel', writeRoots: [`${STAGING}/.planning/intel`] }, { gsdReadVerbs: [...GSD_READ_VERBS.intel] });

  it('keeps admitting the GSD read flows', () => {
    for (const line of [
      'gsd_run graphify status',
      'gsd_run query init.map-codebase --raw',
      'gsd_run runtime-identity --raw',
      'gsd_run intel status | head -5',
      'gsd_run query agent-skills gsd-codebase-mapper',
      'gsd_run intel query auth',
      'gsd_run graphify query "auth service" --budget 1500',
      'gsd_run graphify query auth --budget=1500',
      'INIT=$(gsd_run query init.map-codebase)\nif [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi',
    ]) {
      assert.deepEqual(gsd(line), ['allow', 'shell-identity'], line);
    }
  });

  it('applies the read check to every word after the verb', () => {
    assert.deepEqual(gsd('gsd_run intel query ../../../etc/passwd'), ['deny', 'outside-read-set']);
    assert.deepEqual(gsd('gsd_run graphify query /etc/hosts'), ['deny', 'outside-read-set']);
    assert.deepEqual(gsd('gsd_run graphify query auth --budget ../../x'), ['deny', 'outside-read-set']);
    assert.deepEqual(gsd('gsd_run intel query /home/u/repo/src/a.ts'), ['deny', 'deny-read']);
    assert.deepEqual(gsd('gsd_run graphify query .env'), ['deny', 'deny-secret-read']);
  });

  it('refuses every option off the per-verb allow-list', () => {
    for (const line of [
      'gsd_run graphify query auth --cwd /home/u/repo',
      'gsd_run graphify query auth --cwd=/',
      'gsd_run state json --project-dir /tmp/x',
      'gsd_run roadmap analyze --ws=other',
      'gsd_run query init.map-codebase --pick x',
      'gsd_run intel query auth --budget 5',
      'gsd_run graphify query auth --budget',
      'gsd_run intel query -x',
      'gsd_run intel query -- x',
      'INIT=$(gsd_run query init.map-codebase --cwd /)',
    ]) {
      assert.deepEqual(gsd(line), ['deny', 'shell-gsd-option'], line);
    }
  });

  it('refuses an unquoted glob in a gsd_run segment', () => {
    assert.deepEqual(gsd('gsd_run intel query *'), ['deny', 'shell-syntax']);
  });

  it('holds the operand of intel patch-meta to the write set', () => {
    assert.deepEqual(gsd('gsd_run intel patch-meta .planning/intel/stack.json', intel()), ['allow', 'shell-identity']);
    assert.deepEqual(gsd('gsd_run intel validate', intel()), ['allow', 'shell-identity']);
    assert.deepEqual(gsd('gsd_run intel snapshot', intel()), ['allow', 'shell-identity']);
    assert.deepEqual(gsd('gsd_run intel patch-meta .planning/codebase/STACK.md', intel()), ['deny', 'outside-write-set']);
    assert.deepEqual(gsd('gsd_run intel patch-meta /home/u/repo/x.json', intel()), ['deny', 'deny-read']);
  });
});

// CR-02 / gap P-3: every word a read command names is a path candidate, whether it is an operand, an attached option
// value (`-OPATH`, `--name=PATH`) or a word after a bare `--`.
describe('shell option values and operands after -- (CR-02, D-GAP-01)', () => {
  const rule = (command: string, p: HookPolicy = policy(), cwd = STAGING): string => ((d) => `${d.decision}:${d.rule}`)(decide(shell(command, cwd), p));
  const roots = (...readRoots: string[]): HookPolicy => policy({ readRoots });

  it('denies each case VERIFICATION.md P-3 reproduced, with its rule', () => {
    assert.equal(rule('cat /work/onb-2/staging/secret.txt'), 'deny:outside-read-set');
    assert.equal(rule('cat /home/u/.netrc'), 'deny:outside-read-set');
    // The four grep cases are denied by name: grep is not an admitted command (WR-02).
    assert.equal(rule('grep -r token /home/u'), 'deny:shell-not-allowed');
    assert.equal(rule('grep -r PASSWORD .'), 'deny:shell-not-allowed');
    assert.equal(rule('grep -f/home/u/.ssh/id_rsa README.md'), 'deny:shell-not-allowed');
    assert.equal(rule('grep --file=/home/u/.ssh/id_rsa README.md'), 'deny:shell-not-allowed');
    // The two that were already denied stay denied.
    assert.equal(rule('cat /home/u/.ssh/id_rsa'), 'deny:deny-read');
    assert.equal(rule(`cat ${STAGING}/.env`), 'deny:deny-secret-read');
  });

  it('checks an attached short option value, alone or inside a cluster', () => {
    assert.equal(rule('git log -pO/home/u/.ssh/id_rsa'), 'deny:deny-read');
    assert.equal(rule('git log -O/home/u/.netrc'), 'deny:outside-read-set');
    assert.equal(rule('git log -O /home/u/.netrc'), 'deny:outside-read-set');
    assert.equal(rule('git log --author=/home/u/.ssh/id_rsa'), 'deny:deny-read');
    assert.equal(rule('head -n/home/u/.netrc src/a.ts'), 'deny:outside-read-set');
  });

  it('treats the word after a bare -- as an operand, even when it looks like an option', () => {
    assert.equal(rule('cat -- -/../../../../home/u/.netrc'), 'deny:outside-read-set');
    assert.equal(rule('cat -- /home/u/.netrc'), 'deny:outside-read-set');
    assert.equal(rule('cat -- -f /home/u/.netrc'), 'deny:outside-read-set');
    assert.equal(rule('cat -- src/a.ts'), 'allow:shell-identity');
  });

  it('reads an option cluster per character: only ASCII letters and digits are flags', () => {
    assert.equal(rule('ls -l/etc'), 'deny:shell-option-value');
    assert.equal(rule('ls -lé'), 'deny:shell-option-value');
    assert.equal(rule('ls -l-a'), 'deny:shell-option-value');
    assert.equal(rule('ls -1A'), 'allow:shell-identity');
    assert.equal(rule('wc -lc src/a.ts'), 'allow:shell-identity');
  });

  it('keeps allowing the read commands the mapper and the intel agent need', () => {
    for (const command of [
      'head -n5 src/a.ts',
      'head -n 5 src/a.ts',
      'tail -20 src/a.ts',
      'wc -l src/a.ts',
      'ls -1A',
      "ls -la 'my dir'",
      'find . -name "*.ts" -print',
      'find . -maxdepth 2 -type f',
      'git log -5 --oneline',
      'git log --format=%H -1',
      'git status -uall',
      'git ls-files',
      'git rev-parse HEAD',
      'cat -- src/a.ts',
      'cat src/a.ts | head -20',
    ]) {
      assert.equal(rule(command), 'allow:shell-identity', command);
    }
    assert.equal(decide(shell(`${PREAMBLE}\nINIT=$(gsd_run query init.map-codebase)\ngsd_run graphify status`)).decision, 'allow');
  });

  it('keeps the existing denials under their rules', () => {
    assert.equal(rule('git log --output=out.txt'), 'deny:shell-git-option');
    assert.equal(rule('find . -fprint out.txt'), 'deny:shell-find-action');
    assert.equal(rule('find src -name *.ts'), 'deny:shell-syntax');
    assert.equal(rule('cat src/*.ts'), 'deny:shell-syntax');
    assert.equal(rule('npm test'), 'deny:shell-denied-prefix');
  });
});

// WR-02: grep is not an admitted command. In the host Bash tool `grep` is a shell function that runs the embedded ugrep or
// /usr/bin/grep, chosen per call, so the hook cannot model its options. Every spelling is denied by name, before any option
// is parsed; searches go through the Grep tool, whose root the hook judges.
describe('shell grep is not an admitted command, whichever binary the shell runs (WR-02)', () => {
  const rule = (command: string, p: HookPolicy = policy(), cwd = STAGING): string => ((d) => `${d.decision}:${d.rule}`)(decide(shell(command, cwd), p));
  const roots = (...readRoots: string[]): HookPolicy => policy({ readRoots });

  const forms = [
    // the nine spellings 01-VERIFICATION.md P-3 reproduced
    'grep -dRECURSE PASSWORD .',
    'grep -d RECURSE PASSWORD .',
    'grep --directories=RECURSE PASSWORD .',
    'grep --directories=Recurse PASSWORD .',
    'grep --dir=RECURSE PASSWORD .',
    'grep -d rec PASSWORD .',
    'grep -d dereference-recurse PASSWORD .',
    'grep --directories=dereference-recurse PASSWORD .',
    'grep -ddereference-recurse PASSWORD .',
    // the earlier recursion spellings
    'grep -rn "a|b" src',
    'grep -R x src',
    'grep --recursive x src',
    'grep --dereference-recursive x src',
    'grep -r x',
    'grep -r PASSWORD .',
    'grep -r --exclude-dir x PASSWORD',
    'grep --directories RECURSE x src',
    // ugrep-only forms
    'grep -5 PASSWORD .',
    'grep PASSWORD .',
    'grep --filter=x:cat x src/a.ts',
    // plain reads that were allowed before
    'grep -n "a|b" src/a.ts',
    'grep -c x README.md',
    'grep -A3 x src/a.ts',
    'cat src/a.ts | grep -n x',
    'ls | grep x',
    // name variants
    '"grep" -r x .',
    '/usr/bin/grep -r PASSWORD .',
    'egrep -r x .',
    'fgrep -r x .',
    'rg PASSWORD',
    'ugrep -r x .',
    'git grep PASSWORD',
  ];
  for (const command of forms) {
    it(`denies shell-not-allowed: ${command}`, () => {
      assert.equal(rule(command), 'deny:shell-not-allowed');
    });
  }

  it('denies grep wherever the walk would start', () => {
    assert.equal(rule('grep -r x /gsd/core', roots('/gsd/core')), 'deny:shell-not-allowed');
    assert.equal(rule('grep -r x src', policy({ denyReadGlobs: ['config/secrets.json'] })), 'deny:shell-not-allowed');
    assert.equal(rule('grep -r x', roots('/gsd/core'), '/gsd/core'), 'deny:shell-not-allowed');
  });
});

describe('subagents, web, meta and unknown tools', () => {
  it('allows an Agent call of a permitted type and charges subagentsTotal', () => {
    const d = decide({ kind: 'subagent', subagentType: 'gsd-codebase-mapper' });
    assert.equal(d.decision, 'allow');
    assert.equal(d.budget, 'subagentsTotal');
  });

  it('denies an Agent call of any other type, and one with no type unless general-purpose is permitted', () => {
    const other = decide({ kind: 'subagent', subagentType: 'gsd-executor' });
    assert.deepEqual([other.decision, other.rule], ['deny', 'subagent-type']);
    assert.equal(decide({ kind: 'subagent', subagentType: null }).decision, 'deny');
    assert.equal(decide({ kind: 'subagent', subagentType: null }, policy({ subagentTypes: ['general-purpose'] })).decision, 'allow');
    assert.equal(decide({ kind: 'subagent', subagentType: 'gsd-codebase-mapper' }, policy({ subagentTypes: [] })).decision, 'deny');
  });

  it('denies WebFetch, WebSearch and any unknown tool; allows Skill and TodoWrite', () => {
    assert.deepEqual(((d) => [d.decision, d.rule])(decide({ kind: 'web', tool: 'WebFetch' })), ['deny', 'network-tool']);
    assert.equal(decide({ kind: 'web', tool: 'WebSearch' }).decision, 'deny');
    assert.deepEqual(((d) => [d.decision, d.rule])(decide({ kind: 'other', tool: 'mcp__x__do' })), ['deny', 'unknown-tool']);
    assert.equal(decide({ kind: 'meta', tool: 'Skill' }).decision, 'allow');
    const todo = decide({ kind: 'meta', tool: 'TodoWrite' });
    assert.equal(todo.decision, 'allow');
    assert.equal(todo.budget, 'toolCalls');
  });
});

describe('normalizeToolCall and parseHookPolicy', () => {
  it('maps Claude tool names to normalized calls and resolves relative paths against cwd', () => {
    assert.deepEqual(normalizeToolCall('Write', { file_path: '/a/b' }, STAGING), { ok: true, call: { kind: 'file-write', tool: 'Write', paths: ['/a/b'] } });
    assert.deepEqual(normalizeToolCall('Edit', { file_path: 'x/y.md' }, STAGING), { ok: true, call: { kind: 'file-write', tool: 'Edit', paths: [`${STAGING}/x/y.md`] } });
    assert.deepEqual(normalizeToolCall('NotebookEdit', { notebook_path: '/n.ipynb' }, STAGING), { ok: true, call: { kind: 'file-write', tool: 'NotebookEdit', paths: ['/n.ipynb'] } });
    assert.deepEqual(normalizeToolCall('Read', { file_path: '/r' }, STAGING), { ok: true, call: { kind: 'file-read', tool: 'Read', paths: ['/r'] } });
    assert.deepEqual(normalizeToolCall('Grep', { pattern: 'x' }, STAGING), { ok: true, call: { kind: 'search', tool: 'Grep', path: STAGING } });
    assert.deepEqual(normalizeToolCall('Glob', { pattern: '**/*.ts', path: 'src' }, STAGING), { ok: true, call: { kind: 'search', tool: 'Glob', path: `${STAGING}/src` } });
    assert.deepEqual(normalizeToolCall('Bash', { command: 'ls', run_in_background: true }, STAGING), { ok: true, call: { kind: 'shell', command: 'ls', background: true, cwd: STAGING } });
    assert.deepEqual(normalizeToolCall('Agent', { subagent_type: 'a' }, STAGING), { ok: true, call: { kind: 'subagent', subagentType: 'a' } });
    assert.deepEqual(normalizeToolCall('Task', {}, STAGING), { ok: true, call: { kind: 'subagent', subagentType: null } });
    assert.deepEqual(normalizeToolCall('WebFetch', { url: 'https://x' }, STAGING), { ok: true, call: { kind: 'web', tool: 'WebFetch' } });
    assert.deepEqual(normalizeToolCall('Skill', { skill: 'x' }, STAGING), { ok: true, call: { kind: 'meta', tool: 'Skill' } });
    assert.deepEqual(normalizeToolCall('Mystery', {}, STAGING), { ok: true, call: { kind: 'other', tool: 'Mystery' } });
  });

  it('refuses a call whose required field is missing or of the wrong type', () => {
    for (const [tool, input] of [['Write', {}], ['Read', { file_path: 4 }], ['Bash', { command: null }], ['MultiEdit', { file_path: '' }]] as const) {
      assert.equal(normalizeToolCall(tool, input, STAGING).ok, false, tool);
    }
  });

  it('parses a policy and refuses a malformed one', () => {
    const good = policy();
    assert.deepEqual(parseHookPolicy(JSON.parse(JSON.stringify(good))), { ok: true, policy: good });
    for (const bad of [null, [], {}, { ...good, schema: 2 }, { ...good, writeRoots: 'x' }, { ...good, commands: undefined }, { ...good, runId: 4 }]) {
      assert.equal(parseHookPolicy(bad).ok, false);
    }
  });

  // O-1: a policy without the concurrency limit would silently leave the control off, so it does not parse.
  it('requires subagentsConcurrent, a non-negative integer', () => {
    const good = policy();
    const { subagentsConcurrent: _dropped, ...without } = good;
    for (const bad of [without, { ...good, subagentsConcurrent: -1 }, { ...good, subagentsConcurrent: 1.5 }, { ...good, subagentsConcurrent: '4' }, { ...good, subagentsConcurrent: null }]) {
      assert.equal(parseHookPolicy(bad).ok, false, JSON.stringify((bad as { subagentsConcurrent?: unknown }).subagentsConcurrent));
    }
    assert.equal(parseHookPolicy({ ...good, subagentsConcurrent: 0 }).ok, true);
  });
});

// Decision B (2026-11-03): the knowledge purpose has no shell at all, reads only the corpus, writes only the extraction directory
// and starts no subagent. Every rule below is the policy the generated knowledge scope produces.
describe('the knowledge purpose policy: no shell, confined reads, one output directory', () => {
  const CORPUS = `${STAGING}/.avarice-knowledge`;
  const OUT = `${CORPUS}/.extraction`;
  const knowledge = (overrides: Partial<HookPolicy> = {}): HookPolicy =>
    policy(
      { purpose: 'knowledge', writeRoots: [OUT], readConfine: [CORPUS], subagentTypes: [], subagentsConcurrent: 0, ...overrides },
      { strategy: 'none', readOnly: [], gsdReadVerbs: [], preambleSha256: undefined, preambleLength: undefined },
    );

  it('denies every Bash call (shell-disabled), however read-only, and a bare gsd_run among them', () => {
    for (const command of ['ls', 'cat docs/a.md', 'git status', 'gsd_run query init.map-codebase', 'echo hi > x', 'python3 -c "print(1)"', 'graphify extract .']) {
      const d = decide(shell(command, CORPUS), knowledge());
      assert.deepEqual([d.decision, d.rule], ['deny', 'shell-disabled'], command);
    }
    // A background shell is a shell.
    assert.equal(decide({ kind: 'shell', command: 'ls', background: true, cwd: CORPUS }, knowledge()).decision, 'deny');
  });

  it('reads inside the corpus (Read, Glob, Grep) and nothing outside it, not even inside staging', () => {
    const p = knowledge();
    assert.equal(decide(read(`${CORPUS}/docs/a.md`), p).decision, 'allow');
    assert.equal(decide(read(`${CORPUS}/.chunks.json`), p).decision, 'allow');
    assert.equal(decide({ kind: 'search', tool: 'Glob', path: CORPUS }, p).decision, 'allow');
    assert.equal(decide({ kind: 'search', tool: 'Grep', path: `${CORPUS}/docs` }, p).decision, 'allow');
    for (const path of [`${STAGING}/src/a.ts`, `${STAGING}/.planning/PROJECT.md`, `${STAGING}/.avarice-knowledge-other/x.md`, STAGING, '/etc/passwd', '/gsd/core/bin/gsd-tools.cjs']) {
      const d = decide(read(path), p);
      assert.deepEqual([d.decision, d.rule], ['deny', 'outside-read-set'], path);
    }
    assert.deepEqual(((d) => [d.decision, d.rule])(decide({ kind: 'search', tool: 'Grep', path: STAGING }, p)), ['deny', 'outside-read-set']);
    assert.equal(decide({ kind: 'search', tool: 'Glob', path: CORPUS, patternRoot: '/etc/' }, p).decision, 'deny', 'an absolute glob names its own root');
  });

  it('still applies the secret and denied-root rules inside the corpus, and follows a symlink out of it', () => {
    const p = knowledge();
    assert.deepEqual(((d) => [d.decision, d.rule])(decide(read(`${CORPUS}/config/.env`), p)), ['deny', 'deny-secret-read']);
    const c = makeCanon({ [`${CORPUS}/escape`]: `${STAGING}/src` });
    assert.deepEqual(((d) => [d.decision, d.rule])(decide(read(`${CORPUS}/escape/a.ts`), p, c)), ['deny', 'outside-read-set']);
    const toData = makeCanon({ [`${CORPUS}/escape`]: DATA });
    assert.equal(decide(read(`${CORPUS}/escape/state.db`), p, toData).decision, 'deny');
  });

  it('writes only under the extraction directory: not the corpus itself, not the plan, not a document, not staging', () => {
    const p = knowledge();
    assert.equal(decide(write(`${OUT}/chunk-01.json`), p).decision, 'allow');
    for (const path of [`${CORPUS}/docs/a.md`, `${CORPUS}/.chunks.json`, `${CORPUS}/chunk-01.json`, `${STAGING}/src/a.ts`, `${STAGING}/.planning/codebase/STACK.md`, `${OUT}-x/chunk.json`]) {
      const d = decide(write(path), p);
      assert.deepEqual([d.decision, d.rule], ['deny', 'outside-write-set'], path);
    }
    const c = makeCanon({ [`${OUT}/link`]: `${STAGING}/src` });
    assert.equal(decide(write(`${OUT}/link/a.ts`), p, c).decision, 'deny', 'a symlink out of the output directory does not widen it');
  });

  it('starts no subagent and fetches nothing: Agent and Task are denied, so are the web tools and an unknown tool', () => {
    const p = knowledge();
    for (const type of [null, 'general-purpose', 'gsd-codebase-mapper', 'Explore']) {
      assert.deepEqual(((d) => [d.decision, d.rule])(decide({ kind: 'subagent', subagentType: type }, p)), ['deny', 'subagent-type'], String(type));
    }
    assert.equal(decide({ kind: 'web', tool: 'WebFetch' }, p).decision, 'deny');
    assert.equal(decide({ kind: 'other', tool: 'Mystery' }, p).decision, 'deny');
  });

  it('is only this policy: a policy without readConfine confines nothing, and the other strategies keep their shell rules', () => {
    assert.equal(decide(read(`${STAGING}/src/a.ts`), policy()).decision, 'allow');
    assert.equal(decide(shell('ls'), policy()).decision, 'allow');
  });

  it('parses a policy with readConfine and the strategy none, and refuses a malformed readConfine', () => {
    const good = knowledge();
    assert.deepEqual(parseHookPolicy(JSON.parse(JSON.stringify(good))), { ok: true, policy: JSON.parse(JSON.stringify(good)) });
    for (const bad of [{ ...good, readConfine: 'x' }, { ...good, readConfine: [4] }, { ...good, commands: { ...good.commands, strategy: 'bogus' } }]) {
      assert.equal(parseHookPolicy(bad).ok, false);
    }
    assert.equal(parseHookPolicy({ ...good, readConfine: [] }).ok, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The run purpose (plan 02-08): contract commands, no human prompts, no background shell, glob writes.
// ---------------------------------------------------------------------------------------------------------------

describe('the run purpose: agent commands, prompts and background shells (RC-4, RC-5, CON-5)', () => {
  const RUN_DENIED = DENIED_COMMAND_PREFIXES.filter((p) => p !== 'npm' && p !== 'npx');
  const runPolicy = (overrides: Partial<HookPolicy> = {}, commands: Partial<HookPolicy['commands']> = {}): HookPolicy =>
    policy(
      {
        purpose: 'run',
        writeRoots: ['/work/scratch'],
        writeGlobs: ['src/hooks/useSwipeStep.ts', 'tests/unit/*.test.ts', '.planning/quick/**'],
        protectedGlobs: ['package.json', '.github/**', '.git/**'],
        agentCommands: [
          { words: ['npm', 'run', 'typecheck'], paths: false },
          { words: ['npm', 'test'], paths: false },
          { words: ['npx', 'vitest', 'run'], paths: true },
        ],
        deniedTools: ['AskUserQuestion'],
        denyBackgroundShell: true,
        subagentTypes: ['gsd-executor'],
        ...overrides,
      },
      { gsdReadVerbs: [...GSD_READ_VERBS.run], deniedPrefixes: RUN_DENIED, ...commands },
    );
  const run = (command: string, over: Partial<HookPolicy> = {}) => decide(shell(command), runPolicy(over));
  const denied = (command: string, rule: string, over: Partial<HookPolicy> = {}) => {
    const d = run(command, over);
    assert.equal(d.decision, 'deny', command);
    assert.equal(d.rule, rule, command);
  };

  it('allows a contract command word for word with rule agent-command, charging toolCalls', () => {
    for (const command of ['npm run typecheck', 'npm test']) {
      const d = run(command);
      assert.deepEqual([d.decision, d.rule, d.budget], ['allow', 'agent-command', 'toolCalls'], command);
    }
  });

  it('denies a contract command with an extra word, and any other npm form, with shell-not-allowed', () => {
    denied('npm run typecheck -- --watch', 'shell-not-allowed');
    denied('npm test --silent', 'shell-not-allowed');
    denied('npm install left-pad', 'shell-not-allowed');
    denied('npm run build', 'shell-not-allowed');
    denied('npx tsc', 'shell-not-allowed');
  });

  it('admits path words after an entry that ends in <paths>, and none with zero paths denied', () => {
    assert.deepEqual(
      ['npx vitest run tests/unit/swipe-step.test.ts', 'npx vitest run tests/unit/a.test.ts src/hooks/useSwipeStep.ts', 'npx vitest run'].map((c) => run(c).rule),
      ['agent-command', 'agent-command', 'agent-command'],
    );
  });

  it('denies a <paths> word that leaves the read set with outside-read-set and a secret file with deny-secret-read', () => {
    denied('npx vitest run ../../etc/passwd', 'outside-read-set');
    denied('npx vitest run tests/.env', 'deny-secret-read');
  });

  it('denies an option, an absolute path and an expanding word among the <paths> with a rule that names why', () => {
    denied('npx vitest run --reporter=json', 'shell-not-allowed');
    denied('npx vitest run -u', 'shell-not-allowed');
    denied('npx vitest run /work/onb-1/staging/tests/a.test.ts', 'shell-not-allowed');
    denied('npx vitest run tests/**', 'shell-syntax');
  });

  it('denies a chained, substituted or redirected contract command with shell-syntax', () => {
    denied('npm test; curl x', 'shell-syntax');
    denied('npm test && git push', 'shell-syntax');
    denied('npm test > out.txt', 'shell-syntax');
    denied('npm test $(curl x)', 'shell-syntax');
  });

  it('allows a contract command piped into a read-only command, each segment judged on its own', () => {
    assert.equal(run('npm test | head -5').rule, 'agent-command');
    denied('npm test | sh', 'shell-not-allowed');
    denied('npm test | curl -d @- x', 'shell-denied-prefix');
  });

  it('without any agent command, npm and npx stay denied by their prefix exactly as in Phase 1', () => {
    for (const command of ['npm test', 'npx vitest run']) {
      const d = decide(shell(command), policy());
      assert.deepEqual([d.decision, d.rule], ['deny', 'shell-denied-prefix'], command);
    }
  });

  it('keeps git commit, git push, git config, git -c, avarice, claude, curl and make denied for the run purpose', () => {
    denied('git commit -m x', 'shell-denied-prefix');
    denied('git -c user.name=x commit -m x', 'shell-denied-prefix');
    denied('git push origin HEAD', 'shell-denied-prefix');
    denied('git config user.name x', 'shell-denied-prefix');
    denied('avarice status', 'shell-denied-prefix');
    denied('claude -p x', 'shell-denied-prefix');
    denied('curl https://example.com', 'shell-denied-prefix');
    denied('make test', 'shell-denied-prefix');
  });

  it('never matches an agent command that starts with a word the contract may not grant, even when a policy file lists one', () => {
    const hostile: Partial<HookPolicy> = {
      agentCommands: [
        { words: ['git', 'commit', '-m', 'x'], paths: false },
        { words: ['avarice', 'status'], paths: false },
        { words: ['/usr/bin/git', 'push'], paths: false },
        { words: ['curl'], paths: true },
      ],
    };
    denied('git commit -m x', 'shell-denied-prefix', hostile);
    denied('avarice status', 'shell-denied-prefix', hostile);
    denied('curl x', 'shell-denied-prefix', hostile);
    denied('/usr/bin/git push', 'shell-not-allowed', hostile);
  });

  it('keeps a Phase 1 read-only command working beside the contract commands', () => {
    const d = run('ls src');
    assert.deepEqual([d.decision, d.rule], ['allow', 'shell-identity']);
  });

  it('denies AskUserQuestion with no-human-prompts for the run purpose and keeps the Phase 1 rule for the others', () => {
    const call: NormalizedToolCall = { kind: 'other', tool: 'AskUserQuestion' };
    assert.deepEqual(decide(call, runPolicy()), { decision: 'deny', rule: 'no-human-prompts' });
    assert.deepEqual(decide(call, policy()), { decision: 'deny', rule: 'unknown-tool' });
    const normalized = normalizeToolCall('AskUserQuestion', { questions: [] }, STAGING);
    assert.ok(normalized.ok);
    assert.deepEqual(decide(normalized.call, runPolicy()), { decision: 'deny', rule: 'no-human-prompts' });
  });

  it('denies a tool the policy lists by name whatever its kind', () => {
    assert.deepEqual(decide({ kind: 'meta', tool: 'TodoWrite' }, runPolicy({ deniedTools: ['TodoWrite'] })), { decision: 'deny', rule: 'no-human-prompts' });
    assert.equal(decide({ kind: 'meta', tool: 'TodoWrite' }, runPolicy()).decision, 'allow');
  });

  it('denies a background shell call with background-shell, an allowed command included, and charges nothing', () => {
    const background = (command: string): NormalizedToolCall => ({ kind: 'shell', command, background: true, cwd: STAGING });
    for (const command of ['npm test', 'ls', 'npm run typecheck']) assert.deepEqual(decide(background(command), runPolicy()), { decision: 'deny', rule: 'background-shell' }, command);
    // Phase 1 purposes handle a background shell as before.
    const onboarding = decide(background('ls'), policy());
    assert.deepEqual([onboarding.decision, onboarding.rule], ['allow', 'shell-identity']);
    assert.equal(decide(shell('ls'), runPolicy()).decision, 'allow');
  });

  it('judges a contract command after the GSD preamble line like any other line', () => {
    const d = decide(shell(`${PREAMBLE}\nnpm test`), runPolicy());
    assert.deepEqual([d.decision, d.rule], ['allow', 'agent-command']);
    assert.equal(decide(shell(`${PREAMBLE}\nnpm test -- --watch`), runPolicy()).rule, 'shell-not-allowed');
  });

  // Plan 02-09 (spike S2-B): the GSD verbs of the quick workflow, each admitted in the one form quick.md issues it, with a refused neighbour.
  describe('the GSD verbs of the quick workflow (CON-2; plan 02-09)', () => {
    const gsd = (line: string): HookDecision => decide(shell(`${PREAMBLE}\n${line}`), runPolicy());
    const gsdAllowed = (line: string): void => {
      const d = gsd(line);
      assert.deepEqual([d.decision, d.rule, d.budget], ['allow', 'shell-identity', 'toolCalls'], line);
    };
    const gsdDenied = (line: string, rule: string): void => {
      const d = gsd(line);
      assert.deepEqual([d.decision, d.rule], ['deny', rule], line);
    };

    it('admits query init.quick with the one flag quick.md line 125 passes in validate mode, and refuses any other flag', () => {
      gsdAllowed('INIT=$(gsd_run query init.quick "Collapse repeated dashes")');
      gsdAllowed('INIT=$(gsd_run query init.quick "Collapse repeated dashes" --validate)');
      gsdDenied('INIT=$(gsd_run query init.quick "Collapse repeated dashes" --full)', 'shell-gsd-option');
      gsdDenied('INIT=$(gsd_run query init.quick "Collapse repeated dashes" --ws=other)', 'shell-gsd-option');
      gsdDenied('INIT=$(gsd_run query init.quick "x" --cwd /etc)', 'shell-gsd-option');
    });

    it('admits query config-get only for the keys quick.md and the gsd-executor agent read, with --default as its one value option', () => {
      for (const key of ['response_language', 'workflow.use_worktrees', 'runtime', 'workflow._auto_chain_active', 'workflow.auto_advance', 'workflow.human_verify_mode', 'commit_docs']) {
        gsdAllowed(`gsd_run query config-get ${key} --raw`);
      }
      gsdAllowed('HUMAN_VERIFY_MODE=$(gsd_run query config-get workflow.human_verify_mode --default end-of-phase --raw)');
      gsdAllowed('RESPONSE_LANGUAGE=$(gsd_run query config-get response_language --raw --default "")');
      // The refused neighbours: another key, no key, two keys, another option, a redirection.
      gsdDenied('gsd_run query config-get brave_search --raw', 'shell-gsd-operand');
      gsdDenied('gsd_run query config-get --raw', 'shell-gsd-operand');
      gsdDenied('gsd_run query config-get commit_docs runtime --raw', 'shell-gsd-operand');
      gsdDenied('gsd_run query config-get commit_docs --pick x', 'shell-gsd-option');
      gsdDenied('RESPONSE_LANGUAGE=$(gsd_run query config-get response_language --raw --default "" 2>/dev/null || echo "")', 'shell-syntax');
    });

    it('admits loop render-hooks only for the two points quick.md renders', () => {
      gsdAllowed('PLAN_PRE_HOOKS_JSON=$(gsd_run loop render-hooks plan:pre --raw)');
      gsdAllowed('EXECUTE_POST_HOOKS_JSON=$(gsd_run loop render-hooks execute:post --raw)');
      gsdDenied('gsd_run loop render-hooks verify:post --raw', 'shell-gsd-operand');
      gsdDenied('gsd_run loop render-hooks --raw', 'shell-gsd-operand');
      gsdDenied('gsd_run loop run-step plan:pre', 'shell-gsd-verb');
    });

    it('keeps every GSD verb that writes denied: config-set, query commit and quick-tasks-append', () => {
      gsdDenied('gsd_run config-set workflow.text_mode false', 'shell-gsd-verb');
      gsdDenied('gsd_run query commit "docs: x" --files a', 'shell-gsd-verb');
      gsdDenied('gsd_run quick-tasks-append --quick-id 1 --slug x --task y', 'shell-gsd-verb');
    });

    it('keeps the git shapes of quick.md denied by design: commit, add, push, checkout -b, fetch and worktree', () => {
      for (const command of ['git commit -m x', 'git push origin HEAD']) denied(command, 'shell-denied-prefix');
      for (const command of ['git add src/slug.ts', 'git checkout -b quick/x', 'git fetch origin main', 'git worktree add ../x']) denied(command, 'shell-not-allowed');
    });
  });
});

describe('the run purpose: glob writes (CON-2)', () => {
  const runPolicy = (): HookPolicy =>
    policy({
      purpose: 'run',
      writeRoots: ['/work/scratch'],
      writeGlobs: ['src/hooks/useSwipeStep.ts', 'tests/unit/*.test.ts', '.planning/quick/**'],
      protectedGlobs: ['package.json', '.github/**', '.git/**', '.planning/config.json'],
    });
  const writeRule = (path: string, c = canon) => decide(write(path), runPolicy(), c);

  it('allows a path that matches a write glob with rule write-set', () => {
    for (const path of [`${STAGING}/src/hooks/useSwipeStep.ts`, `${STAGING}/tests/unit/a.test.ts`, `${STAGING}/.planning/quick/1/PLAN.md`, `${STAGING}/.planning/quick`]) {
      assert.deepEqual(writeRule(path), { decision: 'allow', rule: 'write-set', budget: 'toolCalls' }, path);
    }
  });

  it('denies a path outside every glob with outside-write-set, sibling names sharing a prefix included', () => {
    for (const path of [`${STAGING}/src/lib/x.ts`, `${STAGING}/src/hooks/useSwipeStep.tsx`, `${STAGING}/tests/unit/deep/a.test.ts`, `${STAGING}-evil/src/hooks/useSwipeStep.ts`, '/work/onb-1/staging2/x', '/etc/passwd']) {
      assert.deepEqual(writeRule(path), { decision: 'deny', rule: 'outside-write-set' }, path);
    }
  });

  it('denies a protected path with protected-path before it asks the write globs, and the clone itself with outside-write-set', () => {
    assert.deepEqual(writeRule(`${STAGING}/package.json`), { decision: 'deny', rule: 'protected-path' });
    assert.deepEqual(writeRule(`${STAGING}/.github/workflows/ci.yml`), { decision: 'deny', rule: 'protected-path' });
    assert.deepEqual(writeRule(`${STAGING}/.git/config`), { decision: 'deny', rule: 'protected-path' });
    assert.deepEqual(writeRule(`${STAGING}/.planning/config.json`), { decision: 'deny', rule: 'protected-path' });
    assert.deepEqual(writeRule(STAGING), { decision: 'deny', rule: 'outside-write-set' });
  });

  it('lets a protected glob win over a write glob that also matches', () => {
    const both = policy({ purpose: 'run', writeGlobs: ['src/**'], protectedGlobs: ['src/secret/**'], writeRoots: [] });
    assert.equal(decide(write(`${STAGING}/src/a.ts`), both, canon).decision, 'allow');
    assert.deepEqual(decide(write(`${STAGING}/src/secret/k.ts`), both, canon), { decision: 'deny', rule: 'protected-path' });
  });

  it('allows the scratch directory, a write root outside the clone, and nothing beside it', () => {
    assert.equal(writeRule('/work/scratch/tmp/x.txt').decision, 'allow');
    assert.deepEqual(writeRule('/work/scratch-evil/x'), { decision: 'deny', rule: 'outside-write-set' });
  });

  it('judges the canonical path: a symlink out of the clone and a .. that leaves it are outside', () => {
    const links = makeCanon({ [`${STAGING}/.planning/quick/out`]: '/elsewhere' });
    assert.deepEqual(writeRule(`${STAGING}/.planning/quick/out/x.ts`, links), { decision: 'deny', rule: 'outside-write-set' });
    assert.deepEqual(writeRule(`${STAGING}/src/hooks/../../../x.ts`), { decision: 'deny', rule: 'outside-write-set' });
    // A symlink that points inside the clone at a protected path is judged by where it lands.
    const toProtected = makeCanon({ [`${STAGING}/.planning/quick/p`]: `${STAGING}/package.json` });
    assert.deepEqual(writeRule(`${STAGING}/.planning/quick/p`, toProtected), { decision: 'deny', rule: 'protected-path' });
  });

  it('keeps the Phase 1 rule when the policy has no writeGlobs: a path under a write root', () => {
    assert.equal(decide(write(`${WRITE_ROOT}/STACK.md`), policy(), canon).rule, 'write-set');
    assert.deepEqual(decide(write(`${STAGING}/src/a.ts`), policy(), canon), { decision: 'deny', rule: 'outside-write-set' });
  });

  it('applies the glob rule to MultiEdit and NotebookEdit like Edit and Write', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      const n = normalizeToolCall(tool, tool === 'NotebookEdit' ? { notebook_path: `${STAGING}/package.json` } : { file_path: `${STAGING}/package.json` }, STAGING);
      assert.ok(n.ok, tool);
      assert.deepEqual(decide(n.call, runPolicy(), canon), { decision: 'deny', rule: 'protected-path' }, tool);
    }
  });
});

describe('parseHookPolicy for the run purpose', () => {
  const base = (): HookPolicy => ({
    ...policy({ purpose: 'run', writeGlobs: ['src/**'], protectedGlobs: ['package.json'], agentCommands: [{ words: ['npm', 'test'], paths: false }], deniedTools: ['AskUserQuestion'], denyBackgroundShell: true }),
  });

  it('accepts a run policy with every new field and round-trips it', () => {
    const good = base();
    assert.deepEqual(parseHookPolicy(JSON.parse(JSON.stringify(good))), { ok: true, policy: JSON.parse(JSON.stringify(good)) });
  });

  it('refuses malformed run fields and writeGlobs without protectedGlobs', () => {
    const good = base();
    const { protectedGlobs: _p, ...noProtected } = good;
    for (const bad of [
      noProtected,
      { ...good, writeGlobs: 'src/**' },
      { ...good, protectedGlobs: [1] },
      { ...good, deniedTools: 'AskUserQuestion' },
      { ...good, denyBackgroundShell: 'yes' },
      { ...good, agentCommands: 'npm test' },
      { ...good, agentCommands: [{ words: [], paths: false }] },
      { ...good, agentCommands: [{ words: ['npm'], paths: 'no' }] },
      { ...good, agentCommands: [{ words: [4], paths: false }] },
      { ...good, purpose: 'bogus' },
    ]) {
      assert.equal(parseHookPolicy(bad).ok, false, JSON.stringify(bad).slice(0, 80));
    }
  });
});

describe('decideReadBeforeEdit (CON-7)', () => {
  it('denies an Edit with no recorded read, naming the corrective step', () => {
    const d = decideReadBeforeEdit({ tool: 'Edit', exists: true, recorded: undefined, current: 'a' });
    assert.equal(d?.decision, 'deny');
    assert.equal(d?.rule, 'edit-without-read');
    assert.match(d?.reason ?? '', /read the file again|Read the file/i);
  });

  it('has no objection when the recorded digest equals the current one', () => {
    assert.equal(decideReadBeforeEdit({ tool: 'Edit', exists: true, recorded: 'a', current: 'a' }), null);
  });

  it('denies a changed file with file-changed-since-read', () => {
    const d = decideReadBeforeEdit({ tool: 'Edit', exists: true, recorded: 'a', current: 'b' });
    assert.deepEqual([d?.decision, d?.rule], ['deny', 'file-changed-since-read']);
  });

  it('lets a Write of a new file through, and denies a Write of an existing file that was never read', () => {
    assert.equal(decideReadBeforeEdit({ tool: 'Write', exists: false, recorded: undefined, current: undefined }), null);
    assert.equal(decideReadBeforeEdit({ tool: 'Write', exists: true, recorded: undefined, current: 'a' })?.rule, 'edit-without-read');
    assert.equal(decideReadBeforeEdit({ tool: 'Write', exists: true, recorded: 'a', current: 'b' })?.rule, 'file-changed-since-read');
  });

  it('treats MultiEdit and NotebookEdit like Edit, and an Edit of a file deleted since the read as changed', () => {
    for (const tool of ['MultiEdit', 'NotebookEdit']) {
      assert.equal(decideReadBeforeEdit({ tool, exists: true, recorded: undefined, current: 'a' })?.rule, 'edit-without-read', tool);
    }
    assert.equal(decideReadBeforeEdit({ tool: 'Edit', exists: false, recorded: 'a', current: undefined })?.rule, 'file-changed-since-read');
    assert.equal(decideReadBeforeEdit({ tool: 'Edit', exists: false, recorded: undefined, current: undefined })?.rule, 'edit-without-read');
  });

  it('has no opinion on a tool that is not an edit', () => {
    assert.equal(decideReadBeforeEdit({ tool: 'Read', exists: true, recorded: undefined, current: 'a' }), null);
  });
});

describe('loopLimitOf (CON-14)', () => {
  const limits = { consecutiveDenials: 3, consecutiveSearches: 25 };

  it('stops at the third consecutive denial and not at the second (boundary edge)', () => {
    assert.equal(loopLimitOf({ consecutiveDenials: 2 }, limits), null);
    assert.deepEqual(loopLimitOf({ consecutiveDenials: 3 }, limits), { stop: true, reason: 'consecutive-denials', count: 3 });
  });

  it('never stops an invocation with zero denials (empty edge)', () => {
    assert.equal(loopLimitOf({ consecutiveDenials: 0 }, limits), null);
    assert.equal(loopLimitOf({}, limits), null);
  });

  it('denies the next search after 25 searches in a row and not after 24', () => {
    assert.equal(loopLimitOf({ consecutiveSearches: 24 }, limits), null);
    assert.deepEqual(loopLimitOf({ consecutiveSearches: 25 }, limits), { stop: true, reason: 'ineffective-search', count: 25 });
  });

  it('reads the counts as integers: a non-integer count is no count', () => {
    assert.equal(loopLimitOf({ consecutiveDenials: 2.9999999 }, limits), null);
    assert.equal(loopLimitOf({ consecutiveDenials: Number.NaN }, limits), null);
  });

  it('a limit of zero leaves that control off', () => {
    assert.equal(loopLimitOf({ consecutiveDenials: 50, consecutiveSearches: 50 }, { consecutiveDenials: 0, consecutiveSearches: 0 }), null);
  });
});

describe('parseHookPolicy for readBeforeEdit and loopLimits', () => {
  const base = (): HookPolicy => policy({ purpose: 'run', writeGlobs: ['src/**'], protectedGlobs: ['package.json'], readBeforeEdit: true, loopLimits: { consecutiveDenials: 3, consecutiveSearches: 25 } });

  it('accepts both fields and round-trips them', () => {
    const good = base();
    assert.deepEqual(parseHookPolicy(JSON.parse(JSON.stringify(good))), { ok: true, policy: JSON.parse(JSON.stringify(good)) });
  });

  it('refuses a malformed readBeforeEdit or loopLimits', () => {
    const good = base();
    for (const bad of [
      { ...good, readBeforeEdit: 'yes' },
      { ...good, loopLimits: 3 },
      { ...good, loopLimits: { consecutiveDenials: -1, consecutiveSearches: 25 } },
      { ...good, loopLimits: { consecutiveDenials: 3 } },
      { ...good, loopLimits: { consecutiveDenials: 3.5, consecutiveSearches: 25 } },
    ]) {
      assert.equal(parseHookPolicy(bad).ok, false, JSON.stringify(bad));
    }
  });

  it('leaves the decision of an onboarding policy unchanged: no read-before-edit field, no objection', () => {
    const p = policy();
    assert.equal(p.readBeforeEdit, undefined);
    assert.equal(parseHookPolicy(JSON.parse(JSON.stringify(p))).ok, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CR-01: an admitted git command prints tracked or staged content of a secret path (object names and output forms).
// ---------------------------------------------------------------------------------------------------------------

describe('git object reads and output forms (CR-01)', () => {
  const RUN_DENIED = DENIED_COMMAND_PREFIXES.filter((p) => p !== 'npm' && p !== 'npx');
  const runPolicy = (): HookPolicy =>
    policy(
      {
        purpose: 'run',
        writeRoots: ['/work/scratch'],
        writeGlobs: ['tests/unit/*.test.ts'],
        protectedGlobs: ['package.json', '.git/**'],
        agentCommands: [{ words: ['npm', 'test'], paths: false }],
        deniedTools: ['AskUserQuestion'],
        denyBackgroundShell: true,
        subagentTypes: ['gsd-executor'],
      },
      { gsdReadVerbs: [...GSD_READ_VERBS.run], deniedPrefixes: RUN_DENIED },
    );
  const verdict = (command: string, p: HookPolicy = policy(), cwd = STAGING): [string, string | undefined] => {
    const d = decide(shell(command, cwd), p);
    return [d.decision, d.rule];
  };

  it('repro: git show HEAD:.env and git show :.env are denied deny-secret-read under the map and the run policy, as cat .env is', () => {
    for (const p of [policy(), runPolicy()]) {
      for (const command of ['git show HEAD:.env', 'git show :.env', 'cat .env']) {
        assert.deepEqual(verdict(command, p), ['deny', 'deny-secret-read'], `${p.purpose}: ${command}`);
      }
    }
  });

  it('more object forms: a stage number, an ancestor, a nested path, a pem file and git rev-parse deny deny-secret-read', () => {
    for (const command of ['git show :0:.env', 'git show :2:.env', 'git show HEAD~1:.env', 'git show main:config/.env', 'git show HEAD:certs/server.pem', 'git rev-parse HEAD:.env']) {
      assert.deepEqual(verdict(command), ['deny', 'deny-secret-read'], command);
    }
  });

  it('allowed object paths: a tracked source file, the root tree, an example file and git rev-parse stay shell-identity', () => {
    for (const command of ['git show HEAD:src/a.ts', 'git show :src/a.ts', 'git show HEAD:', 'git show HEAD:.env.example', 'git show HEAD:.envrc', 'git rev-parse HEAD:src/a.ts']) {
      assert.deepEqual(verdict(command), ['allow', 'shell-identity'], command);
    }
  });

  it('adjacency: git show of an object path is decided like cat of the same path, for every stage spelling', () => {
    for (const path of ['.env', 'config/.env', 'certs/server.pem', '.env.example', '.envrc', 'src/a.ts']) {
      const expected = verdict(`cat ${path}`);
      for (const command of [`git show HEAD:${path}`, `git show :${path}`, `git show :0:${path}`]) {
        assert.deepEqual(verdict(command), expected, command);
      }
    }
    assert.deepEqual(verdict('git show HEAD:.env.example'), ['allow', 'shell-identity']);
    assert.deepEqual(verdict('git show HEAD:.envrc'), ['allow', 'shell-identity']);
  });

  it('encoding: a dot segment, a quoted operand, an empty quote pair and a subdirectory cwd do not hide the secret path', () => {
    for (const command of ['git show HEAD:./.env', 'git show HEAD:sub/../.env', 'git show "HEAD:.env"', 'git show HEAD:.e""nv']) {
      assert.deepEqual(verdict(command), ['deny', 'deny-secret-read'], command);
    }
    const sub = `${STAGING}/sub`;
    assert.deepEqual(verdict('git show HEAD:../.env', policy(), sub), ['deny', 'deny-secret-read']);
    assert.deepEqual(verdict('git show HEAD:.env', policy(), sub), ['deny', 'deny-secret-read']);
    assert.deepEqual(verdict('git show HEAD:../../../../home/u/repo/.env', policy(), sub), ['deny', 'outside-read-set']);
  });

  it('unresolvable colon words: a brace, a leading slash, bang or parenthesis, and an absolute path part deny shell-git-object', () => {
    for (const command of ['git show "HEAD@{0}:.env"', 'git show "HEAD@{10:00}:.env"', 'git show ":/fix"', 'git show ":!x"', 'git ls-files ":(exclude)src"', 'git show HEAD:/etc/passwd']) {
      assert.deepEqual(verdict(command), ['deny', 'shell-git-object'], command);
    }
  });
});
