// The agent's own searches under a run's retrieval limits, through the real hook entry (src/hook/pre-tool-use.ts) against a temp
// ledger (plan 04-29; CON-10, CON-11, S-16, CS-16, T-04-80, T-04-81). Every Grep and Glob charges `retrieval.searches` in the
// same transaction as `toolCalls`; an unfiltered whole-repository search needs the contract's `retrieval.broadDiscovery`, and is
// allowed once. No model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import type { HookPolicy } from '../../src/domain/hook-decision.ts';
import { computeInvocationScope, computeRunScope } from '../../src/domain/invocation-scope.ts';
import type { RunScopeInput } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { RETRIEVAL_CAPS } from '../../src/domain/retrieval-rules.ts';
import { budgetUsed, chainIsIntact, eventRows, makeHookFixture, runHook, runHookAsync } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
const retrievalFixture = (searches: number, broadDiscovery: boolean, extra: Parameters<typeof makeHookFixture>[0] = {}): HookFixture => {
  const fx = makeHookFixture({
    ...extra,
    limits: { 'retrieval.searches': searches, 'retrieval.broadDiscovery': broadDiscovery ? 1 : 0, 'retrieval.fullReads': RETRIEVAL_CAPS.fullReads, 'retrieval.fullReadBytes': RETRIEVAL_CAPS.fullReadBytes, ...extra.limits },
    policy: { purpose: 'run', retrieval: { searches, broadDiscovery }, ...extra.policy },
  });
  fixtures.push(fx);
  return fx;
};
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

interface Deny {
  hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
}
// The rule a call was refused with, or 'allowed' when the hook printed nothing.
function outcome(stdout: string): string {
  if (stdout === '') return 'allowed';
  const out = (JSON.parse(stdout) as Deny).hookSpecificOutput;
  if (out.permissionDecision !== 'deny') return `explicit ${out.permissionDecision}`;
  const rule = /^avarice: (retrieval:[a-z-]+|budget:[A-Za-z.]+|[a-z_-]+)/.exec(out.permissionDecisionReason);
  return rule?.[1] ?? out.permissionDecisionReason;
}
const scoped = (fx: HookFixture) => ({ tool_name: 'Grep', tool_input: { pattern: 'needle', path: join(fx.staging, 'src'), glob: '*.ts' } });
const unfiltered = { tool_name: 'Grep', tool_input: { pattern: 'needle' } };

function decisions(fx: HookFixture): Array<{ tool: string; decision: string; rule: string; budget?: string }> {
  return eventRows(fx, 'hook.decision').map((r) => JSON.parse(r.data_json));
}

describe('tracer: a run Grep is charged to retrieval.searches and denied once the row is spent (CON-10, CON-11)', () => {
  it('allows three scoped searches and denies the fourth with budget:retrieval.searches; the row ends at used 3', () => {
    const fx = retrievalFixture(3, false);
    for (let n = 0; n < 3; n += 1) assert.equal(outcome(runHook(fx, 'pre', scoped(fx)).stdout), 'allowed', `search ${n + 1}`);
    const fourth = runHook(fx, 'pre', scoped(fx));
    assert.equal(fourth.code, 0, fourth.stderr);
    assert.equal(outcome(fourth.stdout), 'budget:retrieval.searches');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 3);
    assert.equal(budgetUsed(fx, 'toolCalls'), 3, 'a refused search charges nothing, not even a tool call');
    assert.deepEqual(decisions(fx).at(-1), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Grep', decision: 'deny', rule: 'budget:retrieval.searches', budget: 'retrieval.searches' });
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('charges a Glob the same way', () => {
    const fx = retrievalFixture(1, false);
    const glob = { tool_name: 'Glob', tool_input: { pattern: 'src/**/*.ts' } };
    assert.equal(outcome(runHook(fx, 'pre', glob).stdout), 'allowed');
    assert.equal(outcome(runHook(fx, 'pre', glob).stdout), 'budget:retrieval.searches');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1);
  });

  it('does not charge retrieval.searches for a Read', () => {
    const fx = retrievalFixture(3, false);
    assert.equal(outcome(runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } }).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
  });

  it('fails closed (exit 2) when the policy names retrieval limits and the ledger has no retrieval.searches row', () => {
    const fx = makeHookFixture({ policy: { purpose: 'run', retrieval: { searches: 3, broadDiscovery: false } } });
    fixtures.push(fx);
    const result = runHook(fx, 'pre', scoped(fx));
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no retrieval\.searches budget/);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });
});

