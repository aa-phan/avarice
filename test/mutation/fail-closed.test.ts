// Discriminating tests added by the 01-20 mutation campaign (adversarial-mutation-test): each case fails when one
// fail-closed line named in 01-MUTATION.md is broken. The expected values come from docs/containment.md (File-edit
// safeguards, Fail-closed behavior, Budgets) and docs/repository-onboarding.md, not from reading the code.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { checkLaunchReady } from '../../src/adapters/host-claude/launch-preflight.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { assertLaunchArgsSafe, buildLaunchArgs } from '../../src/adapters/host-claude/launch-args.ts';
import { canonicalAbsolute } from '../../src/adapters/fs/canonical-path.ts';
import { decideToolCall, normalizeToolCall } from '../../src/domain/hook-decision.ts';
import type { NormalizedToolCall } from '../../src/domain/hook-decision.ts';
import { PREAMBLE, budgetUsed, makeHookFixture, runHook, withDb } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
function fixture(options: Parameters<typeof makeHookFixture>[0] = {}): HookFixture {
  const fx = makeHookFixture(options);
  fixtures.push(fx);
  return fx;
}
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

function setBudget(fx: HookFixture, name: string, used: number, reserved: number): void {
  const db = new DatabaseSync(fx.ledgerPath);
  try {
    db.prepare('UPDATE budgets SET used = ?, reserved = ? WHERE run_id = ? AND name = ?').run(used, reserved, 'run_1', name);
  } finally {
    db.close();
  }
}

// True on a volume that treats names that differ only in case as the same file (the macOS default).
function caseInsensitive(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-case-'));
  try {
    writeFileSync(join(dir, 'a'), '');
    return existsSync(join(dir, 'A'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const shell = (fx: HookFixture, command: string): NormalizedToolCall => ({ kind: 'shell', command, background: false, cwd: fx.staging });

describe('FC-2: a path outside the write set is denied after canonicalization', () => {
  it('applies .. components that follow a name that does not exist yet', () => {
    const fx = fixture();
    // new/.. cancels out, so the target is <staging>/.planning/escape.md, which is outside the write root.
    const sneaky = `${fx.writeRoot}/not-yet/../../escape.md`;
    assert.equal(canonicalAbsolute(sneaky), `${fx.staging}/.planning/escape.md`);
    const decision = decideToolCall({ kind: 'file-write', tool: 'Write', paths: [sneaky] }, fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'outside-write-set']);
    // and through the process the host starts
    const result = runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: sneaky, content: 'x' } });
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });

  it('treats a symlink loop as undecidable and denies the write', () => {
    const fx = fixture();
    symlinkSync(join(fx.writeRoot, 'b'), join(fx.writeRoot, 'a'));
    symlinkSync(join(fx.writeRoot, 'a'), join(fx.writeRoot, 'b'));
    assert.equal(canonicalAbsolute(join(fx.writeRoot, 'a', 'x.md')), null);
    const decision = decideToolCall({ kind: 'file-write', tool: 'Write', paths: [join(fx.writeRoot, 'a', 'x.md')] }, fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'unresolvable-path']);
  });
});

describe('FC-2 adversarial: path forms that differ from the policy path only in spelling', () => {
  it('resolves .. after a symlink against the symlink target, as the kernel does', () => {
    const fx = fixture();
    symlinkSync(join(fx.staging, 'src'), join(fx.writeRoot, 'link'));
    // link -> <staging>/src, so link/.. is <staging>, not the write root: <staging>/x.md is outside the write set.
    const viaLink = `${fx.writeRoot}/link/../x.md`;
    assert.equal(canonicalAbsolute(viaLink), `${fx.staging}/x.md`);
    const decision = decideToolCall({ kind: 'file-write', tool: 'Write', paths: [viaLink] }, fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'outside-write-set']);
  });

  it('treats a differently-cased spelling of an existing directory as that directory (case-insensitive volume)', () => {
    // On a case-sensitive volume a differently-cased name is a different name, so there is nothing to check.
    if (!caseInsensitive()) return;
    const fx = fixture();
    const upperRoot = fx.writeRoot.replace('/.planning/codebase', '/.PLANNING/CODEBASE');
    assert.equal(canonicalAbsolute(`${upperRoot}/NEW.md`), `${fx.writeRoot}/NEW.md`);
    const inside = decideToolCall({ kind: 'file-write', tool: 'Write', paths: [`${upperRoot}/NEW.md`] }, fx.policy, canonicalAbsolute);
    assert.equal(inside.decision, 'allow');
    const upperSrc = join(fx.staging, 'SRC', 'a.ts');
    const outside = decideToolCall({ kind: 'file-write', tool: 'Write', paths: [upperSrc] }, fx.policy, canonicalAbsolute);
    assert.deepEqual([outside.decision, outside.rule], ['deny', 'outside-write-set']);
  });
});

