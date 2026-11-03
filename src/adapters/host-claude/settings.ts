// Claude Code settings renderer (CON-2, CON-3, CON-5, CON-6). Turns an InvocationScope into the one settings
// file the contained host loads: with `--setting-sources ""` it is the only non-managed settings layer, so
// everything the invocation may do is in here (docs/containment.md "Generated host settings").
//
// Path forms: `//{absolute}` marks an absolute path in permission rules and in the sandbox lists. Every path is
// resolved with realpath first (macOS /tmp and /var are symlinks, and a rule on the symlink matches nothing);
// a path that does not exist yet is resolved through its nearest existing parent.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { InvocationScope } from '../../domain/invocation-scope.ts';

export interface HookCommand {
  command: string;
  args: string[];
}

export interface RenderOptions {
  // AVARICE's hook: the command and the arguments that precede `--event`; see avariceHookCommand.
  hook: HookCommand;
  // `{invDir}/hook-policy.json`, written by plan 01-12's policy writer.
  policyFile: string;
  // GSD hooks kept from the user's settings, appended after AVARICE's PreToolUse entry.
  gsdHooks?: ReadonlyArray<HookCommand & { matcher?: string }>;
  // Names of the skills the plugin directory carries; a non-empty list allows the Skill tool.
  skillsAllowed?: readonly string[];
}

// Resolves symlinks of an absolute path whether or not it exists yet.
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  const tail: string[] = [];
  let probe = absolute;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return absolute;
    tail.unshift(probe.slice(parent.length).replace(/^\/+/, ''));
    probe = parent;
  }
  try {
    return join(realpathSync(probe), ...tail);
  } catch {
    return absolute;
  }
}

const marked = (path: string): string => `/${canonicalPath(path)}`;

function hookEntry(hook: HookCommand, policyFile: string, event: 'pre' | 'post' | 'config-change', block: boolean) {
  return {
    type: 'command',
    command: hook.command,
    args: [...hook.args, '--event', event, '--policy', policyFile],
    timeout: 5,
    ...(block ? { onFailure: 'block' } : {}),
  };
}

function bashAllowRules(scope: InvocationScope): string[] {
  switch (scope.commands.strategy) {
    case 'blanket-bash-hook-identity':
      return ['Bash'];
    case 'narrow-rules':
      return [
        ...scope.commands.readOnly.map((command) => `Bash(${command}:*)`),
        ...scope.commands.gsdReadVerbs.map((verb) => `Bash(gsd_run ${verb}:*)`),
      ];
    case 'hook-allow':
      return [];
  }
}

export function renderClaudeSettings(scope: InvocationScope, options: RenderOptions): Record<string, unknown> {
  const staging = canonicalPath(scope.stagingPath);

  const allow: string[] = [
    `Read(${marked(scope.stagingPath)}/**)`,
    ...scope.readRoots.map((root) => `Read(${marked(root)}/**)`),
    'Glob',
    'Grep',
  ];
  if ((options.skillsAllowed ?? []).length > 0) allow.push('Skill');
  if (scope.subagents.total > 0) allow.push('Agent');
  for (const root of scope.writeRoots) allow.push(`Edit(${marked(root)}/**)`);
  allow.push(...bashAllowRules(scope));

  const deny: string[] = [
    `Read(${marked(scope.repoPath)}/**)`,
    `Read(${marked(scope.dataRoot)}/**)`,
    `Edit(${marked(scope.dataRoot)}/**)`,
    ...scope.denyRead.filter((path) => path !== scope.repoPath && path !== scope.dataRoot).map((path) => `Read(${marked(path)}/**)`),
    ...scope.denyReadGlobs.map((glob) => `Read(/${staging}/${glob})`),
    'WebFetch',
    'WebSearch',
    'NotebookEdit',
    `Edit(${marked(join(scope.stagingPath, '.planning/config.json'))})`,
    ...scope.commands.deniedPrefixes.map((prefix) => `Bash(${prefix}:*)`),
  ];

  const filesystem: Record<string, string[]> = {
    allowWrite: scope.writeRoots.map(marked),
    denyWrite: scope.denyWrite.map(marked),
    denyRead: scope.denyRead.map(marked),
  };
  if (scope.allowRead.length > 0) filesystem['allowRead'] = scope.allowRead.map(marked);

  const preTool: unknown[] = [{ matcher: '.*', hooks: [hookEntry(options.hook, options.policyFile, 'pre', true)] }];
  for (const gsd of options.gsdHooks ?? []) {
    preTool.push({
      matcher: gsd.matcher ?? '.*',
      hooks: [{ type: 'command', command: gsd.command, args: [...gsd.args], timeout: 10 }],
    });
  }

  return {
    permissions: {
      defaultMode: 'dontAsk',
      disableBypassPermissionsMode: 'disable',
      allow,
      deny,
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      excludedCommands: [],
      filesystem,
      // No domain is ever listed for onboarding (CON-5, SEC-5): the model API traffic is the host's own and
      // sits outside the sandbox, and nothing else may reach the network.
      network: { allowedDomains: [], strictAllowlist: true },
    },
    hooks: {
      PreToolUse: preTool,
      PostToolUse: [{ matcher: '.*', hooks: [hookEntry(options.hook, options.policyFile, 'post', false)] }],
      // A tool call that fails ends in PostToolUseFailure instead of PostToolUse. The hook counts in-flight subagents from both, so
      // a failed Agent call does not hold a concurrency slot for the rest of the invocation (O-1).
      PostToolUseFailure: [{ matcher: '.*', hooks: [hookEntry(options.hook, options.policyFile, 'post', false)] }],
      ConfigChange: [{ hooks: [hookEntry(options.hook, options.policyFile, 'config-change', true)] }],
    },
  };
}

// AVARICE's hook as a command plus arguments (no shell quoting): `process.execPath`, the flag that keeps the
// node:sqlite experimental warning off stderr, and the absolute path of the hook entry (src/hook/pre-tool-use.ts,
// created by plan 01-12).
export function avariceHookCommand(entry: string): HookCommand {
  return { command: process.execPath, args: ['--disable-warning=ExperimentalWarning', entry] };
}

// GSD's secret read guard, kept in the generated settings when the user's configuration directory has it
// (the user's own settings are not loaded under `--setting-sources ""`). Matcher as GSD registers it.
export function gsdSecretReadGuardHook(configDir: string): (HookCommand & { matcher: string }) | null {
  const script = join(configDir, 'hooks', 'gsd-secret-read-guard.js');
  if (!existsSync(script)) return null;
  return { command: process.execPath, args: [script], matcher: 'Read|Grep|Bash' };
}
