// Launch argv builder and refusal (CS-14, CON-3). The argv is generated, never composed from free text, and
// assertLaunchArgsSafe judges the finished argv before any process starts: the settings file and the budget
// must be present, the permission mode must be dontAsk, and no flag may bypass permissions or widen what the
// generated settings allow. Plan 01-15 calls it between buildLaunchArgs and spawn.
//
// The launch line (01-RESEARCH "Minimal launch line"; `--verbose` is required with stream-json under -p):
//   claude -p <prompt> --setting-sources "" --settings <file> --plugin-dir <dir> --agents <file>
//     [--agent <name>] --permission-mode dontAsk --permission-prompts none --strict-mcp-config
//     --mcp-config <file> --allowedTools Glob,Grep --model <m> --max-budget-usd <n> --output-format stream-json --verbose
//     --session-id <uuid>      (a resume ends `--resume <uuid>` instead; the two are never both on the line)
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface LaunchArgsInput {
  prompt: string;
  settingsFile: string;
  pluginDir: string;
  agentsFile: string;
  mcpFile: string;
  model: string;
  costCapUsd: number;
  sessionId: string;
  // An earlier session to resume (D-08): the line ends `--resume <id>` and carries no `--session-id`; never `--fork-session`.
  resumeSessionId?: string;
  // Named agent for the session (the intel seam, S0-D).
  agent?: string;
}

// The admitted host removes its Glob and Grep tools from a session that has a shell, and from every agent that session starts, unless the launch line names one of them (a
// `permissions.allow` entry does not count). Without them a run's unit and its subagents have no content search at all: the Grep call fails with the host's hint to use `grep`
// through the shell, and the hook never admits shell grep (plan 03-69; the owner's brief-harness-defect ruling on run 3's attempt 1, D-26, D-27). The generated settings already
// allow both tools unconditionally and the hook judges every search's path with the read rules, so naming the pair grants nothing new.
export const SEARCH_TOOLS_ALLOWED = 'Glob,Grep';

export function buildLaunchArgs(input: LaunchArgsInput): string[] {
  return [
    '-p',
    input.prompt,
    '--setting-sources',
    '',
    '--settings',
    input.settingsFile,
    '--plugin-dir',
    input.pluginDir,
    '--agents',
    input.agentsFile,
    ...(input.agent !== undefined ? ['--agent', input.agent] : []),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    '--mcp-config',
    input.mcpFile,
    '--allowedTools',
    SEARCH_TOOLS_ALLOWED,
    '--model',
    input.model,
    '--max-budget-usd',
    String(input.costCapUsd),
    '--output-format',
    'stream-json',
    '--verbose',
    // A resume swaps only this final pair: the CLI refuses `--session-id` together with `--resume`, and every flag above stays.
    ...(input.resumeSessionId !== undefined ? ['--resume', input.resumeSessionId] : ['--session-id', input.sessionId]),
  ];
}

// Flags that take a value in the shapes this builder emits (and the ones refused below, so their value is not
// mistaken for a flag).
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-p',
  '--setting-sources',
  '--settings',
  '--plugin-dir',
  '--agents',
  '--agent',
  '--permission-mode',
  '--permission-prompts',
  '--mcp-config',
  '--model',
  '--max-budget-usd',
  '--output-format',
  '--session-id',
  '--add-dir',
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--tools',
  '--append-system-prompt',
  '--system-prompt',
  '--resume',
  '-r',
]);

// Flags that grant authority the generated settings do not: refused outright. `--allowedTools` is the one exception, admitted only as the generated Glob and Grep pair
// (see below).
const WIDENING_FLAGS: ReadonlySet<string> = new Set(['--add-dir', '--allowedTools', '--allowed-tools', '--permission-prompt-tool']);

function refuse(reason: string): Result<never> {
  return err({ kind: 'denied', rule: `launch_args:${reason}`, enforcer: 'avarice' });
}

