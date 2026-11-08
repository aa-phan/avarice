// The real hook entry (src/hook/pre-tool-use.ts) run as a child process against a temp ledger: canonical
// paths on a real filesystem, fail-closed exits, the budget charge, the hash-chained events and what the events
// never contain (CON-2, CON-3, CON-13, T-01-31, T-01-33, T-01-35, S-31).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { parseHookPolicy } from '../../src/domain/hook-decision.ts';
import type { HookPolicy } from '../../src/domain/hook-decision.ts';
import { computeInvocationScope, computeRunScope } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { HOOK_ENTRY, PREAMBLE, budgetUsed, chainIsIntact, eventRows, makeHookFixture, runHook, runHookAsync } from '../helpers/hook-fixture.ts';
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

function contractFor() {
  const compiled = compileOnboardingContract({ onboardingId: 'onb_1', runId: 'run_1', projectId: 'prj_1', pin: 'a'.repeat(40), preflight: {}, request: {}, nowIso: '2026-11-02T00:00:00.000Z' });
  if (!compiled.ok) throw new Error('contract');
  return compiled.value;
}

interface Deny {
  hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
}
const parsed = (stdout: string): Deny => JSON.parse(stdout) as Deny;

function decisions(fx: HookFixture): Array<{ tool: string; decision: string; rule: string; agentId?: string; budget?: string }> {
  return eventRows(fx, 'hook.decision').map((r) => JSON.parse(r.data_json));
}

describe('file tools on a real filesystem', () => {
  it('allows a Write inside the write root: exit 0, no output, one toolCalls unit, one hook.decision row', () => {
    const fx = fixture();
    const result = runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, 'STACK.md'), content: 'x' } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
    const [row] = eventRows(fx, 'hook.decision');
    assert.ok(row);
    assert.equal(row.run_id, 'run_1');
    assert.equal(row.invocation_id, 'inv_1');
    assert.deepEqual(JSON.parse(row.data_json), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Write', decision: 'allow', rule: 'write-set', budget: 'toolCalls' });
  });

  it('denies a Write elsewhere in staging with the deny JSON, charging nothing', () => {
    const fx = fixture();
    const result = runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.staging, 'src', 'a.ts'), content: 'x' } });
    assert.equal(result.code, 0, result.stderr);
    const out = parsed(result.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside-write-set/);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.deepEqual(decisions(fx).map((d) => [d.decision, d.rule]), [['deny', 'outside-write-set']]);
  });

  it('denies an Edit through a symlink in the write root that points at the staging source tree', () => {
    const fx = fixture();
    symlinkSync(join(fx.staging, 'src'), join(fx.writeRoot, 'link'));
    const result = runHook(fx, 'pre', { tool_name: 'Edit', tool_input: { file_path: join(fx.writeRoot, 'link', 'a.ts'), old_string: 'a', new_string: 'b' } });
    assert.equal(parsed(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const whole = runHook(fx, 'pre', { tool_name: 'Edit', tool_input: { file_path: join(fx.writeRoot, 'link'), old_string: 'a', new_string: 'b' } });
    assert.equal(parsed(whole.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });

  it('denies a Write through a dangling symlink whose target is outside the write root', () => {
    const fx = fixture();
    symlinkSync(join(fx.staging, 'src', 'not-yet.ts'), join(fx.writeRoot, 'dangling'));
    const result = runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, 'dangling'), content: 'x' } });
    assert.equal(parsed(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });

  it('allows a symlink that stays inside the write root', () => {
    const fx = fixture();
    mkdirSync(join(fx.writeRoot, 'real'));
    symlinkSync(join(fx.writeRoot, 'real'), join(fx.writeRoot, 'alias'));
    const result = runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, 'alias', 'new.md'), content: 'x' } });
    assert.equal(result.stdout, '');
  });

  it('denies `..` traversal and a relative path that resolves outside, using the hook input cwd', () => {
    const fx = fixture();
    const up = runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, '..', '..', 'src', 'a.ts'), content: 'x' } });
    assert.equal(parsed(up.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const relative = runHook(fx, 'pre', { tool_name: 'Write', cwd: fx.writeRoot, tool_input: { file_path: '../src/a.ts', content: 'x' } });
    assert.equal(parsed(relative.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const inside = runHook(fx, 'pre', { tool_name: 'Write', cwd: fx.writeRoot, tool_input: { file_path: 'STACK.md', content: 'x' } });
    assert.equal(inside.stdout, '');
  });

  it('denies reads of the user checkout and the data root, and allows reads inside staging', () => {
    const fx = fixture();
    writeFileSync(join(fx.repo, '.env'), 'TOKEN=1');
    const env = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.repo, '.env') } });
    assert.equal(parsed(env.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const db = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: fx.ledgerPath } });
    assert.equal(parsed(db.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const inside = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } });
    assert.equal(inside.stdout, '');
    const grep = runHook(fx, 'pre', { tool_name: 'Grep', tool_input: { pattern: 'x', path: fx.repo } });
    assert.equal(parsed(grep.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });
});

