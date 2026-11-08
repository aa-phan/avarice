// Read before edit (CON-7, RESEARCH Pitfall 10) through the real hook entry (src/hook/pre-tool-use.ts) run as a child process:
// PostToolUse of a read or write records the file's digest into hook_reads, PreToolUse of an edit asks the pure decision with the
// recorded and the current digest. Each test asserts the printed decision and the stored rows.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { sha256Hex } from '../../src/domain/digest.ts';
import type { HookPolicy } from '../../src/domain/hook-decision.ts';
import { budgetUsed, eventRows, makeHookFixture, runHook, withDb } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

const RUN_POLICY: Partial<HookPolicy> = {
  purpose: 'run',
  writeRoots: [],
  writeGlobs: ['src/**'],
  protectedGlobs: ['package.json'],
  readBeforeEdit: true,
  subagentTypes: ['gsd-executor'],
};

function runFixture(policy: Partial<HookPolicy> = {}): HookFixture {
  const fx = makeHookFixture({ policy: { ...RUN_POLICY, ...policy } });
  fixtures.push(fx);
  return fx;
}

const file = (fx: HookFixture, name: string): string => join(fx.staging, 'src', name);
const put = (fx: HookFixture, name: string, text: string): string => {
  writeFileSync(file(fx, name), text);
  return file(fx, name);
};
const digestOf = (text: string): string => 'sha256:' + sha256Hex(text);

interface ReadRow {
  invocation_id: string;
  agent_id: string;
  path: string;
  digest: string;
  seq: number;
}
const readRows = (fx: HookFixture): ReadRow[] => withDb(fx.ledgerPath, (db) => db.prepare('SELECT * FROM hook_reads ORDER BY path, agent_id').all() as unknown as ReadRow[]);

const post = (fx: HookFixture, tool: string, path: string, agent = '', extra: Record<string, unknown> = {}) =>
  runHook(fx, 'post', { tool_name: tool, tool_input: tool === 'NotebookEdit' ? { notebook_path: path } : { file_path: path }, ...(agent !== '' ? { agent_id: agent } : {}), hook_event_name: 'PostToolUse', ...extra });
const pre = (fx: HookFixture, tool: string, path: string, agent = '') =>
  runHook(fx, 'pre', { tool_name: tool, tool_input: { file_path: path, old_string: 'a', new_string: 'b', content: 'x' }, ...(agent !== '' ? { agent_id: agent } : {}) });

interface Deny {
  hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
}
const reasonOf = (stdout: string): string => (JSON.parse(stdout) as Deny).hookSpecificOutput.permissionDecisionReason;
const decisions = (fx: HookFixture): Array<{ decision: string; rule: string; tool: string }> => eventRows(fx, 'hook.decision').map((r) => JSON.parse(r.data_json));