export function assertLaunchArgsSafe(argv: readonly string[]): Result<void> {
  const values = new Map<string, string>();
  const bare = new Set<string>();
  let prompt: string | undefined;
  let allowedToolsSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (i === 0 && token === '-p') {
      prompt = argv[i + 1];
      i++;
      continue;
    }
    const equals = token.startsWith('--') ? token.indexOf('=') : -1;
    const flag = equals === -1 ? token : token.slice(0, equals);
    if (!flag.startsWith('-')) continue;

    if (flag === '--bare') return refuse('bare: the host would skip hooks and settings');
    if (flag.startsWith('--dangerously') || flag.startsWith('--allow-dangerously')) {
      return refuse(`dangerously: ${flag} bypasses permissions`);
    }
    if (WIDENING_FLAGS.has(flag)) {
      // The generated pair only: the bare flag, once, with the exact value. The `=` form, another value, a second occurrence and `--allowed-tools` are refused.
      const generatedPair = flag === '--allowedTools' && equals === -1 && !allowedToolsSeen && argv[i + 1] === SEARCH_TOOLS_ALLOWED;
      if (!generatedPair) return refuse(`widen: ${flag} grants access the generated settings do not`);
      allowedToolsSeen = true;
      i++;
      continue;
    }

    if (equals !== -1) {
      values.set(flag, token.slice(equals + 1));
    } else if (VALUE_FLAGS.has(flag)) {
      values.set(flag, argv[i + 1] ?? '');
      i++;
    } else {
      bare.add(flag);
    }
  }

  if (prompt === undefined || prompt === '') return refuse('prompt: -p needs a non-empty prompt');
  if (prompt.startsWith('-')) return refuse('prompt: a prompt that starts with a dash would be parsed as a flag');

  const mode = values.get('--permission-mode');
  if (mode !== 'dontAsk') return refuse(`permission-mode: ${mode === undefined ? 'missing' : JSON.stringify(mode)}, only dontAsk is allowed`);
  if (values.get('--permission-prompts') !== 'none') return refuse('permission-prompts: must be none');

  if (values.get('--setting-sources') !== '') {
    return refuse('setting-sources: must be the empty string, so user, project and local settings do not load');
  }
  const settings = values.get('--settings');
  if (settings === undefined || settings === '') return refuse('settings: the generated settings file is required');
  if (!bare.has('--strict-mcp-config')) return refuse('strict-mcp-config: required, only the generated MCP set may load');

  const budget = values.get('--max-budget-usd');
  const cap = budget === undefined || budget.trim() === '' ? NaN : Number(budget);
  if (!Number.isFinite(cap) || cap <= 0) {
    return refuse(`max-budget-usd: ${budget === undefined ? 'missing' : JSON.stringify(budget)} is not a positive finite number`);
  }
  return ok(undefined);
}

// ---- restricted mode (plan 04-23; CON-4, D-12) --------------------------------------------------------------------------------------------

export interface RestrictedLaunchArgsInput {
  prompt: string;
  settingsFile: string;
  mcpFile: string;
  model: string;
  costCapUsd: number;
  sessionId: string;
  // An earlier session to resume: the line ends `--resume <id>` and carries no `--session-id`.
  resumeSessionId?: string;
  // The plugin directory and the agents file of an onboarding's map (plan 04-24; CON-4, D-12): the generated ones that deliver GSD's mapper, named together or not at all. A restricted
  // run (plan 04-23) names neither.
  pluginDir?: string;
  agentsFile?: string;
}

// The restricted launch line (docs/containment.md "Restricted mode"; spike S4-C):
//   claude -p <prompt> --restricted --setting-sources "" --settings <file> --permission-mode dontAsk --permission-prompts none
//     --strict-mcp-config --mcp-config <file> --model <m> --max-budget-usd <n> --output-format stream-json --verbose --session-id <uuid>
// `--restricted` removes the tools that run commands or code and WebFetch, ignores user, project and local settings and confines the file tools to the working
// directory. The line names no `--tools`, `--allowedTools` or `--add-dir`, so nothing is granted back. A restricted run names no `--plugin-dir` or `--agents` either; a restricted
// onboarding (plan 04-24) names exactly the generated pair that delivers GSD's mapper (`--plugin-dir <dir> --agents <file>`, as the contained map does), and no other extension. `--setting-sources ""` and
// `--strict-mcp-config` are kept beside `--restricted` on purpose: the help text says `--restricted` already ignores those sources, but whether the host accepts
// the two flags together is not known offline (S4-C item 5), and a host that refuses the combination fails closed (nothing launches) where leaving the flags off
// would rest on an unproven claim. Plan 04-34's live run settles it.
export function restrictedLaunchArgs(input: RestrictedLaunchArgsInput): string[] {
  return [
    '-p',
    input.prompt,
    '--restricted',
    '--setting-sources',
    '',
    '--settings',
    input.settingsFile,
    ...(input.pluginDir !== undefined && input.agentsFile !== undefined ? ['--plugin-dir', input.pluginDir, '--agents', input.agentsFile] : []),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    '--mcp-config',
    input.mcpFile,
    '--model',
    input.model,
    '--max-budget-usd',
    String(input.costCapUsd),
    '--output-format',
    'stream-json',
    '--verbose',
    ...(input.resumeSessionId !== undefined ? ['--resume', input.resumeSessionId] : ['--session-id', input.sessionId]),
  ];
}