// A file of `size` bytes under the clone, and the Read call that names it.
function fileOf(fx: HookFixture, name: string, size: number): string {
  const path = join(fx.staging, 'src', name);
  mkdirSync(join(fx.staging, 'src'), { recursive: true });
  writeFileSync(path, 'a'.repeat(size));
  return path;
}
const readOf = (file_path: string, extra: Record<string, unknown> = {}) => ({ tool_name: 'Read', tool_input: { file_path, ...extra } });

describe('tracer: a run Read is charged to the whole-file rows and the 21st is refused (WR-11, CON-10, CON-11, D-09)', () => {
  it('allows twenty Reads of a 10-byte file and denies the 21st with budget:retrieval.fullReads; the rows end at 20, 200 and 20 tool calls', () => {
    const fx = retrievalFixture(3, false);
    const ten = fileOf(fx, 'ten.txt', 10);
    for (let n = 0; n < 20; n += 1) assert.equal(outcome(runHook(fx, 'pre', readOf(ten)).stdout), 'allowed', `read ${n + 1}`);
    const last = runHook(fx, 'pre', readOf(ten));
    assert.equal(last.code, 0, last.stderr);
    assert.equal(outcome(last.stdout), 'budget:retrieval.fullReads');
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 20);
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 200);
    assert.equal(budgetUsed(fx, 'toolCalls'), 20, 'a refused read charges nothing, not even a tool call');
    assert.deepEqual(decisions(fx).at(-1), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Read', decision: 'deny', rule: 'budget:retrieval.fullReads', budget: 'retrieval.fullReads' });
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('records the allowed Read as charging toolCalls with retrieval.fullReads and retrieval.fullReadBytes alongside', () => {
    const fx = retrievalFixture(3, false);
    assert.equal(outcome(runHook(fx, 'pre', readOf(fileOf(fx, 'ten.txt', 10))).stdout), 'allowed');
    const allowed = eventRows(fx, 'hook.decision').map((r) => JSON.parse(r.data_json) as Record<string, unknown>).at(-1);
    assert.equal(allowed?.['budget'], 'toolCalls');
    assert.deepEqual(allowed?.['alsoCharged'], ['retrieval.fullReads', 'retrieval.fullReadBytes']);
  });
});

// The lines of a file as text: `count` lines of `width` bytes each, the newline included.
const linesOf = (count: number, width: number): string => `${'b'.repeat(width - 1)}\n`.repeat(count);
function textFile(fx: HookFixture, name: string, text: string): string {
  const path = join(fx.staging, 'src', name);
  mkdirSync(join(fx.staging, 'src'), { recursive: true });
  writeFileSync(path, text);
  return path;
}
const CAP_BYTES = RETRIEVAL_CAPS.fullReadBytes;

describe('the byte cap at and one past its limit (WR-11, D-09)', () => {
  it('allows reads totalling exactly 262144 bytes and denies the next Read of a 1-byte file with budget:retrieval.fullReadBytes, leaving the row at 262144', () => {
    const fx = retrievalFixture(3, false);
    const big = fileOf(fx, 'big.txt', 65536);
    for (let n = 0; n < 4; n += 1) assert.equal(outcome(runHook(fx, 'pre', readOf(big)).stdout), 'allowed', `read ${n + 1}`);
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), CAP_BYTES);
    assert.equal(outcome(runHook(fx, 'pre', readOf(fileOf(fx, 'one.txt', 1))).stdout), 'budget:retrieval.fullReadBytes');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), CAP_BYTES);
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 4);
    assert.equal(budgetUsed(fx, 'toolCalls'), 4, 'a refused read charges nothing');
  });

  it('in a fresh run denies a single Read of a 262145-byte file with no newline, charging nothing, and allows one of 262144 bytes', () => {
    const fx = retrievalFixture(3, false);
    assert.equal(outcome(runHook(fx, 'pre', readOf(fileOf(fx, 'over.txt', CAP_BYTES + 1))).stdout), 'budget:retrieval.fullReadBytes');
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 0);
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.equal(outcome(runHook(fx, 'pre', readOf(fileOf(fx, 'exact.txt', CAP_BYTES))).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), CAP_BYTES);
  });

  it('names retrieval.fullReads first when the file row and the byte row both have no room, and budget_exhausted when toolCalls has none either', () => {
    const both = retrievalFixture(3, false, { limits: { 'retrieval.fullReads': 0, 'retrieval.fullReadBytes': 0 } });
    assert.equal(outcome(runHook(both, 'pre', readOf(fileOf(both, 'ten.txt', 10))).stdout), 'budget:retrieval.fullReads');
    const all = retrievalFixture(3, false, { limits: { toolCalls: 0, 'retrieval.fullReads': 0, 'retrieval.fullReadBytes': 0 } });
    assert.equal(outcome(runHook(all, 'pre', readOf(fileOf(all, 'ten.txt', 10))).stdout), 'budget_exhausted');
    assert.equal(budgetUsed(all, 'retrieval.fullReads'), 0);
  });
});

