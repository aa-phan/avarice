// Fail-closed launch preflight (ONB-12, CON-3, CS-13; success criterion 3): with the hook removed, the
// generated settings missing or the sandbox unavailable, no invocation starts. Each refusal is proved, and the
// complete case proves the check can pass. The fake `claude` is written into a temporary directory at run time.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeInvocationScope } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { ADMITTED_CLAUDE_VERSIONS, checkHostReady, checkLaunchReady } from '../../src/adapters/host-claude/launch-preflight.ts';
import { renderClaudeSettings } from '../../src/adapters/host-claude/settings.ts';

const HAS_SANDBOX_EXEC = existsSync('/usr/bin/sandbox-exec');
const PROBE_OK = ['/usr/bin/true'] as const;

let root = '';
let hookScript = '';
let settings: Record<string, any>;
let counter = 0;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-failclosed-')));
  hookScript = join(root, 'pre-tool-use.ts');
  writeFileSync(hookScript, '// hook entry\n');
  const staging = join(root, 'staging');
  mkdirSync(join(staging, 'src'), { recursive: true });
  const compiled = compileOnboardingContract({
    onboardingId: 'onb-1',
    runId: 'run-1',
    projectId: 'prj-1',
    pin: 'c'.repeat(40),
    preflight: {},
    request: {},
    nowIso: '2026-11-02T00:00:00.000Z',
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const scope = computeInvocationScope({
    purpose: 'map',
    contract: compiled.value,
    stagingPath: staging,
    repoPath: join(root, 'repo'),
    dataRoot: join(root, 'data'),
    home: join(root, 'home'),
    workRoot: root,
    workspace: { topLevelEntries: ['src', '.git'], planningEntries: [], gitPaths: [join(staging, '.git')], repoReadAllow: [] },
    readRoots: [],
  });
  settings = renderClaudeSettings(scope, {
    hook: { command: process.execPath, args: ['--disable-warning=ExperimentalWarning', hookScript] },
    policyFile: join(root, 'hook-policy.json'),
  }) as Record<string, any>;
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function fresh(name: string): string {
  const dir = join(root, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Writes the settings (optionally edited) and returns the file path.
function settingsFile(edit?: (copy: Record<string, any>) => void): string {
  const copy = JSON.parse(JSON.stringify(settings)) as Record<string, any>;
  edit?.(copy);
  const file = join(fresh('settings'), 'host-settings.json');
  writeFileSync(file, JSON.stringify(copy));
  return file;
}

// A fake `claude`: prints the version for --version and leaves a marker so a test can tell it ran.
function fakeClaude(version: string, body = ''): { bin: string; marker: string } {
  const dir = fresh('claude');
  const marker = join(dir, 'ran');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh\n${body}\nif [ "$1" = "--version" ]; then echo ran > "${marker}"; echo "${version} (Claude Code)"; exit 0; fi\nexit 9\n`);
  chmodSync(bin, 0o755);
  return { bin, marker };
}

function refusal(result: ReturnType<typeof checkLaunchReady>): string {
  assert.ok(!result.ok, 'expected a refusal');
  assert.ok(!result.ok && result.error.kind === 'denied', JSON.stringify(result));
  if (result.ok || result.error.kind !== 'denied') return '';
  assert.equal(result.error.enforcer, 'avarice');
  assert.ok(result.error.rule.startsWith('enforcement_failure:'), result.error.rule);
  return result.error.rule;
}

describe('launch preflight passes only with every layer present', () => {
  it('admits the four tested host versions', () => {
    assert.deepEqual([...ADMITTED_CLAUDE_VERSIONS], ['2.1.312', '2.1.316', '2.1.317', '2.1.318']);
  });

  it('passes with complete settings, a readable hook script, a working probe and an admitted version', () => {
    const claude = fakeClaude('2.1.316');
    const result = checkLaunchReady({ settingsFile: settingsFile(), claudeBin: claude.bin, sandboxProbe: PROBE_OK });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.value.claudeVersion, '2.1.316');
  });

  it('passes with the other admitted version', () => {
    const claude = fakeClaude('2.1.312');
    assert.ok(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: claude.bin, sandboxProbe: PROBE_OK }).ok);
  });

  it('passes with the default sandbox-exec probe on a machine that has it', { skip: !HAS_SANDBOX_EXEC }, () => {
    const claude = fakeClaude('2.1.316');
    const result = checkLaunchReady({ settingsFile: settingsFile(), claudeBin: claude.bin });
    assert.ok(result.ok, JSON.stringify(result));
  });
});

describe('launch preflight refuses (no launch)', () => {
  const claude = (): { bin: string; marker: string } => fakeClaude('2.1.316');

  it('when the settings file is absent', () => {
    const c = claude();
    const rule = refusal(checkLaunchReady({ settingsFile: join(root, 'no-such', 'host-settings.json'), claudeBin: c.bin, sandboxProbe: PROBE_OK }));
    assert.equal(rule, 'enforcement_failure:settings-missing');
    assert.ok(!existsSync(c.marker), 'the host binary must not be run when settings are missing');
  });

  it('when the settings file is not JSON', () => {
    const file = join(fresh('bad'), 'host-settings.json');
    writeFileSync(file, '{ not json');
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:settings-invalid');
  });

  it('when sandbox.failIfUnavailable is missing or not true', () => {
    const missing = settingsFile((s) => delete s.sandbox.failIfUnavailable);
    assert.equal(refusal(checkLaunchReady({ settingsFile: missing, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:settings-key:sandbox.failIfUnavailable');
    const off = settingsFile((s) => (s.sandbox.failIfUnavailable = false));
    assert.equal(refusal(checkLaunchReady({ settingsFile: off, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:settings-key:sandbox.failIfUnavailable');
  });

  it('when defaultMode is anything but dontAsk', () => {
    for (const mode of ['acceptEdits', 'bypassPermissions', 'auto', 'default']) {
      const file = settingsFile((s) => (s.permissions.defaultMode = mode));
      assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:settings-key:permissions.defaultMode', mode);
    }
  });

  it('when the sandbox may run commands unsandboxed, is disabled, or the bypass mode is not disabled', () => {
    const cases: Array<[(s: Record<string, any>) => void, string]> = [
      [(s) => (s.sandbox.allowUnsandboxedCommands = true), 'sandbox.allowUnsandboxedCommands'],
      [(s) => (s.sandbox.enabled = false), 'sandbox.enabled'],
      [(s) => delete s.permissions.disableBypassPermissionsMode, 'permissions.disableBypassPermissionsMode'],
      [(s) => (s.sandbox.autoAllowBashIfSandboxed = true), 'sandbox.autoAllowBashIfSandboxed'],
    ];
    for (const [edit, key] of cases) {
      assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(edit), claudeBin: claude().bin, sandboxProbe: PROBE_OK })), `enforcement_failure:settings-key:${key}`);
    }
  });

  it('when any network domain is listed for the onboarding sandbox', () => {
    const file = settingsFile((s) => (s.sandbox.network.allowedDomains = ['registry.npmjs.org']));
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:settings-key:sandbox.network.allowedDomains');
  });

  it('when the PreToolUse hook has been removed (success criterion 3)', () => {
    for (const edit of [(s: Record<string, any>) => delete s.hooks, (s: Record<string, any>) => (s.hooks.PreToolUse = []), (s: Record<string, any>) => delete s.hooks.PreToolUse]) {
      assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(edit), claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:hook-missing');
    }
  });

  it('when the PreToolUse hook would fail open (no onFailure block)', () => {
    const file = settingsFile((s) => delete s.hooks.PreToolUse[0].hooks[0].onFailure);
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:hook-not-blocking');
  });

  it('when the ConfigChange hook would fail open (no onFailure block)', () => {
    const file = settingsFile((s) => delete s.hooks.ConfigChange[0].hooks[0].onFailure);
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:hook-not-blocking');
  });

  // MF-02 (01-MUTATION.md, fixed in 01-20): docs/containment.md ("Generated host settings") shows `strictAllowlist: true`, so a settings
  // file without it is not the generated one. Absent, false and a non-boolean value each refuse.
  it('when the sandbox network allowlist is not strict', () => {
    for (const edit of [
      (s: Record<string, any>) => (s.sandbox.network.strictAllowlist = false),
      (s: Record<string, any>) => delete s.sandbox.network.strictAllowlist,
      (s: Record<string, any>) => (s.sandbox.network.strictAllowlist = 'true'),
    ]) {
      const file = settingsFile(edit);
      assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:settings-key:sandbox.network.strictAllowlist');
    }
  });

  it('when the ConfigChange hook is missing', () => {
    const file = settingsFile((s) => delete s.hooks.ConfigChange);
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:config-hook-missing');
  });

  // O-1 (fixed in 01-20): the hook counts in-flight subagents from the completions it hears, so a settings file that does not
  // register the post hook for both a completed and a failed tool call would leave the concurrency limit stuck or off.
  it('when the PostToolUse hook is missing', () => {
    for (const edit of [(s: Record<string, any>) => delete s.hooks.PostToolUse, (s: Record<string, any>) => (s.hooks.PostToolUse = []), (s: Record<string, any>) => (s.hooks.PostToolUse[0].hooks[0].args[s.hooks.PostToolUse[0].hooks[0].args.indexOf('post')] = 'pre')]) {
      assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(edit), claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:post-hook-missing');
    }
  });

  it('when the PostToolUseFailure hook is missing', () => {
    for (const edit of [(s: Record<string, any>) => delete s.hooks.PostToolUseFailure, (s: Record<string, any>) => (s.hooks.PostToolUseFailure = [])]) {
      assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(edit), claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:post-failure-hook-missing');
    }
  });

  it('when the script of a post hook is not readable', () => {
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      const file = settingsFile((s) => (s.hooks[event][0].hooks[0].args[1] = join(root, 'no-such-hook.ts')));
      assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:hook-script-unreadable', event);
    }
  });

  it('when the hook script path is not readable', () => {
    const file = settingsFile((s) => (s.hooks.PreToolUse[0].hooks[0].args[1] = join(root, 'no-such-hook.ts')));
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:hook-script-unreadable');
  });

  it('when the sandbox probe exits non-zero', () => {
    const c = claude();
    const rule = refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: c.bin, sandboxProbe: ['/usr/bin/false'] }));
    assert.equal(rule, 'enforcement_failure:sandbox-unavailable');
    assert.ok(!existsSync(c.marker), 'the host binary must not be run when the sandbox is unavailable');
  });

  it('when the sandbox probe cannot be started', () => {
    const rule = refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: claude().bin, sandboxProbe: [join(root, 'no-such-probe')] }));
    assert.equal(rule, 'enforcement_failure:sandbox-unavailable');
  });

  it('when claude --version reports a version that is not admitted (2.1.400)', () => {
    const c = fakeClaude('2.1.400');
    const rule = refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: c.bin, sandboxProbe: PROBE_OK }));
    assert.equal(rule, 'enforcement_failure:host-version-not-admitted:2.1.400');
  });

  it('when claude --version prints something that is not a version', () => {
    const bin = join(fresh('claude'), 'claude');
    writeFileSync(bin, '#!/bin/sh\necho "hello"\n');
    chmodSync(bin, 0o755);
    assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:host-version-unreadable');
  });

  it('when the claude binary does not exist or is not executable', () => {
    assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: join(root, 'no-such-claude'), sandboxProbe: PROBE_OK })), 'enforcement_failure:host-unavailable');
  });

  it('when claude --version prints an admitted version but exits non-zero', () => {
    const bin = join(fresh('claude'), 'claude');
    writeFileSync(bin, '#!/bin/sh\necho "2.1.316 (Claude Code)"\nexit 3\n');
    chmodSync(bin, 0o755);
    assert.equal(refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: bin, sandboxProbe: PROBE_OK })), 'enforcement_failure:host-unavailable');
  });

  it('when claude --version hangs past the timeout', () => {
    const bin = join(fresh('claude'), 'claude');
    writeFileSync(bin, '#!/bin/sh\nsleep 20\n');
    chmodSync(bin, 0o755);
    const started = Date.now();
    const rule = refusal(checkLaunchReady({ settingsFile: settingsFile(), claudeBin: bin, sandboxProbe: PROBE_OK, timeoutMs: 400 }));
    assert.equal(rule, 'enforcement_failure:host-unavailable');
    assert.ok(Date.now() - started < 10_000);
  });

  it('refuses on the first failing layer and names only that one', () => {
    const file = settingsFile((s) => {
      delete s.hooks;
      s.sandbox.failIfUnavailable = false;
    });
    // Settings keys are judged before the hook, so the sandbox key is the reported reason.
    assert.equal(refusal(checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: ['/usr/bin/false'] })), 'enforcement_failure:settings-key:sandbox.failIfUnavailable');
  });

  it('never rewrites the settings file it checks', () => {
    const file = settingsFile();
    const before = readFileSync(file, 'utf8');
    checkLaunchReady({ settingsFile: file, claudeBin: claude().bin, sandboxProbe: ['/usr/bin/false'] });
    assert.equal(readFileSync(file, 'utf8'), before);
  });
});

describe('the startup readiness check behind the host descriptor (checkHostReady)', () => {
  it('refuses when the hook entry script cannot be read, before it looks at the sandbox or the host', () => {
    const c = fakeClaude('2.1.316');
    const result = checkHostReady({ claudeBin: c.bin, hookEntry: join(root, 'no-such-hook.ts'), sandboxProbe: PROBE_OK });
    assert.ok(!result.ok && result.error.kind === 'denied');
    assert.equal(!result.ok && result.error.kind === 'denied' ? result.error.rule : '', 'enforcement_failure:hook-script-unreadable');
    assert.ok(!existsSync(c.marker), 'the host binary must not be run when the hook entry is unreadable');
  });

  it('passes with a readable hook entry, a working sandbox probe and an admitted version', () => {
    const result = checkHostReady({ claudeBin: fakeClaude('2.1.312').bin, hookEntry: hookScript, sandboxProbe: PROBE_OK });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.value.claudeVersion, '2.1.312');
  });
});