// Flags that would give back what `--restricted` removed, or widen what the generated settings allow: refused whatever their value.
const RESTRICTED_REFUSED_FLAGS: ReadonlySet<string> = new Set([
  '--bare',
  '--safe-mode',
  '--tools',
  '--allowedTools',
  '--allowed-tools',
  '--add-dir',
  '--permission-prompt-tool',
  '--agent',
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
]);

// The two flags that deliver GSD's mapper to a restricted onboarding. A restricted run's line refuses them; an onboarding's line (`extensions`) must carry both or neither.
const RESTRICTED_EXTENSION_FLAGS: ReadonlySet<string> = new Set(['--plugin-dir', '--agents']);

export interface RestrictedJudgeOptions {
  // The line is an onboarding's: the generated plugin directory and agents file are admitted, as a pair.
  extensions?: boolean;
}

// Judges the finished restricted argv before any process starts, as assertLaunchArgsSafe does for the contained line: `--restricted` is required, so a line that
// lost it is never started; dontAsk, no prompts, an empty setting-sources, the generated settings, a strict MCP set and a positive budget are required too;
// and no flag may grant a tool or bypass permissions.
export function assertRestrictedLaunchArgsSafe(argv: readonly string[], options: RestrictedJudgeOptions = {}): Result<void> {
  const refuseRestricted = (reason: string): Result<never> => refuse(`restricted:${reason}`);
  const values = new Map<string, string>();
  const bare = new Set<string>();
  let prompt: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (i === 0 && token === '-p') {
      prompt = argv[i + 1];
      i++;
      continue;
    }
    const equals = token.startsWith('--') ? token.indexOf('=') : -1;
    const flag = equals === -1 ? token : token.slice(0, equals);
    if (!flag.startsWith('-')) continue;
    if (RESTRICTED_EXTENSION_FLAGS.has(flag) && options.extensions !== true) {
      return refuseRestricted(`${flag} would load an extension, and a restricted run loads none`);
    }
    if (RESTRICTED_REFUSED_FLAGS.has(flag) || flag.startsWith('--dangerously') || flag.startsWith('--allow-dangerously')) {
      return refuseRestricted(`${flag} would give back what the restricted line removes or bypass permissions`);
    }
    if (equals !== -1) values.set(flag, token.slice(equals + 1));
    else if (VALUE_FLAGS.has(flag)) {
      values.set(flag, argv[i + 1] ?? '');
      i++;
    } else bare.add(flag);
  }

  if (prompt === undefined || prompt === '') return refuseRestricted('prompt: -p needs a non-empty prompt');
  if (prompt.startsWith('-')) return refuseRestricted('prompt: a prompt that starts with a dash would be parsed as a flag');
  if (!bare.has('--restricted')) return refuseRestricted('--restricted is required');
  if (options.extensions === true) {
    const plugin = values.get('--plugin-dir');
    const agents = values.get('--agents');
    if ((plugin === undefined) !== (agents === undefined)) return refuseRestricted('extensions: --plugin-dir and --agents are given together or not at all');
    if ((plugin !== undefined && plugin === '') || (agents !== undefined && agents === '')) return refuseRestricted('extensions: the generated plugin directory and agents file need a value');
  }
  const mode = values.get('--permission-mode');
  if (mode !== 'dontAsk') return refuseRestricted(`permission-mode: ${mode === undefined ? 'missing' : JSON.stringify(mode)}, only dontAsk is allowed`);
  if (values.get('--permission-prompts') !== 'none') return refuseRestricted('permission-prompts: must be none');
  if (values.get('--setting-sources') !== '') return refuseRestricted('setting-sources: must be the empty string');
  const settings = values.get('--settings');
  if (settings === undefined || settings === '') return refuseRestricted('settings: the generated settings file is required');
  if (!bare.has('--strict-mcp-config')) return refuseRestricted('strict-mcp-config: required, only the generated MCP set may load');
  const budget = values.get('--max-budget-usd');
  const cap = budget === undefined || budget.trim() === '' ? NaN : Number(budget);
  if (!Number.isFinite(cap) || cap <= 0) return refuseRestricted(`max-budget-usd: ${budget === undefined ? 'missing' : JSON.stringify(budget)} is not a positive finite number`);
  return ok(undefined);
}