describe('FC-3: reads of the checkout, the data root and secrets are denied', () => {
  it('denies a read whose path cannot be resolved', () => {
    const fx = fixture();
    const loop = join(fx.staging, 'src', 'loop');
    symlinkSync(join(fx.staging, 'src', 'loop2'), loop);
    symlinkSync(loop, join(fx.staging, 'src', 'loop2'));
    const decision = decideToolCall({ kind: 'file-read', tool: 'Read', paths: [join(loop, 'x')] }, fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'unresolvable-path']);
    const shellRead = decideToolCall(shell(fx, `cat ${join(loop, 'x')}`), fx.policy, canonicalAbsolute);
    assert.deepEqual([shellRead.decision, shellRead.rule], ['deny', 'unresolvable-path']);
  });

  it('checks the literal root of an absolute Glob pattern, not only its path argument', () => {
    const fx = fixture();
    const normalized = normalizeToolCall('Glob', { pattern: `${fx.repo}/**/*.ts` }, fx.staging);
    assert.ok(normalized.ok);
    const decision = decideToolCall(normalized.call, fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'deny-read']);
    const own = normalizeToolCall('Glob', { pattern: `${fx.staging}/src/**/*.ts` }, fx.staging);
    assert.ok(own.ok);
    assert.equal(decideToolCall(own.call, fx.policy, canonicalAbsolute).decision, 'allow');
  });
});

describe('command identity: only a read-only command with no shell control character runs', () => {
  it('refuses a command separated by ; (the second command would run unchecked)', () => {
    const fx = fixture();
    for (const command of ['cat a ; rm -rf src', 'ls;rm -rf src', 'cat a;rm b', 'ls ;']) {
      const decision = decideToolCall(shell(fx, command), fx.policy, canonicalAbsolute);
      assert.deepEqual([decision.decision, decision.rule], ['deny', 'shell-syntax'], command);
    }
  });

  it('refuses git --textconv, which runs a configured program, with and without =', () => {
    const fx = fixture();
    for (const command of ['git show --textconv HEAD:a', 'git show --textconv=x HEAD:a', 'git log --ext-diff', 'git log --output=out.txt']) {
      const decision = decideToolCall(shell(fx, command), fx.policy, canonicalAbsolute);
      assert.deepEqual([decision.decision, decision.rule], ['deny', 'shell-git-option'], command);
    }
  });
});

describe('FC-4: a reservation is honored by the hook charge', () => {
  it('denies a call when what is used plus what is reserved already fills the limit', () => {
    const fx = fixture({ limits: { toolCalls: 5 } });
    setBudget(fx, 'toolCalls', 2, 3);
    const result = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } });
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, 'avarice: budget_exhausted');
    assert.equal(budgetUsed(fx, 'toolCalls'), 2);
  });

  it('allows the one call that still fits next to a reservation', () => {
    const fx = fixture({ limits: { toolCalls: 5 } });
    setBudget(fx, 'toolCalls', 2, 2);
    const result = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(budgetUsed(fx, 'toolCalls'), 3);
  });
});

describe('FC-1: every hook verdict is recorded with its level', () => {
  it('writes an allow at info and a deny at warn, both in the ledger the hook charged', () => {
    const fx = fixture();
    runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } });
    runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.staging, 'src', 'a.ts'), content: 'x' } });
    const levels = withDb(fx.ledgerPath, (db) =>
      (db.prepare("SELECT level, json_extract(data_json, '$.decision') AS decision FROM events WHERE type = 'hook.decision' ORDER BY seq").all() as Array<{ level: string; decision: string }>).map((r) => [r.decision, r.level]),
    );
    assert.deepEqual(levels, [
      ['allow', 'info'],
      ['deny', 'warn'],
    ]);
  });
});