describe('read before edit through the real hook entry (CON-7)', () => {
  it('records the SHA-256 of the file as read from disk at PostToolUse of a Read, keyed by invocation, agent and canonical path', () => {
    const fx = runFixture();
    const path = put(fx, 'a.ts', 'export const a = 1;\n');
    const result = post(fx, 'Read', path);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    const rows = readRows(fx);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]?.invocation_id, rows[0]?.agent_id, rows[0]?.path, rows[0]?.digest], ['inv_1', '', path, digestOf('export const a = 1;\n')]);
    // The seq is the seq of the tool.completed event appended in the same transaction.
    assert.equal(rows[0]?.seq, eventRows(fx, 'tool.completed')[0]?.seq);
  });

  it('allows an Edit of a file the same agent read, and denies an Edit of a file it never read with edit-without-read', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'a');
    const b = put(fx, 'b.ts', 'b');
    post(fx, 'Read', a);
    const allowed = pre(fx, 'Edit', a);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.equal(allowed.stdout, '');
    const denied = pre(fx, 'Edit', b);
    assert.equal(denied.code, 0, denied.stderr);
    assert.equal((JSON.parse(denied.stdout) as Deny).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(reasonOf(denied.stdout), /edit-without-read/);
    assert.match(reasonOf(denied.stdout), /read src\/b\.ts again before editing it/);
    assert.deepEqual(decisions(fx).map((d) => [d.decision, d.rule]), [['allow', 'write-set'], ['deny', 'edit-without-read']]);
    assert.equal(budgetUsed(fx, 'toolCalls'), 1, 'a denied edit charges nothing');
  });

  it('denies an Edit after the file changed on disk with file-changed-since-read, and a new Read lifts it', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'one');
    post(fx, 'Read', a);
    put(fx, 'a.ts', 'two');
    const stale = pre(fx, 'Edit', a);
    assert.match(reasonOf(stale.stdout), /file-changed-since-read/);
    assert.match(reasonOf(stale.stdout), /read src\/a\.ts again before editing it/);
    post(fx, 'Read', a);
    assert.equal(readRows(fx)[0]?.digest, digestOf('two'));
    assert.equal(pre(fx, 'Edit', a).stdout, '');
  });

  it('keys reads by agent: a subagent read does not count for the parent or a sibling', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'a');
    post(fx, 'Read', a, 'sub1');
    assert.match(reasonOf(pre(fx, 'Edit', a, '').stdout), /edit-without-read/);
    assert.match(reasonOf(pre(fx, 'Edit', a, 'sub2').stdout), /edit-without-read/);
    assert.equal(pre(fx, 'Edit', a, 'sub1').stdout, '');
    assert.deepEqual(readRows(fx).map((r) => r.agent_id), ['sub1']);
  });

  it('records the digest at PostToolUse of an Edit, so a second Edit without a new Read is allowed', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'before');
    post(fx, 'Read', a);
    assert.equal(pre(fx, 'Edit', a).stdout, '');
    put(fx, 'a.ts', 'after the edit');
    assert.equal(post(fx, 'Edit', a).code, 0);
    assert.equal(readRows(fx)[0]?.digest, digestOf('after the edit'));
    assert.equal(pre(fx, 'Edit', a).stdout, '');
    assert.equal(readRows(fx).length, 1, 'one row per invocation, agent and path');
  });

  it('lets a Write of a new file under a write glob through with no prior read, and denies a Write of an existing file never read', () => {
    const fx = runFixture();
    const fresh = file(fx, 'new.ts');
    assert.equal(pre(fx, 'Write', fresh).stdout, '');
    put(fx, 'new.ts', 'created');
    post(fx, 'Write', fresh);
    assert.equal(readRows(fx)[0]?.digest, digestOf('created'));
    assert.equal(pre(fx, 'Write', fresh).stdout, '', 'the agent that wrote it may overwrite it');
    const existing = put(fx, 'old.ts', 'old');
    assert.match(reasonOf(pre(fx, 'Write', existing).stdout), /edit-without-read/);
  });

  it('applies the rule to MultiEdit and NotebookEdit and records their digests', () => {
    const fx = runFixture();
    const multi = put(fx, 'm.ts', 'm');
    const nb = put(fx, 'n.ipynb', '{}');
    for (const [tool, path] of [['MultiEdit', multi], ['NotebookEdit', nb]] as const) {
      const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
      const denied = runHook(fx, 'pre', { tool_name: tool, tool_input: { [key]: path, edits: [], new_source: 'x' } });
      assert.match(reasonOf(denied.stdout), /edit-without-read/, tool);
      post(fx, 'Read', path);
      assert.equal(runHook(fx, 'pre', { tool_name: tool, tool_input: { [key]: path, edits: [], new_source: 'x' } }).stdout, '', tool);
    }
  });

  it('records a path through a symlink under its canonical name, so an Edit by the real name is allowed', () => {
    const fx = runFixture();
    const real = put(fx, 'real.ts', 'r');
    const link = file(fx, 'link.ts');
    symlinkSync(real, link);
    post(fx, 'Read', link);
    assert.equal(readRows(fx)[0]?.path, real);
    assert.equal(pre(fx, 'Edit', real).stdout, '');
  });

  it('uses a size and mtime digest for a file above 8 MiB', () => {
    const fx = runFixture();
    const big = put(fx, 'big.bin', '');
    writeFileSync(big, Buffer.alloc(8 * 1024 * 1024 + 1, 1));
    post(fx, 'Read', big);
    const stat = statSync(big);
    assert.equal(readRows(fx)[0]?.digest, `size:${stat.size}:mtime:${Math.trunc(stat.mtimeMs)}`);
    assert.equal(pre(fx, 'Edit', big).stdout, '');
  });

  it('records nothing for a failed call, a missing file or a path outside the clone, and never blocks the PostToolUse', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'a');
    assert.equal(post(fx, 'Read', a, '', { hook_event_name: 'PostToolUseFailure' }).code, 0);
    assert.equal(post(fx, 'Read', file(fx, 'missing.ts')).code, 0);
    const outside = join(fx.dir, 'outside.txt');
    writeFileSync(outside, 'x');
    assert.equal(post(fx, 'Read', outside).code, 0);
    assert.deepEqual(readRows(fx), []);
    assert.equal(eventRows(fx, 'tool.completed').length, 3);
  });

  it('keeps a denial of the path rules first: a protected path stays protected-path, not an edit-without-read', () => {
    const fx = runFixture();
    writeFileSync(join(fx.staging, 'package.json'), '{}');
    assert.match(reasonOf(pre(fx, 'Edit', join(fx.staging, 'package.json')).stdout), /protected-path/);
  });

  it('is off for a policy without readBeforeEdit: nothing is recorded and an unread Edit is allowed (onboarding unchanged)', () => {
    const fx = makeHookFixture({ policy: { ...RUN_POLICY, readBeforeEdit: undefined } });
    fixtures.push(fx);
    const a = put(fx, 'a.ts', 'a');
    assert.equal(post(fx, 'Read', a).code, 0);
    assert.deepEqual(readRows(fx), []);
    assert.equal(pre(fx, 'Edit', a).stdout, '');
  });

  it('fails closed (exit 2) when the ledger is unreadable at PostToolUse or PreToolUse', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'a');
    post(fx, 'Read', a);
    unlinkSync(fx.ledgerPath);
    const afterPost = post(fx, 'Read', a);
    assert.equal(afterPost.code, 2, afterPost.stderr);
    const afterPre = pre(fx, 'Edit', a);
    assert.equal(afterPre.code, 2, afterPre.stderr);
    assert.equal(afterPre.stdout, '');
  });

  it('fails closed (exit 2) when the file cannot be read for its digest, and does not allow the edit', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'a');
    post(fx, 'Read', a);
    chmodSync(a, 0o000);
    try {
      const result = pre(fx, 'Edit', a);
      // A process that can read despite the mode (root) would see the unchanged file and allow it; only an unreadable file must fail closed.
      if (process.getuid?.() === 0) return;
      assert.equal(result.code, 2, result.stderr);
      assert.equal(result.stdout, '');
    } finally {
      chmodSync(a, 0o644);
    }
  });

  it('fails closed when the ledger has no hook_reads table', () => {
    const fx = runFixture();
    const a = put(fx, 'a.ts', 'a');
    withDbWrite(fx, 'DROP TABLE hook_reads');
    assert.equal(post(fx, 'Read', a).code, 2);
    assert.equal(pre(fx, 'Edit', a).code, 2);
  });
});

function withDbWrite(fx: HookFixture, sql: string): void {
  const db = new DatabaseSync(fx.ledgerPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
