// buildLaunchArgs and assertLaunchArgsSafe (CS-14, CON-3): the launch line is generated, and an unsafe argv is
// refused before any process starts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertLaunchArgsSafe, buildLaunchArgs } from '../../src/adapters/host-claude/launch-args.ts';
import type { LaunchArgsInput } from '../../src/adapters/host-claude/launch-args.ts';

const SESSION = '3f2b8c1e-5a47-4d0b-9c1a-0e5d6f7a8b9c';

function input(over: Partial<LaunchArgsInput> = {}): LaunchArgsInput {
  return {
    prompt: '/gsd-map-codebase',
    settingsFile: '/inv/host-settings.json',
    pluginDir: '/inv/plugin',
    agentsFile: '/inv/agents.json',
    mcpFile: '/inv/mcp.json',
    model: 'haiku',
    costCapUsd: 1,
    sessionId: SESSION,
    ...over,
  };
}

// Value of the first occurrence of a flag.
function valueOf(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

describe('buildLaunchArgs', () => {
  it('emits every flag of the minimal launch line, with the empty setting-sources value', () => {
    const argv = buildLaunchArgs(input());
    assert.equal(argv[0], '-p');
    assert.equal(argv[1], '/gsd-map-codebase');
    assert.equal(valueOf(argv, '--setting-sources'), '');
    assert.equal(valueOf(argv, '--settings'), '/inv/host-settings.json');
    assert.equal(valueOf(argv, '--plugin-dir'), '/inv/plugin');
    assert.equal(valueOf(argv, '--agents'), '/inv/agents.json');
    assert.equal(valueOf(argv, '--permission-mode'), 'dontAsk');
    assert.equal(valueOf(argv, '--permission-prompts'), 'none');
    assert.ok(argv.includes('--strict-mcp-config'));
    assert.equal(valueOf(argv, '--mcp-config'), '/inv/mcp.json');
    assert.equal(valueOf(argv, '--model'), 'haiku');
    assert.equal(valueOf(argv, '--max-budget-usd'), '1');
    assert.equal(valueOf(argv, '--output-format'), 'stream-json');
    assert.ok(argv.includes('--verbose'));
    assert.equal(valueOf(argv, '--session-id'), SESSION);
    assert.ok(!argv.includes('--agent'));
  });

  it('adds --agent only when an agent is named (the intel seam, S0-D)', () => {
    const argv = buildLaunchArgs(input({ agent: 'gsd-intel-updater', prompt: 'focus: full; project root: /staging' }));
    assert.equal(valueOf(argv, '--agent'), 'gsd-intel-updater');
    assert.equal(argv[1], 'focus: full; project root: /staging');
  });

  it('renders a fractional cost cap as a plain decimal', () => {
    assert.equal(valueOf(buildLaunchArgs(input({ costCapUsd: 0.5 })), '--max-budget-usd'), '0.5');
  });

  it('builds argv that assertLaunchArgsSafe accepts', () => {
    for (const argv of [buildLaunchArgs(input()), buildLaunchArgs(input({ agent: 'gsd-intel-updater' }))]) {
      const verdict = assertLaunchArgsSafe(argv);
      assert.ok(verdict.ok, JSON.stringify(verdict));
    }
  });
});

function refused(argv: readonly string[]): string {
  const verdict = assertLaunchArgsSafe(argv);
  assert.ok(!verdict.ok, `expected a refusal for ${JSON.stringify(argv)}`);
  assert.ok(!verdict.ok && verdict.error.kind === 'denied');
  assert.ok(!verdict.ok && verdict.error.kind === 'denied' && verdict.error.rule.startsWith('launch_args:'));
  return verdict.ok ? '' : verdict.error.kind === 'denied' ? verdict.error.rule : '';
}

describe('assertLaunchArgsSafe', () => {
  const good = (): string[] => buildLaunchArgs(input());
  const without = (flag: string, takesValue: boolean): string[] => {
    const argv = good();
    const at = argv.indexOf(flag);
    assert.notEqual(at, -1, `fixture lacks ${flag}`);
    argv.splice(at, takesValue ? 2 : 1);
    return argv;
  };
  const replaceValue = (flag: string, value: string): string[] => {
    const argv = good();
    argv[argv.indexOf(flag) + 1] = value;
    return argv;
  };

  it('refuses --bare', () => {
    assert.match(refused([...good(), '--bare']), /bare/);
  });

  it('refuses --dangerously-skip-permissions and any other --dangerously flag', () => {
    assert.match(refused([...good(), '--dangerously-skip-permissions']), /dangerously/);
    assert.match(refused([...good(), '--allow-dangerously-skip-permissions']), /dangerously/);
  });

  it('refuses bypassPermissions and auto, and every permission mode other than dontAsk', () => {
    for (const mode of ['bypassPermissions', 'auto', 'acceptEdits', 'plan', 'default']) {
      assert.match(refused(replaceValue('--permission-mode', mode)), /permission-mode/);
    }
  });

  it('refuses the equals form of the permission mode and a missing permission mode', () => {
    const argv = without('--permission-mode', true);
    assert.match(refused([...argv, '--permission-mode=bypassPermissions']), /permission-mode/);
    assert.match(refused(argv), /permission-mode/);
  });

  it('refuses a missing --settings', () => {
    assert.match(refused(without('--settings', true)), /settings/);
  });

  it('refuses a missing, zero, negative, non-numeric or infinite --max-budget-usd', () => {
    assert.match(refused(without('--max-budget-usd', true)), /max-budget-usd/);
    for (const bad of ['0', '-1', 'abc', 'NaN', 'Infinity', '']) {
      assert.match(refused(replaceValue('--max-budget-usd', bad)), /max-budget-usd/);
    }
  });

  it('refuses a launch that does not turn off setting sources', () => {
    assert.match(refused(without('--setting-sources', true)), /setting-sources/);
    assert.match(refused(replaceValue('--setting-sources', 'user,project')), /setting-sources/);
  });

  it('refuses a missing --permission-prompts none and a missing --strict-mcp-config', () => {
    assert.match(refused(without('--permission-prompts', true)), /permission-prompts/);
    assert.match(refused(replaceValue('--permission-prompts', 'user')), /permission-prompts/);
    assert.match(refused(without('--strict-mcp-config', false)), /strict-mcp-config/);
  });

  it('refuses flags that widen what the settings allow', () => {
    for (const extra of [['--add-dir', '/'], ['--allowedTools', 'Bash'], ['--allowed-tools', 'Bash']]) {
      assert.match(refused([...good(), ...extra]), /widen/);
    }
  });

  it('judges flags, not prompt text: a prompt that mentions --bare is fine', () => {
    const verdict = assertLaunchArgsSafe(buildLaunchArgs(input({ prompt: 'explain what --bare does' })));
    assert.ok(verdict.ok, JSON.stringify(verdict));
  });

  it('refuses a prompt that would be parsed as a flag', () => {
    assert.match(refused(buildLaunchArgs(input({ prompt: '--bare' }))), /prompt/);
    assert.match(refused(buildLaunchArgs(input({ prompt: '' }))), /prompt/);
  });

  it('refuses an empty argv', () => {
    assert.match(refused([]), /prompt|settings/);
  });
});