describe('command identity: deny beats allow, and the GSD preamble ends at a line boundary', () => {
  it('refuses a denied prefix even when a broad read-only entry would otherwise admit the command', () => {
    const fx = fixture({ commands: { readOnly: ['git', 'ls'], deniedPrefixes: ['git push', 'git config'] } });
    for (const command of ['git push origin main', 'git config core.pager x']) {
      const decision = decideToolCall(shell(fx, command), fx.policy, canonicalAbsolute);
      assert.deepEqual([decision.decision, decision.rule], ['deny', 'shell-denied-prefix'], command);
    }
    assert.equal(decideToolCall(shell(fx, 'git status'), fx.policy, canonicalAbsolute).decision, 'allow');
  });

  it('refuses text that follows the preamble on the same line, because the shell would run it as arguments of `true`', () => {
    const fx = fixture();
    const decision = decideToolCall(shell(fx, `${PREAMBLE} gsd_run state json`), fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'shell-preamble-trailing']);
    const onNextLine = decideToolCall(shell(fx, `${PREAMBLE}\ngsd_run state json`), fx.policy, canonicalAbsolute);
    assert.equal(onNextLine.decision, 'allow');
  });
});

// MF-04 (01-MUTATION.md, fixed in 01-20): the shell read check compares each word as a literal path, so an unquoted glob or brace
// expansion would name a path the check never sees. Any read-command word with an unquoted `*`, `?`, `[` or `{` is refused with rule
// shell-syntax (fail closed). Quoted text is literal to the shell and keeps its treatment (`find . -name '*.ts'`).
describe('MF-04: shell expansion characters and the hook read check', () => {
  const denied = (fx: HookFixture, command: string): string =>
    ((d) => `${d.decision}:${d.rule}`)(decideToolCall(shell(fx, command), fx.policy, canonicalAbsolute));

  it('denies a shell read that names a denied directory through an unquoted brace or glob expansion', () => {
    const fx = fixture();
    // <dir>/repo is a denied root; each spelling below expands to a file under it.
    for (const command of [`cat ${fx.dir}/re{po,xx}/x`, `cat ${fx.dir}/re*/x`, `cat ${fx.dir}/rep?/x`, `cat ${fx.dir}/rep[o]/x`]) {
      assert.equal(denied(fx, command), 'deny:shell-syntax', command);
    }
  });

  it('refuses each of the four characters in any read command, in any position and in any segment of a pipeline', () => {
    const fx = fixture();
    for (const command of ['ls *', 'ls src/?.ts', 'cat src/[ab].ts', 'cat {a,b}', 'head -n 3 src/*.ts', 'grep -rn foo --include=*.ts src', 'git log -- *.ts', 'cat src/a.ts | grep x*', 'wc -l src/a*', 'ls "src"/*']) {
      assert.equal(denied(fx, command), 'deny:shell-syntax', command);
    }
  });

  it('keeps the quoted forms: the shell does not expand inside quotes', () => {
    const fx = fixture();
    for (const command of ["find . -name '*.ts' -print", 'find . -name "*.ts" -print', 'grep -rn "a[b]c" src', "grep -rn 'x{1,2}' src", 'grep -rn "who?" src', "ls 'my dir'"]) {
      assert.equal(denied(fx, command), 'allow:shell-identity', command);
    }
  });

  it('keeps the hook allowing the GSD preamble and the gsd_run read verbs it admits today', () => {
    const fx = fixture();
    for (const line of ['gsd_run graphify status', 'gsd_run query init.map-codebase --raw', 'gsd_run intel status | head -5', 'INIT=$(gsd_run query init.map-codebase)']) {
      assert.equal(denied(fx, `${PREAMBLE}\n${line}`), 'allow:shell-identity', line);
    }
    assert.equal(denied(fx, PREAMBLE), 'allow:shell-identity');
  });
});

