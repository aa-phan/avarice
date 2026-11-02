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
import { computeInvocationScope } from '../../src/domain/invocation-scope.ts';
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
    for (const input of ['not json', '[]', '{"hook_event_name":"PreToolUse"}', JSON.stringify({ tool_name: 'Write', tool_input: {} })]) {
      const result = runHook(fx, 'pre', input);
      assert.equal(result.code, 2, input);
      assert.notEqual(result.stderr.trim(), '');
      assert.equal(result.stdout, '');
    }
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
    assert.equal(runHook(fx, 'pre', input, wrong).code, 2);
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