describe('commands, subagents and other tools', () => {
  it('applies the Bash identity rules; an explicit allow only under the hook-allow strategy', () => {
    const fx = fixture();
    const allow = (command: string): string => runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command } }).stdout;
    assert.equal(allow(`${PREAMBLE}\ngsd_run graphify status`), '');
    assert.equal(allow('cat src/a.ts | head -20'), '');
    for (const command of ['find . -name x -delete', 'git -c core.hooksPath=x status', 'npm test', 'echo x > src/a.ts', 'bash scripts/build.sh']) {
      assert.equal(parsed(allow(command)).hookSpecificOutput.permissionDecision, 'deny', command);
    }
    const explicit = fixture({ commands: { strategy: 'hook-allow' } });
    const out = runHook(explicit, 'pre', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(parsed(out.stdout).hookSpecificOutput.permissionDecision, 'allow');
  });

  it('denies shell grep by name through the real hook entry, whichever binary the shell would run (WR-02)', () => {
    const fx = fixture();
    for (const command of ['grep -d RECURSE PASSWORD .', 'grep -5 PASSWORD .']) {
      const out = runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command } });
      assert.equal(parsed(out.stdout).hookSpecificOutput.permissionDecision, 'deny', command);
      const rows = decisions(fx);
      assert.equal(rows[rows.length - 1]?.rule, 'shell-not-allowed', command);
    }
  });

  it('denies a subagent type outside the purpose set and charges subagentsTotal for an allowed one', () => {
    const fx = fixture();
    const bad = runHook(fx, 'pre', { tool_name: 'Agent', tool_input: { subagent_type: 'gsd-executor', prompt: 'x' } });
    assert.equal(parsed(bad.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const good = runHook(fx, 'pre', { tool_name: 'Agent', agent_id: 'agent-7', tool_input: { subagent_type: 'gsd-codebase-mapper', prompt: 'x' } });
    assert.equal(good.stdout, '');
    assert.equal(budgetUsed(fx, 'subagentsTotal'), 1);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.equal(decisions(fx).at(-1)?.agentId, 'agent-7');
  });

  it('denies the fifth subagent of a limit of four with budget_exhausted', () => {
    const fx = fixture({ limits: { subagentsTotal: 4 } });
    const agent = { tool_name: 'Agent', tool_input: { subagent_type: 'gsd-codebase-mapper', prompt: 'x' } };
    for (let n = 0; n < 4; n += 1) assert.equal(runHook(fx, 'pre', agent).stdout, '');
    const fifth = runHook(fx, 'pre', agent);
    assert.match(parsed(fifth.stdout).hookSpecificOutput.permissionDecisionReason, /budget_exhausted/);
    assert.equal(budgetUsed(fx, 'subagentsTotal'), 4);
  });

  it('denies WebFetch, WebSearch and unknown tools; allows Skill and TodoWrite', () => {
    const fx = fixture();
    for (const tool of ['WebFetch', 'WebSearch', 'mcp__x__do']) {
      assert.equal(parsed(runHook(fx, 'pre', { tool_name: tool, tool_input: {} }).stdout).hookSpecificOutput.permissionDecision, 'deny', tool);
    }
    assert.equal(runHook(fx, 'pre', { tool_name: 'Skill', tool_input: { skill: 'gsd-map-codebase' } }).stdout, '');
    assert.equal(runHook(fx, 'pre', { tool_name: 'TodoWrite', tool_input: { todos: [] } }).stdout, '');
  });
});

describe('the tool-call budget', () => {
  it('denies with budget_exhausted at the limit and never goes past it', () => {
    const fx = fixture({ limits: { toolCalls: 3 } });
    const read = { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } };
    for (let n = 0; n < 3; n += 1) assert.equal(runHook(fx, 'pre', read).stdout, '');
    const over = runHook(fx, 'pre', read);
    assert.equal(over.code, 0);
    assert.match(parsed(over.stdout).hookSpecificOutput.permissionDecisionReason, /budget_exhausted/);
    assert.equal(budgetUsed(fx, 'toolCalls'), 3);
    assert.deepEqual(decisions(fx).at(-1), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Read', decision: 'deny', rule: 'budget_exhausted', budget: 'toolCalls' });
  });

  it('charges exactly the limit when parallel hook processes race for the last units', async () => {
    const fx = fixture({ limits: { toolCalls: 5 } });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runHookAsync(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } })),
    );
    assert.ok(results.every((r) => r.code === 0), results.map((r) => r.stderr).join('\n'));
    assert.equal(results.filter((r) => r.stdout === '').length, 5);
    assert.equal(budgetUsed(fx, 'toolCalls'), 5);
    assert.ok(chainIsIntact(fx.ledgerPath));
  });
});

describe('fail closed (CON-3)', () => {
  it('exits 2 with a reason on malformed stdin, on input without a tool name and on a missing field', () => {
    const fx = fixture();
    // The third input names a readable file but no tool: it must not be treated as some default tool.
    const noTool = JSON.stringify({ cwd: fx.staging, tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } });
    for (const input of ['not json', '[]', '{"hook_event_name":"PreToolUse"}', noTool, JSON.stringify({ tool_name: 'Write', tool_input: {} })]) {
      const result = runHook(fx, 'pre', input);
      assert.equal(result.code, 2, input);
      assert.notEqual(result.stderr.trim(), '');
      assert.equal(result.stdout, '');
    }
    assert.match(runHook(fx, 'pre', noTool).stderr, /no tool_name/);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });

  it('exits 2 when the policy file is missing, unreadable JSON or malformed, or no policy is named', () => {
    const fx = fixture();
    const input = { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } };
    assert.equal(runHook(fx, 'pre', input, join(fx.dir, 'absent.json')).code, 2);
    const broken = join(fx.dir, 'broken.json');
    writeFileSync(broken, '{not json');
    assert.equal(runHook(fx, 'pre', input, broken).code, 2);
    const wrong = join(fx.dir, 'wrong.json');
    writeFileSync(wrong, JSON.stringify({ schema: 1 }));
    const refused = runHook(fx, 'pre', input, wrong);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /hook policy needs a string onboardingId/, 'the refusal names the policy problem, not a later crash');
    assert.equal(runHook(fx, 'pre', input, null).code, 2);
    assert.equal(runHook(fx, 'bogus', input).code, 2);
  });

  it('exits 2 when the ledger cannot be opened, and does not create one', () => {
    const fx = fixture();
    const missing = join(fx.dir, 'nowhere', 'state.db');
    const policyPath = join(fx.dir, 'p2.json');
    writeFileSync(policyPath, JSON.stringify({ ...fx.policy, ledgerPath: missing }));
    const result = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } }, policyPath);
    assert.equal(result.code, 2);
    assert.equal(existsSync(missing), false);
    // A missing file in a directory that exists: opening it would create an empty database, so it must be refused first.
    const absent = join(fx.dir, 'data', 'absent-state.db');
    writeFileSync(policyPath, JSON.stringify({ ...fx.policy, ledgerPath: absent }));
    const noFile = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } }, policyPath);
    assert.equal(noFile.code, 2);
    assert.match(noFile.stderr, /does not exist/);
    assert.equal(existsSync(absent), false, 'refusing must not create an empty ledger');
    const notDb = join(fx.dir, 'garbage.db');
    writeFileSync(notDb, 'this is not a database'.repeat(50));
    writeFileSync(policyPath, JSON.stringify({ ...fx.policy, ledgerPath: notDb }));
    assert.equal(runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } }, policyPath).code, 2);
  });

  it('exits 2 when the ledger has no budget row for the run', () => {
    const fx = fixture({ noBudgets: true });
    const result = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } });
    assert.equal(result.code, 2);
  });

  it('refuses a ConfigChange event every time and records config.change.denied', () => {
    const fx = fixture();
    const result = runHook(fx, 'config-change', { source: 'project_settings', file_path: join(fx.staging, '.claude', 'settings.json') });
    assert.equal(result.code, 2);
    assert.notEqual(result.stderr.trim(), '');
    const [row] = eventRows(fx, 'config.change.denied');
    assert.ok(row);
    assert.equal(row.run_id, 'run_1');
    assert.equal(runHook(fx, 'config-change', 'garbage', join(fx.dir, 'absent.json')).code, 2);
  });

  it('keeps the hook entry lean: no import of the CLI or the application layer', () => {
    const source = readFileSync(HOOK_ENTRY, 'utf8');
    assert.equal(/from '\.\.\/cli|from '\.\.\/app/.test(source), false);
    assert.ok(source.includes('process.exit(2)'));
  });
});