describe('FC-7: the launch refusals hold for the --flag=value spelling', () => {
  const base = (): string[] =>
    buildLaunchArgs({ prompt: 'map it', settingsFile: '/s.json', pluginDir: '/p', agentsFile: '/a.json', mcpFile: '/m.json', model: 'haiku', costCapUsd: 1, sessionId: '5b3a9d1c-0f2e-4c6a-8d7b-1e2f3a4b5c6d' });

  it('accepts the generated argv', () => {
    assert.ok(assertLaunchArgsSafe(base()).ok);
  });

  it('refuses --bare, --add-dir, --allowedTools and --permission-prompt-tool written with =', () => {
    for (const flag of ['--bare=1', '--add-dir=/home/u', '--allowedTools=Bash', '--allowed-tools=Bash', '--permission-prompt-tool=mcp__x__y', '--dangerously-skip-permissions=true']) {
      const refused = assertLaunchArgsSafe([...base(), flag]);
      assert.ok(!refused.ok, flag);
      assert.equal(refused.error.kind, 'denied');
    }
  });

  it('refuses a permission mode other than dontAsk, in either spelling', () => {
    const argv = base();
    argv[argv.indexOf('--permission-mode') + 1] = 'bypassPermissions';
    assert.ok(!assertLaunchArgsSafe(argv).ok);
    const equalsForm = base().flatMap((t, i, all) => (t === '--permission-mode' ? [`--permission-mode=bypassPermissions`] : all[i - 1] === '--permission-mode' ? [] : [t]));
    assert.ok(!assertLaunchArgsSafe(equalsForm).ok);
  });
});

describe('FC-10: a sandbox that cannot run the command reports unavailable', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  function stubLauncher(body: string): { launcher: string; cwd: string } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-sbx-')));
    dirs.push(dir);
    const launcher = join(dir, 'sandbox-exec');
    writeFileSync(launcher, `#!/bin/sh\n${body}\n`);
    chmodSync(launcher, 0o755);
    const cwd = join(dir, 'work');
    mkdirSync(cwd);
    return { launcher, cwd };
  }
  const spec = (cwd: string, over: Partial<Parameters<SandboxedExecutor['run']>[0]> = {}): Parameters<SandboxedExecutor['run']>[0] => ({
    argv: ['/usr/bin/true'],
    cwd,
    env: { PATH: '/usr/bin:/bin' },
    timeoutMs: 10_000,
    invocationId: 'inv_1',
    writePaths: [],
    denyReadPaths: [],
    ...over,
  });

  it('returns unavailable when sandbox-exec itself fails to apply the profile (exit 71)', async () => {
    // The probe (a run of /usr/bin/true) succeeds; the real command's profile cannot be applied.
    const { launcher, cwd } = stubLauncher('case "$*" in *\'(version 1)(allow default)\'*) exit 0 ;; esac\necho "sandbox-exec: sandbox_apply: Operation not permitted" >&2\nexit 71');
    const executor = new SandboxedExecutor({ sandboxExecPath: launcher });
    const result = await executor.run(spec(cwd));
    assert.ok(!result.ok, 'a command the sandbox refused must not report a result');
    assert.equal(result.error.kind, 'unavailable');
  });

  it('refuses a relative working directory instead of resolving it against the process directory', async () => {
    const { launcher } = stubLauncher('exit 0');
    const result = await new SandboxedExecutor({ sandboxExecPath: launcher }).run(spec('.'));
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'invalid');
    assert.equal(result.error.kind === 'invalid' ? result.error.field : '', 'cwd');
    assert.ok(existsSync('.'));
  });
});

