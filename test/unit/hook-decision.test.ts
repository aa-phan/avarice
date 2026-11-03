// decideToolCall: the pure decision behind AVARICE's PreToolUse hook (CON-2, CON-3, ONB-3, ONB-4). Every path
// goes through an injected canon(), so symlink and `..` escapes are exercised without a filesystem.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex } from '../../src/domain/digest.ts';
import { decideToolCall, normalizeToolCall, parseHookPolicy } from '../../src/domain/hook-decision.ts';
import type { HookPolicy, NormalizedToolCall } from '../../src/domain/hook-decision.ts';
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
    assert.equal(decide(shell('grep -rn "a|b" src')).decision, 'allow');
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
