// renderClaudeSettings: the generated host settings of every contained invocation (CON-2, CON-3, CON-5, CON-6).
// The expected objects below are the committed snapshots; they are built from the real paths of a temporary
// tree because every rule path is resolved with realpath (macOS /tmp and /var are symlinks).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeInvocationScope } from '../../src/domain/invocation-scope.ts';
import type { BashStrategy, InvocationPurpose, InvocationScope } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import type { OnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { avariceHookCommand, gsdSecretReadGuardHook, renderClaudeSettings } from '../../src/adapters/host-claude/settings.ts';

const HOOK = { command: '/opt/node/bin/node', args: ['--disable-warning=ExperimentalWarning', '/avarice/src/hook/pre-tool-use.ts'] };
const POLICY = '/inv/hook-policy.json';

let root = '';
let staging = '';
let repo = '';
let data = '';
let home = '';
let core = '';
let agents = '';
let skill = '';
let contract: OnboardingContract;

// A `//` prefixed absolute path, the form rules and sandbox lists use.
const slash = (abs: string): string => `/${abs}`;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-settings-')));
  staging = join(root, 'work', 'onb-1', 'staging');
  repo = join(root, 'repo');
  data = join(root, 'data');
  home = join(root, 'home');
  core = join(root, 'gsd', 'core');
  agents = join(root, 'gsd', 'agents');
  skill = join(root, 'skills', 'graphify');
  for (const dir of [join(staging, 'src'), join(staging, 'docs'), join(staging, '.planning', 'phases'), join(staging, '.git'), repo, data, home, core, agents, skill]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(staging, 'package.json'), '{}');
  writeFileSync(join(staging, '.planning', 'PROJECT.md'), '# p');
  writeFileSync(join(staging, '.planning', 'config.json'), '{}');
  const compiled = compileOnboardingContract({
    onboardingId: 'onb-1',
    runId: 'run-1',
    projectId: 'prj-1',
    pin: 'b'.repeat(40),
    preflight: {},
    request: {},
    nowIso: '2026-11-02T00:00:00.000Z',
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  contract = compiled.value;
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function scope(purpose: InvocationPurpose, over: { strategy?: BashStrategy; stagingPath?: string } = {}): InvocationScope {
  const stagingPath = over.stagingPath ?? staging;
  return computeInvocationScope({
    purpose,
    contract,
    stagingPath,
    repoPath: repo,
    dataRoot: data,
    home,
    workspace: {
      topLevelEntries: ['.git', '.planning', 'docs', 'package.json', 'src'],
      planningEntries: ['PROJECT.md', 'config.json', 'phases'],
      gitPaths: [join(staging, '.git')],
      repoReadAllow: [],
    },
    readRoots: [core, agents],
    ...(over.strategy !== undefined ? { strategy: over.strategy } : {}),
  });
}

function render(s: InvocationScope, skillsAllowed: readonly string[] = [], gsdHooks: Parameters<typeof renderClaudeSettings>[1]['gsdHooks'] = []) {
  return renderClaudeSettings(s, { hook: HOOK, policyFile: POLICY, skillsAllowed, gsdHooks });
}

const hookEntry = (event: string, extra: Record<string, unknown>) => ({
  type: 'command',
  command: HOOK.command,
  args: [...HOOK.args, '--event', event, '--policy', POLICY],
  timeout: 5,
  ...extra,
});

function deniedBashRules(): string[] {
  return ['git push', 'git commit', 'git -c', 'git config', 'gh', 'claude', 'avarice', 'npm', 'npx', 'pnpm', 'yarn', 'curl', 'wget', 'pip', 'uv pip', 'make'].map((p) => `Bash(${p}:*)`);
}

function expectedSettings(over: {
  writeRoot: string;
  denyWrite: string[];
  allowExtra: string[];
  allowTail?: string[];
}) {
  return {
    permissions: {
      defaultMode: 'dontAsk',
      disableBypassPermissionsMode: 'disable',
      allow: [
        `Read(${slash(staging)}/**)`,
        `Read(${slash(core)}/**)`,
        `Read(${slash(agents)}/**)`,
        'Glob',
        'Grep',
        ...over.allowExtra,
        `Edit(${slash(over.writeRoot)}/**)`,
        'Bash',
      ],
      deny: [
        `Read(${slash(repo)}/**)`,
        `Read(${slash(data)}/**)`,
        `Edit(${slash(data)}/**)`,
        `Read(${slash(home)}/.ssh/**)`,
        `Read(${slash(home)}/.aws/**)`,
        `Read(${slash(home)}/.config/gh/**)`,
        `Read(${slash(staging)}/**/*.key)`,
        `Read(${slash(staging)}/**/*.pem)`,
        `Read(${slash(staging)}/**/.env)`,
        `Read(${slash(staging)}/**/.env.*)`,
        `Read(${slash(staging)}/**/id_ed25519*)`,
        `Read(${slash(staging)}/**/id_rsa*)`,
        'WebFetch',
        'WebSearch',
        'NotebookEdit',
        `Edit(${slash(staging)}/.planning/config.json)`,
        ...deniedBashRules(),
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      excludedCommands: [],
      filesystem: {
        allowWrite: [slash(over.writeRoot)],
        denyWrite: over.denyWrite.map(slash),
        denyRead: [repo, data, join(home, '.ssh'), join(home, '.aws'), join(home, '.config', 'gh')].map(slash),
      },
      network: { allowedDomains: [], strictAllowlist: true },
    },
    hooks: {
      PreToolUse: [{ matcher: '.*', hooks: [hookEntry('pre', { onFailure: 'block' })] }],
      PostToolUse: [{ matcher: '.*', hooks: [hookEntry('post', {})] }],
      // O-1: a subagent call that fails ends in PostToolUseFailure, not PostToolUse, and both free a concurrency slot.
      PostToolUseFailure: [{ matcher: '.*', hooks: [hookEntry('post', {})] }],
      ConfigChange: [{ hooks: [hookEntry('config-change', { onFailure: 'block' })] }],
    },
  };
}

describe('renderClaudeSettings snapshots', () => {
  it('map', () => {
    const expected = expectedSettings({
      writeRoot: join(staging, '.planning', 'codebase'),
      denyWrite: [
        join(staging, '.git'),
        join(staging, '.planning', 'PROJECT.md'),
        join(staging, '.planning', 'config.json'),
        join(staging, '.planning', 'phases'),
        join(staging, 'docs'),
        join(staging, 'package.json'),
        join(staging, 'src'),
      ],
      allowExtra: ['Skill', 'Agent'],
    });
    assert.deepEqual(render(scope('map'), ['gsd-map-codebase']), expected);
  });

  it('intel: no Skill (--agent form) and no Agent tool (no subagents)', () => {
    const expected = expectedSettings({
      writeRoot: join(staging, '.planning', 'intel'),
      denyWrite: [
        join(staging, '.git'),
        join(staging, '.planning', 'PROJECT.md'),
        join(staging, '.planning', 'config.json'),
        join(staging, '.planning', 'phases'),
        join(staging, 'docs'),
        join(staging, 'package.json'),
        join(staging, 'src'),
      ],
      allowExtra: [],
    });
    assert.deepEqual(render(scope('intel')), expected);
  });

  it('knowledge', () => {
    const expected = expectedSettings({
      writeRoot: join(staging, '.avarice-knowledge'),
      denyWrite: [
        join(staging, '.git'),
        join(staging, '.planning'),
        join(staging, '.planning', 'config.json'),
        join(staging, 'docs'),
        join(staging, 'package.json'),
        join(staging, 'src'),
      ],
      allowExtra: ['Skill', 'Agent'],
    });
    assert.deepEqual(render(scope('knowledge'), ['graphify']), expected);
  });
});

describe('renderClaudeSettings invariants', () => {
  const purposes = ['map', 'intel', 'knowledge'] as const;

  it('always carries dontAsk, the bypass disable, the sandbox switches and an empty domain list', () => {
    for (const purpose of purposes) {
      const settings = render(scope(purpose)) as Record<string, any>;
      assert.equal(settings.permissions.defaultMode, 'dontAsk');
      assert.equal(settings.permissions.disableBypassPermissionsMode, 'disable');
      assert.equal(settings.sandbox.enabled, true);
      assert.equal(settings.sandbox.failIfUnavailable, true);
      assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
      assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false);
      assert.deepEqual(settings.sandbox.excludedCommands, []);
      assert.deepEqual(settings.sandbox.network.allowedDomains, []);
      assert.equal(settings.hooks.PreToolUse[0].hooks[0].onFailure, 'block');
      assert.equal(settings.hooks.ConfigChange[0].hooks[0].onFailure, 'block');
      assert.equal(settings.hooks.PostToolUse[0].hooks[0].onFailure, undefined);
      assert.equal(settings.hooks.PreToolUse[0].hooks[0].timeout, 5);
    }
  });

  it('registers AVARICE\'s post hook for completed and for failed tool calls (the in-flight subagent count needs both)', () => {
    for (const purpose of purposes) {
      const settings = render(scope(purpose)) as Record<string, any>;
      for (const event of ['PostToolUse', 'PostToolUseFailure']) {
        assert.equal(settings.hooks[event].length, 1, event);
        assert.equal(settings.hooks[event][0].matcher, '.*', event);
        const args = settings.hooks[event][0].hooks[0].args as string[];
        assert.equal(args[args.indexOf('--event') + 1], 'post', event);
        assert.equal(args.at(-1), POLICY, event);
      }
    }
  });

  it('is plain JSON: a round trip through JSON changes nothing', () => {
    const settings = render(scope('map'), ['gsd-map-codebase']);
    assert.deepEqual(JSON.parse(JSON.stringify(settings)), settings);
  });

  it('uses the realpath of a symlinked staging directory in every rule and list', () => {
    const link = join(root, 'link-to-work');
    symlinkSync(join(root, 'work'), link);
    const viaLink = join(link, 'onb-1', 'staging');
    const settings = render(scope('map', { stagingPath: viaLink })) as Record<string, any>;
    const text = JSON.stringify(settings);
    assert.ok(!text.includes('link-to-work'), 'no unresolved symlink path may reach the settings');
    assert.ok(text.includes(`Edit(${slash(staging)}/.planning/codebase/**)`));
  });

  it('resolves a write root that does not exist yet through its nearest existing parent', () => {
    const settings = render(scope('map')) as Record<string, any>;
    assert.deepEqual(settings.sandbox.filesystem.allowWrite, [slash(join(staging, '.planning', 'codebase'))]);
  });

  it('emits allowRead only when the strategy lists a path, and keeps it out of the permission rules', () => {
    const plain = render(scope('map')) as Record<string, any>;
    assert.equal(plain.sandbox.filesystem.allowRead, undefined);
    const base = scope('map');
    const withAllow = render({ ...base, allowRead: [join(repo, '.git')] }) as Record<string, any>;
    assert.deepEqual(withAllow.sandbox.filesystem.allowRead, [slash(join(repo, '.git'))]);
    assert.ok(!withAllow.permissions.allow.some((r: string) => r.includes('.git') && r.startsWith('Read(') && r.includes(repo)));
  });

  it('never lists a network domain, even if the scope somehow carries one', () => {
    const base = scope('map');
    const settings = render({ ...base, allowedDomains: ['registry.npmjs.org'] }) as Record<string, any>;
    assert.deepEqual(settings.sandbox.network.allowedDomains, []);
    assert.ok(!settings.permissions.allow.some((r: string) => r.startsWith('WebFetch')));
  });

  it('gates the Skill rule on the allowed skills and the Agent rule on the subagent budget', () => {
    assert.ok(!(render(scope('map'), []) as any).permissions.allow.includes('Skill'));
    assert.ok((render(scope('map'), ['gsd-map-codebase']) as any).permissions.allow.includes('Skill'));
    assert.ok((render(scope('map')) as any).permissions.allow.includes('Agent'));
    assert.ok(!(render(scope('intel')) as any).permissions.allow.includes('Agent'));
  });
});

describe('renderClaudeSettings Bash strategies (Task 1 decision: blanket-bash-hook-identity)', () => {
  const bashAllow = (settings: unknown): string[] => (settings as any).permissions.allow.filter((r: string) => r === 'Bash' || r.startsWith('Bash('));

  it('blanket allows plain Bash and still denies the prefixes', () => {
    const settings = render(scope('map')) as any;
    assert.deepEqual(bashAllow(settings), ['Bash']);
    for (const rule of deniedBashRules()) assert.ok(settings.permissions.deny.includes(rule), `deny must hold ${rule}`);
  });

  it('narrow-rules allows one rule per read-only command and GSD read verb, and no blanket Bash', () => {
    const s = scope('map', { strategy: 'narrow-rules' });
    const rules = bashAllow(render(s));
    assert.ok(!rules.includes('Bash'));
    assert.ok(rules.includes('Bash(ls:*)'));
    assert.ok(rules.includes('Bash(git ls-files:*)'));
    assert.ok(rules.includes('Bash(gsd_run runtime-identity:*)'));
    assert.ok(!rules.includes('Bash(gsd_run intel patch-meta:*)'));
    assert.ok(bashAllow(render(scope('intel', { strategy: 'narrow-rules' }))).includes('Bash(gsd_run intel patch-meta:*)'));
  });

  it('hook-allow lists no Bash allow rule at all', () => {
    assert.deepEqual(bashAllow(render(scope('map', { strategy: 'hook-allow' }))), []);
  });
});

describe('GSD hooks and hook command helpers', () => {
  it('adds the GSD hooks as extra PreToolUse entries after the AVARICE hook', () => {
    const settings = render(scope('map'), [], [{ command: '/opt/node/bin/node', args: ['/c/hooks/gsd-secret-read-guard.js'], matcher: 'Read|Grep|Bash' }]) as any;
    assert.equal(settings.hooks.PreToolUse.length, 2);
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].args.at(-1), POLICY);
    assert.equal(settings.hooks.PreToolUse[1].matcher, 'Read|Grep|Bash');
    assert.deepEqual(settings.hooks.PreToolUse[1].hooks[0].args, ['/c/hooks/gsd-secret-read-guard.js']);
    assert.equal(settings.hooks.PostToolUse.length, 1);
  });

  it('gsdSecretReadGuardHook returns the guard from the config directory only when the file exists', () => {
    const configDir = join(root, 'config-dir');
    mkdirSync(join(configDir, 'hooks'), { recursive: true });
    assert.equal(gsdSecretReadGuardHook(configDir), null);
    writeFileSync(join(configDir, 'hooks', 'gsd-secret-read-guard.js'), '// guard\n');
    const entry = gsdSecretReadGuardHook(configDir);
    assert.ok(entry);
    assert.equal(entry.command, process.execPath);
    assert.deepEqual(entry.args, [join(configDir, 'hooks', 'gsd-secret-read-guard.js')]);
    assert.equal(entry.matcher, 'Read|Grep|Bash');
  });

  it('avariceHookCommand names process.execPath, silences the experimental warning and ends in the entry path', () => {
    const cmd = avariceHookCommand('/avarice/src/hook/pre-tool-use.ts');
    assert.equal(cmd.command, process.execPath);
    assert.deepEqual(cmd.args, ['--disable-warning=ExperimentalWarning', '/avarice/src/hook/pre-tool-use.ts']);
  });
});