// O-1 (01-MUTATION.md, fixed in 01-20): the contract's subagentsConcurrent binds in the hook. An Agent call is denied with rule
// budget:subagentsConcurrent when the invocation's in-flight subagents (admitted calls minus completed ones) are at the limit.
// A completion arrives as PostToolUse (success) or PostToolUseFailure (both run `--event post`) and frees a slot once; a background
// call is held for the invocation (its PostToolUse reports the launch, not the end); the count is per invocation ID.
describe('subagent concurrency (O-1)', () => {
  const agent = (toolUseId: string | undefined, extra: Record<string, unknown> = {}) => ({
    tool_name: 'Agent',
    ...(toolUseId !== undefined ? { tool_use_id: toolUseId } : {}),
    tool_input: { subagent_type: 'gsd-codebase-mapper', prompt: 'x', ...extra },
  });
  const reasonOf = (stdout: string): string => (stdout === '' ? 'allowed' : parsed(stdout).hookSpecificOutput.permissionDecisionReason);
  const pre = (fx: HookFixture, toolUseId: string | undefined, extra: Record<string, unknown> = {}, policyPath?: string): string =>
    reasonOf(runHook(fx, 'pre', agent(toolUseId, extra), policyPath).stdout);
  const done = (fx: HookFixture, toolUseId: string | undefined, extra: Record<string, unknown> = {}, event = 'PostToolUse'): void => {
    const result = runHook(fx, 'post', { ...agent(toolUseId, extra), hook_event_name: event, tool_response: { status: 'completed' } });
    assert.equal(result.code, 0, result.stderr);
  };
  const limited = (concurrent: number, total = 10): HookFixture => fixture({ limits: { subagentsTotal: total }, policy: { subagentsConcurrent: concurrent } });

  it('denies an Agent call when the in-flight subagents are at the limit, charging nothing for it', () => {
    const fx = limited(2);
    assert.equal(pre(fx, 'a1'), 'allowed');
    assert.equal(pre(fx, 'a2'), 'allowed');
    assert.equal(pre(fx, 'a3'), 'avarice: budget:subagentsConcurrent');
    assert.equal(budgetUsed(fx, 'subagentsTotal'), 2);
    const last = decisions(fx).at(-1);
    assert.deepEqual([last?.decision, last?.rule], ['deny', 'budget:subagentsConcurrent']);
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('a completed subagent frees its slot', () => {
    const fx = limited(2);
    pre(fx, 'a1');
    pre(fx, 'a2');
    done(fx, 'a1');
    assert.equal(pre(fx, 'a3'), 'allowed');
    assert.equal(pre(fx, 'a4'), 'avarice: budget:subagentsConcurrent');
    assert.equal(budgetUsed(fx, 'subagentsTotal'), 3);
  });

  it('a failed subagent (PostToolUseFailure) frees its slot too', () => {
    const fx = limited(1);
    pre(fx, 'a1');
    assert.equal(pre(fx, 'a2'), 'avarice: budget:subagentsConcurrent');
    done(fx, 'a1', {}, 'PostToolUseFailure');
    assert.equal(pre(fx, 'a2'), 'allowed');
    const [row] = eventRows(fx, 'tool.completed');
    assert.deepEqual(JSON.parse((row as { data_json: string }).data_json), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Agent', toolUseId: 'a1', subagentReleased: true, failed: true });
  });

  it('counts a completion exactly once: a repeated completion, an unknown ID and another tool free nothing', () => {
    const fx = limited(2);
    pre(fx, 'a1');
    pre(fx, 'a2');
    done(fx, 'a1');
    done(fx, 'a1');
    done(fx, 'a1', {}, 'PostToolUseFailure');
    done(fx, 'never-admitted');
    runHook(fx, 'post', { tool_name: 'Read', tool_use_id: 'a2', tool_input: { file_path: join(fx.staging, 'a') } });
    assert.equal(pre(fx, 'a3'), 'allowed');
    assert.equal(pre(fx, 'a4'), 'avarice: budget:subagentsConcurrent');
    const released = eventRows(fx, 'tool.completed').map((r) => JSON.parse(r.data_json) as Record<string, unknown>).filter((d) => d['subagentReleased'] === true);
    assert.equal(released.length, 1);
  });

  it('without a tool_use_id, a completion frees one slot and the count never goes below zero', () => {
    const fx = limited(2);
    pre(fx, undefined);
    pre(fx, undefined);
    done(fx, undefined);
    done(fx, undefined);
    done(fx, undefined);
    assert.equal(pre(fx, undefined), 'allowed');
    assert.equal(pre(fx, undefined), 'allowed');
    assert.equal(pre(fx, undefined), 'avarice: budget:subagentsConcurrent');
  });

  it('scopes the count to the invocation: a killed invocation leaves no phantom that blocks a later one', () => {
    const fx = limited(2);
    pre(fx, 'a1');
    pre(fx, 'a2');
    assert.equal(pre(fx, 'a3'), 'avarice: budget:subagentsConcurrent');
    const later = join(fx.dir, 'hook-policy-inv2.json');
    writeFileSync(later, JSON.stringify({ ...fx.policy, invocationId: 'inv_2' }), { mode: 0o600 });
    assert.equal(pre(fx, 'b1', {}, later), 'allowed');
    assert.equal(pre(fx, 'b2', {}, later), 'allowed');
    assert.equal(pre(fx, 'b3', {}, later), 'avarice: budget:subagentsConcurrent');
    // a completion in the later invocation does not release a slot of the first one
    done(fx, 'a1', {}, 'PostToolUse');
    const lateDone = runHook(fx, 'post', { ...agent('b1'), tool_response: {} }, later);
    assert.equal(lateDone.code, 0);
    assert.equal(pre(fx, 'a4'), 'allowed');
    assert.equal(pre(fx, 'a5'), 'avarice: budget:subagentsConcurrent');
  });

  it('holds a background subagent for the rest of the invocation, because its PostToolUse reports the launch', () => {
    const fx = limited(2);
    assert.equal(pre(fx, 'bg1', { run_in_background: true }), 'allowed');
    assert.equal(pre(fx, 'a1'), 'allowed');
    done(fx, 'bg1', { run_in_background: true });
    done(fx, 'a1');
    assert.equal(pre(fx, 'a2'), 'allowed');
    assert.equal(pre(fx, 'a3'), 'avarice: budget:subagentsConcurrent');
    const bg = eventRows(fx, 'tool.completed').map((r) => JSON.parse(r.data_json) as Record<string, unknown>).find((d) => d['toolUseId'] === 'bg1');
    assert.equal(bg?.['subagentReleased'], false);
  });

  it('holds a background subagent even when its completion carries no run_in_background of its own', () => {
    const fx = limited(1);
    assert.equal(pre(fx, 'bg1', { run_in_background: true }), 'allowed');
    runHook(fx, 'post', { tool_name: 'Agent', tool_use_id: 'bg1', tool_input: { subagent_type: 'gsd-codebase-mapper', prompt: 'x' }, tool_response: {} });
    assert.equal(pre(fx, 'a1'), 'avarice: budget:subagentsConcurrent');
  });

  it('without tool_use_ids, the completion of a background call does not free the slot of a foreground one', () => {
    const fx = limited(2);
    pre(fx, undefined);
    pre(fx, undefined, { run_in_background: true });
    done(fx, undefined, { run_in_background: true });
    assert.equal(pre(fx, undefined), 'avarice: budget:subagentsConcurrent');
    done(fx, undefined);
    assert.equal(pre(fx, undefined), 'allowed');
  });

  it('a completion that reports background is held even for a call admitted as foreground', () => {
    const fx = limited(1);
    pre(fx, 'a1');
    done(fx, 'a1', { run_in_background: true });
    assert.equal(pre(fx, 'a2'), 'avarice: budget:subagentsConcurrent');
  });

  it('a limit of zero admits no subagent, and the total budget is reported first when it is also spent', () => {
    assert.equal(pre(limited(0), 'a1'), 'avarice: budget:subagentsConcurrent');
    const fx = limited(2, 2);
    pre(fx, 'a1');
    pre(fx, 'a2');
    assert.equal(pre(fx, 'a3'), 'avarice: budget_exhausted');
  });

  it('admits exactly the limit when the calls race (BEGIN IMMEDIATE serializes the check and the charge)', async () => {
    const fx = limited(3);
    const results = await Promise.all(Array.from({ length: 8 }, (_, n) => runHookAsync(fx, 'pre', agent(`r${n}`))));
    assert.ok(results.every((r) => r.code === 0));
    assert.equal(results.filter((r) => r.stdout === '').length, 3);
    assert.equal(results.filter((r) => /budget:subagentsConcurrent/.test(r.stdout)).length, 5);
    assert.equal(budgetUsed(fx, 'subagentsTotal'), 3);
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('records the completion of a subagent with IDs only and keeps the chain', () => {
    const fx = limited(2);
    pre(fx, 'a1');
    done(fx, 'a1');
    const [row] = eventRows(fx, 'tool.completed');
    assert.deepEqual(JSON.parse((row as { data_json: string }).data_json), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Agent', toolUseId: 'a1', subagentReleased: true });
    assert.ok(chainIsIntact(fx.ledgerPath));
  });
});

describe('writeHookPolicy carries the concurrency limit (O-1)', () => {
  it('writes the scope limit as subagentsConcurrent, and 0 for the intel and knowledge invocations', () => {
    const fx = fixture();
    for (const [purpose, expected] of [['map', 4], ['intel', 0], ['knowledge', 0]] as const) {
      const scope = computeInvocationScope({
        purpose,
        contract: contractFor(),
        stagingPath: fx.staging,
        repoPath: fx.repo,
        dataRoot: join(fx.dir, 'data'),
        home: join(fx.dir, 'home'),
      workRoot: join(fx.dir, 'work'),
        workspace: { topLevelEntries: ['src', '.planning'], planningEntries: ['codebase'], gitPaths: [], repoReadAllow: [] },
        readRoots: [],
      });
      const written = writeHookPolicy(join(fx.dir, `inv-${purpose}`), scope, { onboardingId: 'onb_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: [] }, fx.ledgerPath);
      assert.ok(written.ok);
      assert.equal(written.value.policy.subagentsConcurrent, expected, purpose);
      assert.equal((JSON.parse(readFileSync(written.value.file, 'utf8')) as HookPolicy).subagentsConcurrent, expected, purpose);
    }
  });
});

describe('events: attribution, no payloads, hash chain (S-31, T-01-35)', () => {
  it('records tool.completed with the staging-relative target of a write', () => {
    const fx = fixture();
    const result = runHook(fx, 'post', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, 'STACK.md'), content: 'SECRET-CONTENT' }, tool_response: { filePath: 'x', output: 'SECRET-OUTPUT' } });
    assert.equal(result.code, 0, result.stderr);
    const [row] = eventRows(fx, 'tool.completed');
    assert.ok(row);
    assert.equal(row.run_id, 'run_1');
    assert.deepEqual(JSON.parse(row.data_json), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Write', target: '.planning/codebase/STACK.md' });
    const outside = runHook(fx, 'post', { tool_name: 'Write', tool_input: { file_path: join(fx.dir, 'elsewhere.txt'), content: 'x' } });
    assert.equal(outside.code, 0, outside.stderr);
    const last = JSON.parse((eventRows(fx, 'tool.completed').at(-1) as { data_json: string }).data_json) as Record<string, unknown>;
    assert.equal('target' in last, false);
    assert.equal(last['outsideStaging'], true);
  });

  it('never stores tool input, file content, a command or its output, even for very long inputs', () => {
    const fx = fixture();
    const long = 'L'.repeat(3000);
    const segment = 'L'.repeat(200);
    runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, 'a.md'), content: 'MARKER-CONTENT' } });
    runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command: `echo MARKER-COMMAND ${long} > x`, description: 'MARKER-DESC' } });
    runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.staging, segment, segment, 'z.ts'), content: 'MARKER-CONTENT-2' } });
    runHook(fx, 'post', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, segment, segment, segment, 'z.md'), content: 'MARKER-CONTENT-3' }, tool_response: 'MARKER-RESPONSE' });
    runHook(fx, 'post', { tool_name: 'Bash', tool_input: { command: 'cat MARKER-COMMAND-2' }, tool_response: { stdout: 'MARKER-STDOUT' } });
    const all = eventRows(fx).map((r) => r.data_json).join('\n');
    assert.ok(eventRows(fx).length >= 4);
    assert.equal(/MARKER/.test(all), false);
    assert.equal(all.includes('L'.repeat(300)), false);
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('continues the ledger hash chain and every row_hash recomputes', () => {
    const fx = fixture();
    const opened = openDb(fx.ledgerPath);
    assert.ok(opened.ok);
    const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}x`);
    assert.ok(ledger.appendEvent({ type: 'before', runId: 'run_1', data: { n: 1 }, nowMs: 1_000 }).ok);
    opened.value.close();
    runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } });
    runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.staging, 'src', 'a.ts'), content: 'x' } });
    runHook(fx, 'post', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'a') } });
    const reopened = openDb(fx.ledgerPath);
    assert.ok(reopened.ok);
    const again = new SqliteLedger(reopened.value, (prefix) => `${prefix}x`);
    assert.ok(again.appendEvent({ type: 'after', runId: 'run_1', data: { n: 2 }, nowMs: 2_000 }).ok);
    reopened.value.close();
    assert.deepEqual(eventRows(fx).map((r) => r.type), ['before', 'hook.decision', 'hook.decision', 'tool.completed', 'after']);
    assert.ok(chainIsIntact(fx.ledgerPath));
  });
});

describe('writeHookPolicy', () => {
  it('writes hook-policy.json with mode 0600, canonical paths, the preamble fingerprint and the agent set', () => {
    const fx = fixture();
    const link = join(fx.dir, 'staging-link');
    symlinkSync(fx.staging, link);
    const scope = computeInvocationScope({
      purpose: 'map',
      contract: contractFor(),
      stagingPath: link,
      repoPath: fx.repo,
      dataRoot: join(fx.dir, 'data'),
      home: join(fx.dir, 'home'),
      workRoot: join(fx.dir, 'work'),
      workspace: { topLevelEntries: ['src', '.planning'], planningEntries: ['codebase'], gitPaths: [], repoReadAllow: [join(fx.repo, '.git')] },
      readRoots: [],
    });
    const invDir = join(fx.dir, 'inv');
    const written = writeHookPolicy(invDir, scope, { onboardingId: 'onb_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: ['gsd-codebase-mapper'] }, fx.ledgerPath, { sha256: 'a'.repeat(64), length: 99 });
    assert.ok(written.ok);
    assert.equal(written.value.file, join(invDir, 'hook-policy.json'));
    assert.equal(statSync(written.value.file).mode & 0o777, 0o600);
    const onDisk = JSON.parse(readFileSync(written.value.file, 'utf8')) as HookPolicy;
    assert.ok(parseHookPolicy(onDisk).ok);
    assert.equal(onDisk.stagingPath, fx.staging);
    assert.deepEqual(onDisk.writeRoots, [join(fx.staging, '.planning', 'codebase')]);
    assert.equal(onDisk.ledgerPath, fx.ledgerPath);
    assert.deepEqual(onDisk.subagentTypes, ['gsd-codebase-mapper']);
    assert.equal(onDisk.commands.preambleSha256, 'a'.repeat(64));
    assert.equal(onDisk.commands.preambleLength, 99);
    assert.equal(onDisk.commands.strategy, 'blanket-bash-hook-identity');
    assert.deepEqual(readdirSync(invDir), ['hook-policy.json']);
  });
});

// Decision B: the real hook entry, run as a child process with the policy the knowledge scope writes (no shell, reads confined to
// the corpus, one output directory, no subagent).
describe('the knowledge purpose policy through the real hook entry (decision B)', () => {
  function knowledgeFixture() {
    const probe = fixture();
    const corpus = join(probe.staging, '.avarice-knowledge');
    const out = join(corpus, '.extraction');
    mkdirSync(out, { recursive: true });
    mkdirSync(join(corpus, 'docs'), { recursive: true });
    const scope = computeInvocationScope({
      purpose: 'knowledge',
      contract: contractFor(),
      stagingPath: probe.staging,
      repoPath: probe.repo,
      dataRoot: join(probe.dir, 'data'),
      home: join(probe.dir, 'home'),
      workRoot: join(probe.dir, 'work'),
      workspace: { topLevelEntries: ['src', '.planning', '.avarice-knowledge'], planningEntries: ['codebase'], gitPaths: [], repoReadAllow: [] },
      readRoots: [],
    });
    const written = writeHookPolicy(join(probe.dir, 'inv-knowledge'), scope, { onboardingId: 'onb_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: [] }, probe.ledgerPath);
    assert.ok(written.ok, JSON.stringify(written));
    return { fx: probe, corpus, out, policyPath: written.value.file, policy: written.value.policy };
  }

  it('writes readConfine (canonical), the strategy none, no read-only command, no GSD verb and no subagent type', () => {
    const { policy, corpus } = knowledgeFixture();
    assert.deepEqual(policy.readConfine, [corpus]);
    assert.equal(policy.commands.strategy, 'none');
    assert.deepEqual(policy.commands.readOnly, []);
    assert.deepEqual(policy.commands.gsdReadVerbs, []);
    assert.deepEqual(policy.subagentTypes, []);
    assert.equal(policy.purpose, 'knowledge');
    assert.ok(parseHookPolicy(JSON.parse(JSON.stringify(policy))).ok);
  });

  it('denies Bash (shell-disabled) however harmless, charging nothing', () => {
    const { fx, policyPath, corpus } = knowledgeFixture();
    for (const command of ['ls', 'cat docs/a.md', `${PREAMBLE}\ngsd_run graphify status`]) {
      const result = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Bash', tool_input: { command } }, policyPath);
      assert.equal(result.code, 0, result.stderr);
      assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /shell-disabled/, command);
    }
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });

  it('allows a Read inside the corpus and a Write inside the extraction directory; denies a Read in staging outside the corpus and a Write in the corpus', () => {
    const { fx, policyPath, corpus, out } = knowledgeFixture();
    writeFileSync(join(corpus, 'docs', 'a.md'), '# a\n');
    const read = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Read', tool_input: { file_path: join(corpus, 'docs', 'a.md') } }, policyPath);
    assert.equal(read.stdout, '');
    const write = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Write', tool_input: { file_path: join(out, 'chunk-01.json'), content: '{}' } }, policyPath);
    assert.equal(write.stdout, '');
    assert.equal(budgetUsed(fx, 'toolCalls'), 2);
    const outside = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } }, policyPath);
    assert.match(parsed(outside.stdout).hookSpecificOutput.permissionDecisionReason, /outside-read-set/);
    const inCorpus = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Write', tool_input: { file_path: join(corpus, 'docs', 'a.md'), content: 'x' } }, policyPath);
    assert.match(parsed(inCorpus.stdout).hookSpecificOutput.permissionDecisionReason, /outside-write-set/);
    const glob = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Glob', tool_input: { pattern: '**/*.md' } }, policyPath);
    assert.equal(glob.stdout, '', 'a Glob with no path searches the working directory, which is the corpus');
    const staging = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Grep', tool_input: { pattern: 'x', path: fx.staging } }, policyPath);
    assert.match(parsed(staging.stdout).hookSpecificOutput.permissionDecisionReason, /outside-read-set/);
  });

  it('denies every subagent type, including general-purpose, which the graphify skill used to start', () => {
    const { fx, policyPath, corpus } = knowledgeFixture();
    for (const subagent_type of ['general-purpose', 'gsd-codebase-mapper']) {
      const result = runHook(fx, 'pre', { cwd: corpus, tool_name: 'Agent', tool_input: { subagent_type, prompt: 'x' } }, policyPath);
      assert.match(parsed(result.stdout).hookSpecificOutput.permissionDecisionReason, /subagent-type/, subagent_type);
    }
    assert.equal(budgetUsed(fx, 'subagentsTotal'), 0);
  });
});

// CR-02 / gap P-3 (D-GAP-01): the policy writer carries the scope's read roots and the real hook entry judges every read against
// staging, those roots and the re-allowed roots, so a credential file and a path nobody listed are outside the read set.
describe('the read allow-list through the real hook entry (CR-02, D-GAP-01)', () => {
  function allowListFixture() {
    const fx = fixture();
    const gsd = join(fx.dir, 'gsd');
    mkdirSync(gsd, { recursive: true });
    mkdirSync(join(fx.dir, 'home'), { recursive: true });
    mkdirSync(join(fx.dir, 'elsewhere'), { recursive: true });
    writeFileSync(join(gsd, 'x.md'), '# x\n');
    writeFileSync(join(fx.dir, 'home', '.netrc'), 'machine example password PRIVATE-MARKER\n');
    writeFileSync(join(fx.dir, 'elsewhere', 'x'), 'x\n');
    writeFileSync(join(fx.staging, 'src', 'a.ts'), 'export {};\n');
    const scope = computeInvocationScope({
      purpose: 'map',
      contract: contractFor(),
      stagingPath: fx.staging,
      repoPath: fx.repo,
      dataRoot: join(fx.dir, 'data'),
      home: join(fx.dir, 'home'),
      workRoot: join(fx.dir, 'work'),
      workspace: { topLevelEntries: ['src', '.planning'], planningEntries: ['codebase'], gitPaths: [], repoReadAllow: [] },
      readRoots: [gsd],
    });
    const written = writeHookPolicy(join(fx.dir, 'inv-allow'), scope, { onboardingId: 'onb_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: [] }, fx.ledgerPath);
    assert.ok(written.ok, JSON.stringify(written));
    return { fx, gsd, policyPath: written.value.file, policy: written.value.policy };
  }

  it('writes the scope read roots as canonical readRoots', () => {
    const { gsd, policyPath, policy } = allowListFixture();
    assert.deepEqual(policy.readRoots, [gsd]);
    const onDisk = JSON.parse(readFileSync(policyPath, 'utf8')) as HookPolicy;
    assert.deepEqual(onDisk.readRoots, [gsd]);
    assert.ok(parseHookPolicy(onDisk).ok);
  });

  it('denies a shell read of a credential file naming deny-read, and a Read of an unlisted path naming outside-read-set', () => {
    const { fx, policyPath } = allowListFixture();
    const netrc = runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command: `cat ${join(fx.dir, 'home', '.netrc')}` } }, policyPath);
    assert.equal(netrc.code, 0, netrc.stderr);
    // R-WR-03: ~/.netrc is a named credential location, so it is a denied root (it was refused only as outside the read set).
    assert.match(parsed(netrc.stdout).hookSpecificOutput.permissionDecisionReason, /deny-read/);
    const elsewhere = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.dir, 'elsewhere', 'x') } }, policyPath);
    assert.match(parsed(elsewhere.stdout).hookSpecificOutput.permissionDecisionReason, /outside-read-set/);
    const grep = runHook(fx, 'pre', { tool_name: 'Grep', tool_input: { pattern: 'x', path: fx.dir } }, policyPath);
    assert.match(parsed(grep.stdout).hookSpecificOutput.permissionDecisionReason, /outside-read-set/);
  });

  it('allows a staging read and a read under a read root, and charges them', () => {
    const { fx, gsd, policyPath } = allowListFixture();
    for (const command of [`cat ${join(gsd, 'x.md')}`, 'cat src/a.ts', `ls ${gsd}`]) {
      const result = runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command } }, policyPath);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '', command);
    }
    const read = runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(gsd, 'x.md') } }, policyPath);
    assert.equal(read.stdout, '');
    assert.equal(budgetUsed(fx, 'toolCalls'), 4);
  });

  it('keeps every path outside staging and every file content out of the hook.decision events', () => {
    const { fx, policyPath } = allowListFixture();
    runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command: `cat ${join(fx.dir, 'home', '.netrc')}` } }, policyPath);
    runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.dir, 'elsewhere', 'x') } }, policyPath);
    const rows = eventRows(fx, 'hook.decision');
    assert.equal(rows.length, 2);
    const all = rows.map((r) => r.data_json).join('\n');
    assert.equal(all.includes('.netrc'), false);
    assert.equal(all.includes('elsewhere'), false);
    assert.equal(all.includes('PRIVATE-MARKER'), false);
    assert.deepEqual(rows.map((r) => (JSON.parse(r.data_json) as { rule: string }).rule), ['deny-read', 'outside-read-set']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The run purpose (plan 02-08): the same hook entry, with the write set taken from the contract's globs (CON-2, CON-8, RC-5).
// ---------------------------------------------------------------------------------------------------------------

interface RunHookFixture {
  fx: HookFixture;
  clone: string;
  scratch: string;
  sibling: string;
  policyPath: string;
  policy: HookPolicy;
}

function runFixture(options: { commands?: string[]; policy?: Partial<HookPolicy> } = {}): RunHookFixture {
  const fx = fixture();
  const run = join(fx.dir, 'work', 'run_A');
  const clone = join(run, 'clone');
  const scratch = join(run, 'scratch');
  const sibling = join(fx.dir, 'work', 'run_A2', 'clone');
  for (const dir of ['src/hooks', 'src/lib', 'tests/unit', '.planning/quick', '.git']) mkdirSync(join(clone, dir), { recursive: true });
  for (const dir of [scratch, join(sibling, 'src', 'hooks'), join(fx.dir, 'outside')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(clone, 'package.json'), '{}');
  writeFileSync(join(clone, 'src', 'hooks', 'useSwipeStep.ts'), 'export {};\n');
  symlinkSync(join(fx.dir, 'outside'), join(clone, '.planning', 'quick', 'out'));
  const scope = computeRunScope({
    contract: {
      files: { write: ['src/hooks/useSwipeStep.ts', 'tests/unit/swipe-step.test.ts'], create: [], artifacts: ['.planning/quick/**'], protected: ['package.json', '.github/**'], secretGlobs: ['**/.env'] },
      execution: { commands: options.commands ?? ['npm run typecheck', 'npx vitest run <paths>'] },
      budgets: { subagentsTotal: 10, subagentsConcurrent: 2 },
    },
    clonePath: clone,
    repoPath: fx.repo,
    dataRoot: join(fx.dir, 'data'),
    home: join(fx.dir, 'home'),
    workRoot: join(fx.dir, 'work'),
    scratchDir: scratch,
    workspace: {
      topLevelEntries: ['.git', '.planning', 'package.json', 'src', 'tests'],
      entriesByDir: { src: ['hooks', 'lib'], 'src/hooks': ['useSwipeStep.ts'], tests: ['unit'], 'tests/unit': [], '.planning': ['quick'] },
      gitPaths: [join(clone, '.git')],
      repoReadAllow: [],
    },
    readRoots: [],
  });
  const written = writeHookPolicy(join(fx.dir, 'inv-run'), scope, { onboardingId: 'onb_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: ['gsd-executor'] }, fx.ledgerPath);
  assert.ok(written.ok, 'the run policy is written');
  const policy = { ...written.value.policy, ...options.policy };
  const policyPath = options.policy === undefined ? written.value.file : join(fx.dir, 'run-policy-override.json');
  if (options.policy !== undefined) writeFileSync(policyPath, JSON.stringify(policy));
  return { fx, clone, scratch, sibling, policyPath, policy };
}

describe('the run purpose through the real hook entry (CON-2, CON-8)', () => {
  const rule = (stdout: string): string => parsed(stdout).hookSpecificOutput.permissionDecisionReason;
  const call = (r: RunHookFixture, tool: string, input: Record<string, unknown>) => runHook(r.fx, 'pre', { tool_name: tool, tool_input: input, cwd: r.clone }, r.policyPath);

  it('writes the policy with the contract globs, the agent commands and the run-only denials', () => {
    const r = runFixture();
    assert.equal(r.policy.purpose, 'run');
    assert.deepEqual(r.policy.writeGlobs, ['src/hooks/useSwipeStep.ts', 'tests/unit/swipe-step.test.ts', '.planning/quick/**']);
    assert.deepEqual(r.policy.protectedGlobs, ['package.json', '.github/**', '.git/**', '.planning/config.json']);
    assert.deepEqual(r.policy.agentCommands, [
      { words: ['npm', 'run', 'typecheck'], paths: false },
      { words: ['npx', 'vitest', 'run'], paths: true },
    ]);
    assert.deepEqual(r.policy.deniedTools, ['AskUserQuestion']);
    assert.equal(r.policy.denyBackgroundShell, true);
    assert.equal(r.policy.readBeforeEdit, true);
    assert.deepEqual(r.policy.loopLimits, { consecutiveDenials: 3, consecutiveSearches: 25 });
    assert.ok(r.policy.writeRoots.includes(r.scratch), 'the scratch directory is a write root');
    assert.equal(parseHookPolicy(JSON.parse(readFileSync(r.policyPath, 'utf8'))).ok, true);
  });

  it('allows an Edit on a file in the write set with rule write-set, and charges one toolCalls unit', () => {
    const r = runFixture();
    const target = join(r.clone, 'src', 'hooks', 'useSwipeStep.ts');
    // The run purpose requires a recorded read before an edit (plan 02-11); the file is read first, as a model would.
    assert.equal(runHook(r.fx, 'post', { tool_name: 'Read', tool_input: { file_path: target }, cwd: r.clone }, r.policyPath).code, 0);
    const result = call(r, 'Edit', { file_path: target, old_string: 'a', new_string: 'b' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(budgetUsed(r.fx, 'toolCalls'), 1);
    assert.deepEqual(decisions(r.fx).map((d) => [d.decision, d.rule]), [['allow', 'write-set']]);
  });

  it('denies an Edit outside the write set with outside-write-set, and a Write to a protected path with protected-path', () => {
    const r = runFixture();
    const outside = call(r, 'Edit', { file_path: join(r.clone, 'src', 'lib', 'x.ts'), old_string: 'a', new_string: 'b' });
    assert.match(rule(outside.stdout), /outside-write-set/);
    const protectedPath = call(r, 'Write', { file_path: join(r.clone, 'package.json'), content: '{}' });
    assert.match(rule(protectedPath.stdout), /protected-path/);
    const git = call(r, 'Write', { file_path: join(r.clone, '.git', 'config'), content: 'x' });
    assert.match(rule(git.stdout), /protected-path/);
    const notebook = call(r, 'NotebookEdit', { notebook_path: join(r.clone, 'package.json'), new_source: 'x' });
    assert.match(rule(notebook.stdout), /protected-path/);
    assert.equal(budgetUsed(r.fx, 'toolCalls'), 0);
  });

  it('allows a Write under an artifact glob and in the scratch directory', () => {
    const r = runFixture();
    const artifact = call(r, 'Write', { file_path: join(r.clone, '.planning', 'quick', '1', 'PLAN.md'), content: 'x' });
    assert.equal(artifact.code, 0, artifact.stderr);
    assert.equal(artifact.stdout, '');
    const scratch = call(r, 'Write', { file_path: join(r.scratch, 'tmp', 'x.txt'), content: 'x' });
    assert.equal(scratch.stdout, '');
    assert.equal(budgetUsed(r.fx, 'toolCalls'), 2);
  });

  it('denies a path that is a sibling run clone sharing the run ID prefix, and the repository files outside every root', () => {
    const r = runFixture();
    const sibling = call(r, 'Write', { file_path: join(r.sibling, 'src', 'hooks', 'useSwipeStep.ts'), content: 'x' });
    assert.match(rule(sibling.stdout), /outside-write-set/);
    const evil = call(r, 'Write', { file_path: join(r.clone, 'src-evil', 'x.ts'), content: 'x' });
    assert.match(rule(evil.stdout), /outside-write-set/);
  });

  it('denies a relative path with .. that leaves the clone, and a symlink inside the clone that points outside (CON-8)', () => {
    const r = runFixture();
    const dotdot = call(r, 'Write', { file_path: 'src/hooks/../../../outside.ts', content: 'x' });
    assert.match(rule(dotdot.stdout), /outside-write-set/);
    const viaSymlink = call(r, 'Write', { file_path: join(r.clone, '.planning', 'quick', 'out', 'x.ts'), content: 'x' });
    assert.match(rule(viaSymlink.stdout), /outside-write-set/);
    const symlinkItself = call(r, 'Write', { file_path: join(r.clone, '.planning', 'quick', 'out'), content: 'x' });
    assert.match(rule(symlinkItself.stdout), /outside-write-set/);
  });

  it('admits a contract command and refuses npm forms beyond it, git commit and a background shell, charging only the admitted one', () => {
    const r = runFixture();
    const typecheck = call(r, 'Bash', { command: 'npm run typecheck' });
    assert.equal(typecheck.code, 0, typecheck.stderr);
    assert.equal(typecheck.stdout, '');
    assert.deepEqual(decisions(r.fx).map((d) => [d.decision, d.rule]), [['allow', 'agent-command']]);
    assert.match(rule(call(r, 'Bash', { command: 'npm install left-pad' }).stdout), /shell-not-allowed/);
    assert.match(rule(call(r, 'Bash', { command: 'git commit -m x' }).stdout), /shell-denied-prefix/);
    assert.match(rule(call(r, 'Bash', { command: 'npm run typecheck', run_in_background: true }).stdout), /background-shell/);
    assert.equal(budgetUsed(r.fx, 'toolCalls'), 1);
  });

  it('denies AskUserQuestion with no-human-prompts', () => {
    const r = runFixture();
    assert.match(rule(call(r, 'AskUserQuestion', { questions: [] }).stdout), /no-human-prompts/);
  });
});