describe('a Read is charged the bytes of the lines it asks for (WR-11)', () => {
  it('charges 50 bytes for offset 11 and limit 5 of a file of 100 lines of 10 bytes', () => {
    const fx = retrievalFixture(3, false);
    assert.equal(outcome(runHook(fx, 'pre', readOf(textFile(fx, 'hundred.txt', linesOf(100, 10)), { offset: 11, limit: 5 })).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 50);
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 1);
  });

  it('charges the first 2000 lines of a 3000-line file for a Read with neither offset nor limit', () => {
    const fx = retrievalFixture(3, false);
    assert.equal(outcome(runHook(fx, 'pre', readOf(textFile(fx, 'long.txt', linesOf(3000, 20)))).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 40_000);
  });

  it('charges a limit alone from the first line, an offset alone to 2000 lines past it, and never more than the file holds', () => {
    const fx = retrievalFixture(10, false);
    const file = textFile(fx, 'long.txt', linesOf(3000, 20));
    assert.equal(outcome(runHook(fx, 'pre', readOf(file, { limit: 3 })).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 60);
    assert.equal(outcome(runHook(fx, 'pre', readOf(file, { offset: 2500 })).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 60 + 501 * 20);
    assert.equal(outcome(runHook(fx, 'pre', readOf(file, { offset: 5000, limit: 50 })).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 60 + 501 * 20, 'a range past the end of the file holds no bytes');
  });

  it('ignores an offset or limit that is not a positive whole number and charges the default range', () => {
    const fx = retrievalFixture(10, false);
    const file = textFile(fx, 'hundred.txt', linesOf(100, 10));
    for (const extra of [{ offset: 0 }, { offset: -3 }, { offset: 1.5 }, { limit: '5' }, { limit: 0 }]) {
      assert.equal(outcome(runHook(fx, 'pre', readOf(file, extra)).stdout), 'allowed', JSON.stringify(extra));
    }
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 5 * 1000);
  });

  it('refuses a range it cannot measure within 64 MiB of scanning, and charges nothing (T-04-144)', () => {
    const fx = retrievalFixture(3, false);
    const file = join(fx.staging, 'src', 'newlines.txt');
    mkdirSync(join(fx.staging, 'src'), { recursive: true });
    writeFileSync(file, Buffer.alloc(64 * 1024 * 1024 + 100, 10));
    assert.equal(outcome(runHook(fx, 'pre', readOf(file, { offset: 64 * 1024 * 1024 + 50, limit: 5 })).stdout), 'budget:retrieval.fullReadBytes');
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 0);
    assert.equal(outcome(runHook(fx, 'pre', readOf(file, { offset: 1000, limit: 5 })).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 5);
  });
});

describe('a Read of a path with no bytes to count (WR-11 empty edge)', () => {
  it('charges one file and 0 bytes for a path that does not exist, a directory and a 0-byte file', () => {
    const fx = retrievalFixture(3, false);
    const empty = textFile(fx, 'empty.txt', '');
    for (const path of [join(fx.staging, 'src', 'missing.txt'), join(fx.staging, 'src'), empty]) assert.equal(outcome(runHook(fx, 'pre', readOf(path)).stdout), 'allowed', path);
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 3);
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 3);
  });

  it('allows a Read of 0 bytes where the byte row is spent, and refuses one of a byte', () => {
    const fx = retrievalFixture(3, false, { limits: { 'retrieval.fullReadBytes': 0 } });
    assert.equal(outcome(runHook(fx, 'pre', readOf(textFile(fx, 'empty.txt', ''))).stdout), 'allowed');
    assert.equal(outcome(runHook(fx, 'pre', readOf(fileOf(fx, 'one.txt', 1))).stdout), 'budget:retrieval.fullReadBytes');
  });

  it('exits 2 when a regular file cannot be opened to be measured', { skip: process.getuid?.() === 0 }, () => {
    const fx = retrievalFixture(3, false);
    const locked = fileOf(fx, 'locked.txt', 10);
    chmodSync(locked, 0o000);
    const result = runHook(fx, 'pre', readOf(locked));
    chmodSync(locked, 0o600);
    assert.equal(result.code, 2);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });
});

describe('the ledger must hold the whole-file rows of a run with retrieval limits (WR-11, fail closed)', () => {
  const read = (fx: HookFixture) => runHook(fx, 'pre', readOf(join(fx.staging, 'src', 'a.ts')));

  it('exits 2 when retrieval.fullReads is missing, and when retrieval.fullReadBytes is missing', () => {
    const noFiles = makeHookFixture({ limits: { 'retrieval.searches': 3, 'retrieval.fullReadBytes': CAP_BYTES }, policy: { purpose: 'run', retrieval: { searches: 3, broadDiscovery: false } } });
    const noBytes = makeHookFixture({ limits: { 'retrieval.searches': 3, 'retrieval.fullReads': 20 }, policy: { purpose: 'run', retrieval: { searches: 3, broadDiscovery: false } } });
    fixtures.push(noFiles, noBytes);
    const first = read(noFiles);
    assert.equal(first.code, 2);
    assert.match(first.stderr, /no retrieval\.fullReads budget/);
    const second = read(noBytes);
    assert.equal(second.code, 2);
    assert.match(second.stderr, /no retrieval\.fullReadBytes budget/);
    assert.equal(budgetUsed(noFiles, 'toolCalls'), 0);
    assert.equal(budgetUsed(noBytes, 'toolCalls'), 0);
  });

  it('charges neither row for a policy without a retrieval block (an onboarding invocation or an older contract)', () => {
    const fx = makeHookFixture({ limits: { 'retrieval.fullReads': 20, 'retrieval.fullReadBytes': CAP_BYTES } });
    fixtures.push(fx);
    assert.equal(outcome(runHook(fx, 'pre', readOf(fileOf(fx, 'ten.txt', 10))).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.fullReads'), 0);
    assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
  });
});

describe('broad discovery (CON-10, S-16, T-04-81)', () => {
  it('denies a Grep with no path and no filter as retrieval:broad-discovery-not-authorized, charging nothing', () => {
    const fx = retrievalFixture(3, false);
    const result = runHook(fx, 'pre', unfiltered);
    assert.equal(outcome(result.stdout), 'retrieval:broad-discovery-not-authorized');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('treats the clone root named as the path, with `.` or a trailing slash, as the same whole-repository search', () => {
    const fx = retrievalFixture(3, false);
    for (const path of [fx.staging, `${fx.staging}/`, `${fx.staging}/.`, '.']) {
      const out = outcome(runHook(fx, 'pre', { tool_name: 'Grep', tool_input: { pattern: 'x', path } }).stdout);
      assert.equal(out, 'retrieval:broad-discovery-not-authorized', path);
    }
  });

  it('treats a root search filtered by a glob, a type or a directory as scoped', () => {
    const fx = retrievalFixture(10, false);
    const scopedCalls = [
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', type: 'ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', path: join(fx.staging, 'src') } },
      { tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } },
    ];
    for (const call of scopedCalls) assert.equal(outcome(runHook(fx, 'pre', call).stdout), 'allowed', JSON.stringify(call));
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('treats a Glob that matches every file at the root as unfiltered', () => {
    const fx = retrievalFixture(10, false);
    for (const pattern of ['**/*', '*', '**']) {
      assert.equal(outcome(runHook(fx, 'pre', { tool_name: 'Glob', tool_input: { pattern } }).stdout), 'retrieval:broad-discovery-not-authorized', pattern);
    }
  });

  it('with broadDiscovery true allows the first unfiltered search once, charging searches and broadDiscovery, and denies the second as retrieval:broad-discovery-spent', () => {
    const fx = retrievalFixture(5, true);
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1);
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'retrieval:broad-discovery-spent');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1, 'a refused broad search leaves the search count as it was');
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
    assert.equal(outcome(runHook(fx, 'pre', scoped(fx)).stdout), 'allowed', 'a scoped search is still allowed after the discovery is spent');
  });

  it('a broad search whose searches are spent is denied budget:retrieval.searches and does not spend the discovery', () => {
    const fx = retrievalFixture(1, true);
    assert.equal(outcome(runHook(fx, 'pre', scoped(fx)).stdout), 'allowed');
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'budget:retrieval.searches');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });
});

describe('tracer: a Grep whose glob matches every file is a broad discovery (WR-06, CON-10, T-04-131)', () => {
  const EVERY_FILE_GLOBS = ['*', '**', '**/*', '*.*', './**/*', '{*,.*}'];
  const rootGrep = (glob: string) => ({ tool_name: 'Grep', tool_input: { pattern: 'x', glob } });

  it('without broadDiscovery denies each every-file glob at the clone root as retrieval:broad-discovery-not-authorized, charging nothing', () => {
    const fx = retrievalFixture(10, false);
    for (const glob of EVERY_FILE_GLOBS) assert.equal(outcome(runHook(fx, 'pre', rootGrep(glob)).stdout), 'retrieval:broad-discovery-not-authorized', glob);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('with broadDiscovery allows the first every-file Grep, charging searches and broadDiscovery, and denies the second as retrieval:broad-discovery-spent', () => {
    const fx = retrievalFixture(5, true);
    assert.equal(outcome(runHook(fx, 'pre', rootGrep('**/*')).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
    assert.equal(outcome(runHook(fx, 'pre', rootGrep('*')).stdout), 'retrieval:broad-discovery-spent');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
  });

  it('keeps a Grep with a real glob or a type a filtered search, charged to retrieval.searches only', () => {
    const fx = retrievalFixture(10, false);
    const filtered = [
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: 'src/**/*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', type: 'ts' } },
    ];
    for (const call of filtered) assert.equal(outcome(runHook(fx, 'pre', call).stdout), 'allowed', JSON.stringify(call));
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 3);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('treats a Glob whose pattern holds a brace group as unfiltered', () => {
    const fx = retrievalFixture(10, false);
    for (const pattern of ['{*,.*}', '**/*.{ts,js}']) {
      assert.equal(outcome(runHook(fx, 'pre', { tool_name: 'Glob', tool_input: { pattern } }).stdout), 'retrieval:broad-discovery-not-authorized', pattern);
    }
  });
});

describe('tracer: a brace-group refusal says the brace group is the cause (GIN-03, CON-10, T-04-158)', () => {
  const reasonOf = (stdout: string): string => (JSON.parse(stdout) as Deny).hookSpecificOutput.permissionDecisionReason;

  it('denies a root Grep with glob `*.{ts,tsx}` as broad discovery and names the brace group and the alternatives', () => {
    const fx = retrievalFixture(10, false);
    const result = runHook(fx, 'pre', { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '*.{ts,tsx}' } });
    assert.equal(outcome(result.stdout), 'retrieval:broad-discovery-not-authorized');
    const reason = reasonOf(result.stdout);
    assert.match(reason, /brace group/);
    assert.match(reason, /type filter/);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });

  it('gives a root Glob with pattern `**/*.{ts,tsx}` the brace reason', () => {
    const fx = retrievalFixture(10, false);
    const result = runHook(fx, 'pre', { tool_name: 'Glob', tool_input: { pattern: '**/*.{ts,tsx}' } });
    assert.equal(outcome(result.stdout), 'retrieval:broad-discovery-not-authorized');
    assert.match(reasonOf(result.stdout), /brace group/);
  });

  it('keeps the no-filter reason for a Grep with no glob and no type', () => {
    const fx = retrievalFixture(10, false);
    const reason = reasonOf(runHook(fx, 'pre', unfiltered).stdout);
    assert.match(reason, /no glob or type filter/);
    assert.doesNotMatch(reason, /brace group/);
  });
});

describe('onboarding purposes keep their hook decisions (policy-gated rules)', () => {
  it('a policy without a retrieval block allows an unfiltered Grep and charges toolCalls only', () => {
    const fx = makeHookFixture();
    fixtures.push(fx);
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
    assert.deepEqual(decisions(fx).at(-1), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Grep', decision: 'allow', rule: 'read-set', budget: 'toolCalls' });
  });
});

describe('the retrieval limits reach the policy file only for a run scope', () => {
  const runInput = (fx: HookFixture, retrieval?: { searches: number; fullReads: number; fullReadBytes: number; broadDiscovery: boolean }): RunScopeInput => ({
    contract: {
      files: { write: ['src/a.ts'], create: [], artifacts: [], protected: [], secretGlobs: [] },
      execution: { commands: [] },
      budgets: { subagentsTotal: 4, subagentsConcurrent: 2, ...(retrieval !== undefined ? { retrieval } : {}) },
    },
    clonePath: fx.staging,
    repoPath: fx.repo,
    dataRoot: join(fx.dir, 'data'),
    home: join(fx.dir, 'home'),
    workRoot: join(fx.dir, 'work'),
    profileRoots: [],
    scratchDir: join(fx.dir, 'work', 'scratch'),
    workspace: { topLevelEntries: ['src'], entriesByDir: { src: ['a.ts'] }, gitPaths: [], repoReadAllow: [] },
    readRoots: [],
  });
  const ids = { onboardingId: 'run_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: [] };
  const written = (fx: HookFixture, scope: ReturnType<typeof computeRunScope>): HookPolicy => {
    const result = writeHookPolicy(join(fx.dir, 'inv'), scope, ids, fx.ledgerPath);
    assert.ok(result.ok);
    return JSON.parse(readFileSync(result.value.file, 'utf8')) as HookPolicy;
  };

  it('writes the contract searches and broadDiscovery for a run, and nothing for a contract compiled before them', () => {
    const fx = makeHookFixture();
    fixtures.push(fx);
    const policy = written(fx, computeRunScope(runInput(fx, { searches: 400, fullReads: 20, fullReadBytes: 262144, broadDiscovery: true })));
    assert.deepEqual(policy.retrieval, { searches: 400, broadDiscovery: true });
    assert.equal('retrieval' in written(fx, computeRunScope(runInput(fx))), false);
  });

  it('writes no retrieval block for an onboarding purpose', () => {
    const fx = makeHookFixture();
    fixtures.push(fx);
    const compiled = compileOnboardingContract({ onboardingId: 'onb_1', runId: 'run_1', projectId: 'prj_1', pin: 'a'.repeat(40), preflight: {}, request: {}, nowIso: '2026-11-02T00:00:00.000Z' });
    if (!compiled.ok) throw new Error('contract');
    const scope = computeInvocationScope({
      purpose: 'map',
      contract: compiled.value,
      stagingPath: fx.staging,
      repoPath: fx.repo,
      dataRoot: join(fx.dir, 'data'),
      home: join(fx.dir, 'home'),
      workRoot: join(fx.dir, 'work'),
      profileRoots: [],
      workspace: { topLevelEntries: ['src', '.planning'], planningEntries: ['codebase'], gitPaths: [], repoReadAllow: [] },
      readRoots: [],
    });
    assert.equal('retrieval' in written(fx, scope), false);
  });
});

// S-16 and CS-16 on the agent side: the retrieval counter is one row, spent inside the hook's BEGIN IMMEDIATE transaction, so parallel hook processes (a parent and its
// subagents each run their own) never spend more than the limit and the row's `used` equals the calls the hook allowed.
describe('parallel subagents share one exact counter (S-16, CS-16, T-04-80)', () => {
  const LIMIT = 10;
  const WORKERS = 6;
  const SEARCHES_EACH = 3;
  const ITERATIONS = 10;
  const raceFixture = (): HookFixture => retrievalFixture(LIMIT, false, { limits: { subagentsTotal: 20 }, policy: { subagentsConcurrent: 2, subagentTypes: ['gsd-codebase-mapper'] } });
  const agentCall = (n: number) => ({ tool_name: 'Agent', tool_use_id: `sub${n}`, tool_input: { subagent_type: 'gsd-codebase-mapper', prompt: 'x' } });

  it(`six processes issuing ${SEARCHES_EACH} scoped searches each against retrieval.searches ${LIMIT}: exactly ${LIMIT} allowed, ${WORKERS * SEARCHES_EACH - LIMIT} denied, used ${LIMIT}, over ${ITERATIONS} iterations`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const fx = retrievalFixture(LIMIT, false);
      const workers = Array.from({ length: WORKERS }, async (_, worker) => {
        const outcomes: string[] = [];
        for (let n = 0; n < SEARCHES_EACH; n += 1) {
          const result = await runHookAsync(fx, 'pre', { ...scoped(fx), agent_id: `agent${worker}` });
          assert.equal(result.code, 0, result.stderr);
          outcomes.push(outcome(result.stdout));
        }
        return outcomes;
      });
      const all = (await Promise.all(workers)).flat();
      const allowed = all.filter((o) => o === 'allowed').length;
      assert.equal(allowed, LIMIT, `iteration ${iteration}: ${all.join(' ')}`);
      assert.equal(all.filter((o) => o === 'budget:retrieval.searches').length, WORKERS * SEARCHES_EACH - LIMIT, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'retrieval.searches'), allowed, `iteration ${iteration}: used is the allowed count`);
      assert.equal(budgetUsed(fx, 'toolCalls'), allowed, `iteration ${iteration}: a refused search charges no tool call`);
      assert.equal(decisions(fx).filter((d) => d.decision === 'allow').length, allowed);
      assert.ok(chainIsIntact(fx.ledgerPath));
    }
  });

  it(`six processes issuing ${SEARCHES_EACH} Reads each against retrieval.fullReads ${LIMIT}: exactly ${LIMIT} allowed, used ${LIMIT}, and a refused Read charges no tool call, over ${ITERATIONS} iterations (WR-11)`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const fx = retrievalFixture(3, false, { limits: { 'retrieval.fullReads': LIMIT } });
      const ten = fileOf(fx, 'ten.txt', 10);
      const workers = Array.from({ length: WORKERS }, async (_, worker) => {
        const outcomes: string[] = [];
        for (let n = 0; n < SEARCHES_EACH; n += 1) {
          const result = await runHookAsync(fx, 'pre', { ...readOf(ten), agent_id: `agent${worker}` });
          assert.equal(result.code, 0, result.stderr);
          outcomes.push(outcome(result.stdout));
        }
        return outcomes;
      });
      const all = (await Promise.all(workers)).flat();
      const allowed = all.filter((o) => o === 'allowed').length;
      assert.equal(allowed, LIMIT, `iteration ${iteration}: ${all.join(' ')}`);
      assert.equal(all.filter((o) => o === 'budget:retrieval.fullReads').length, WORKERS * SEARCHES_EACH - LIMIT, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'retrieval.fullReads'), allowed, `iteration ${iteration}: used is the allowed count`);
      assert.equal(budgetUsed(fx, 'retrieval.fullReadBytes'), allowed * 10, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'toolCalls'), allowed, `iteration ${iteration}: a refused Read charges no tool call`);
      assert.ok(chainIsIntact(fx.ledgerPath));
    }
  });

  it(`six subagents as Agent calls under subagentsConcurrent 2: two are admitted, and every search of all six draws on the same ${LIMIT}, over ${ITERATIONS} iterations`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const fx = raceFixture();
      const workers = Array.from({ length: WORKERS }, async (_, worker) => {
        const admitted = await runHookAsync(fx, 'pre', { ...agentCall(worker), agent_id: 'parent' });
        assert.equal(admitted.code, 0, admitted.stderr);
        const outcomes: string[] = [];
        for (let n = 0; n < SEARCHES_EACH; n += 1) {
          const result = await runHookAsync(fx, 'pre', { ...scoped(fx), agent_id: `sub${worker}` });
          assert.equal(result.code, 0, result.stderr);
          outcomes.push(outcome(result.stdout));
        }
        return { admitted: outcome(admitted.stdout), outcomes };
      });
      const results = await Promise.all(workers);
      assert.equal(results.filter((r) => r.admitted === 'allowed').length, 2, `iteration ${iteration}: at most two subagents in flight`);
      assert.equal(results.filter((r) => r.admitted === 'budget:subagentsConcurrent').length, WORKERS - 2, `iteration ${iteration}`);
      const searches = results.flatMap((r) => r.outcomes);
      const allowed = searches.filter((o) => o === 'allowed').length;
      assert.equal(allowed, LIMIT, `iteration ${iteration}: ${searches.join(' ')}`);
      assert.equal(budgetUsed(fx, 'retrieval.searches'), allowed, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'subagentsTotal'), 2, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'toolCalls'), allowed, `iteration ${iteration}: the Agent calls charge subagentsTotal, the searches toolCalls`);
      const searchers = new Set(decisions(fx).filter((d) => d.tool === 'Grep' && d.decision === 'allow').map((d) => (d as { agentId?: string }).agentId));
      assert.ok(searchers.size > 1, `iteration ${iteration}: the allowed searches came from more than one agent (${[...searchers].join(', ')})`);
      assert.ok(chainIsIntact(fx.ledgerPath));
    }
  });
});
