// Launch argv builder and refusal (CS-14, CON-3). The argv is generated, never composed from free text, and
// assertLaunchArgsSafe judges the finished argv before any process starts: the settings file and the budget
// must be present, the permission mode must be dontAsk, and no flag may bypass permissions or widen what the
// generated settings allow. Plan 01-15 calls it between buildLaunchArgs and spawn.
//
// The launch line (01-RESEARCH "Minimal launch line"; `--verbose` is required with stream-json under -p):
//   claude -p <prompt> --setting-sources "" --settings <file> --plugin-dir <dir> --agents <file>
//     [--agent <name>] --permission-mode dontAsk --permission-prompts none --strict-mcp-config
//     --mcp-config <file> --model <m> --max-budget-usd <n> --output-format stream-json --verbose
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

// Flags that grant authority the generated settings do not: refused outright.
const WIDENING_FLAGS: ReadonlySet<string> = new Set(['--add-dir', '--allowedTools', '--allowed-tools', '--permission-prompt-tool']);

function refuse(reason: string): Result<never> {
  return err({ kind: 'denied', rule: `launch_args:${reason}`, enforcer: 'avarice' });
}

export function assertLaunchArgsSafe(argv: readonly string[]): Result<void> {
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

    if (flag === '--bare') return refuse('bare: the host would skip hooks and settings');
    if (flag.startsWith('--dangerously') || flag.startsWith('--allow-dangerously')) {
      return refuse(`dangerously: ${flag} bypasses permissions`);
    }
    if (WIDENING_FLAGS.has(flag)) return refuse(`widen: ${flag} grants access the generated settings do not`);

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