describe('FC-1 and FC-2: remaining refusal paths of the hook and the canonicalizer', () => {
  it('refuses hook input larger than 1 MiB', () => {
    const fx = fixture();
    const big = JSON.stringify({ cwd: fx.staging, tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts'), pad: 'x'.repeat(1024 * 1024 + 1024) } });
    const result = runHook(fx, 'pre', big);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /larger than 1 MiB/);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });

  it('says why it refused an input that is not a JSON object (an array, null, a number)', () => {
    const fx = fixture();
    for (const input of ['[]', 'null', '5']) {
      const result = runHook(fx, 'pre', input);
      assert.equal(result.code, 2, input);
      assert.match(result.stderr, /not a JSON object/, input);
    }
  });

  it('treats a chain of more than 40 dangling symlinks as undecidable, and a short chain as the target it leads to', () => {
    const fx = fixture();
    const link = (n: number): string => join(fx.writeRoot, `l${n}`);
    for (let i = 0; i < 45; i += 1) symlinkSync(i === 44 ? join(fx.writeRoot, 'nowhere') : link(i + 1), link(i));
    assert.equal(canonicalAbsolute(link(0)), null);
    assert.equal(canonicalAbsolute(link(40)), join(fx.writeRoot, 'nowhere'));
  });

  it('refuses a shell command longer than 16384 characters', () => {
    const fx = fixture();
    const decision = decideToolCall(shell(fx, `ls ${'a'.repeat(16_400)}`), fx.policy, canonicalAbsolute);
    assert.deepEqual([decision.decision, decision.rule], ['deny', 'shell-syntax']);
    assert.equal(decideToolCall(shell(fx, `ls ${'a'.repeat(100)}`), fx.policy, canonicalAbsolute).decision, 'allow');
  });

  it('refuses an unterminated quote, single or double', () => {
    const fx = fixture();
    for (const command of ["cat 'unterminated", 'cat "unterminated']) {
      const decision = decideToolCall(shell(fx, command), fx.policy, canonicalAbsolute);
      assert.deepEqual([decision.decision, decision.rule], ['deny', 'shell-syntax'], command);
    }
  });

  it('charges a tool call for an allowed shell command', () => {
    const fx = fixture();
    assert.equal(runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command: 'ls' } }).code, 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
  });
});

describe('FC-8: the settings file itself', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const probe = ['/usr/bin/true'] as const;

  it('names a missing file, an unreadable file and a file that is not an object differently, and launches none', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-settings-')));
    dirs.push(dir);
    const rule = (file: string): string => {
      const result = checkLaunchReady({ settingsFile: file, claudeBin: '/nonexistent/claude', sandboxProbe: probe });
      assert.ok(!result.ok && result.error.kind === 'denied');
      return result.ok || result.error.kind !== 'denied' ? '' : result.error.rule;
    };
    assert.equal(rule(join(dir, 'absent.json')), 'enforcement_failure:settings-missing');
    assert.equal(rule(dir), 'enforcement_failure:settings-invalid');
    for (const [name, text] of [['array.json', '[]'], ['null.json', 'null'], ['string.json', '"x"'], ['broken.json', '{']] as const) {
      writeFileSync(join(dir, name), text);
      assert.equal(rule(join(dir, name)), 'enforcement_failure:settings-invalid', name);
    }
  });
});

describe('FC-10 and cancellation: the executor', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const base = (cwd: string): Parameters<SandboxedExecutor['run']>[0] => ({ argv: ['/bin/sh', '-c', 'echo ran > ran.txt'], cwd, env: { PATH: '/usr/bin:/bin' }, timeoutMs: 10_000, invocationId: 'inv_1', writePaths: [cwd], denyReadPaths: [] });
  const work = (): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-exec-')));
    dirs.push(dir);
    return dir;
  };

  it('refuses a zero timeout', async () => {
    const result = await new SandboxedExecutor().run({ ...base(work()), timeoutMs: 0 });
    assert.ok(!result.ok);
    assert.equal(result.error.kind === 'invalid' ? result.error.field : result.error.kind, 'timeoutMs');
  });

  it('starts nothing when the signal is already aborted', async () => {
    const cwd = work();
    const result = await new SandboxedExecutor().run(base(cwd), AbortSignal.abort());
    assert.ok(result.ok);
    assert.equal(result.value.status, 'cancelled');
    assert.equal(existsSync(join(cwd, 'ran.txt')), false);
  });

  it('ends the whole process group when the command settles, so a background child does not outlive it', async () => {
    const result = await new SandboxedExecutor().run({ ...base(work()), argv: ['/bin/sh', '-c', 'sleep 60 & echo $!'] });
    assert.ok(result.ok);
    const pid = Number(result.value.stdout.trim());
    assert.ok(Number.isInteger(pid) && pid > 1);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, 'the background child was killed with its group');
  });
});
