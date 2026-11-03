// AVARICE's hook entry for the contained host: `--event pre|post|config-change --policy {invDir}/hook-policy.json`
// (docs/containment.md "Generated host settings"; research "Hook behavior"). It runs outside the sandbox, once per
// tool call, so it stays lean: it imports only node, the pure decision, the digest helpers, the events module and the
// canonical-path helper, never the CLI or the application layer (T-4: 150 ms p95).
//
// Fail closed (CON-3): any problem, whether unreadable policy, unreadable ledger, malformed input or a thrown
// error, ends in `process.exit(2)`, which the host treats as a block (the settings also set onFailure "block").
// A decision is: the pure rules (decideToolCall), then, for an allowed call, one conditional UPDATE that charges
// the budget inside the same BEGIN IMMEDIATE transaction that appends the `hook.decision` event, so a call is
// never charged without a row and never allowed without a charge. A deny is printed as the PreToolUse deny JSON
// with exit 0. Events carry the tool name, rule, IDs and a staging-relative target, never a tool payload (T-01-35).
import { existsSync, readFileSync, readSync, statSync, writeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { relative } from 'node:path';
import { sha256Hex } from '../domain/digest.ts';
import { SUBAGENT_CONCURRENT_RULE, decideToolCall, normalizeToolCall, parseHookPolicy } from '../domain/hook-decision.ts';
import type { HookDecision, HookPolicy, NormalizedToolCall } from '../domain/hook-decision.ts';
import { appendEventRow } from '../adapters/sqlite/events.ts';
import { canonicalAbsolute } from '../adapters/fs/canonical-path.ts';

const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_TARGET_CHARS = 256;
const MAX_NAME_CHARS = 128;
const BUSY_TIMEOUT_MS = 4000;

function fail(reason: string): never {
  try {
    writeSync(2, `avarice hook: ${reason}\n`);
  } catch {
    // stderr is unusable; the exit code alone blocks the call
  }
  process.exit(2);
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.allocUnsafe(65_536);
  let total = 0;
  for (;;) {
    let n: number;
    try {
      n = readSync(0, buffer, 0, buffer.length, null);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'EAGAIN') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        continue;
      }
      if (code === 'EOF') break;
      throw e;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_STDIN_BYTES) throw new Error('hook input is larger than 1 MiB');
    chunks.push(Buffer.from(buffer.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseArgs(argv: readonly string[]): { event?: string; policy?: string } {
  const out: { event?: string; policy?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--event' && argv[i + 1] !== undefined) out.event = argv[(i += 1)] as string;
    else if (argv[i] === '--policy' && argv[i + 1] !== undefined) out.policy = argv[(i += 1)] as string;
  }
  return out;
}

function loadPolicy(path: string): HookPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read the hook policy ${path}: ${(e as { code?: string }).code ?? 'not valid JSON'}`);
  }
  const parsed = parseHookPolicy(raw);
  if (!parsed.ok) fail(parsed.reason);
  return parsed.policy;
}

function parseInput(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('the hook input is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('the hook input is not a JSON object');
  return value as Record<string, unknown>;
}

// Opens the ledger for writing. A path that is not an existing file is refused first, because opening it would
// create an empty database (and an empty database has no budgets, so nothing would ever be charged).
function openLedger(path: string): DatabaseSync {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`the ledger ${path} does not exist`);
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  return db;
}

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // the original error is the one to report
    }
    throw e;
  }
}

const short = (text: string): string => (text.length > MAX_NAME_CHARS ? text.slice(0, MAX_NAME_CHARS) : text);

function identity(policy: HookPolicy, tool: string, agentId: unknown): Record<string, unknown> {
  return { onboardingId: policy.onboardingId, invocationId: policy.invocationId, tool: short(tool), ...(typeof agentId === 'string' && agentId !== '' ? { agentId: short(agentId) } : {}) };
}

// Subagents in flight for one invocation, from its own events (O-1): the Agent calls the hook admitted (a `hook.decision` allow that
// charged subagentsTotal) minus the completions that freed a slot (`tool.completed` with subagentReleased). The count is scoped to the
// invocation ID, so an invocation that was killed leaves nothing behind that a later invocation would count. The caller's BEGIN
// IMMEDIATE transaction is open: the count, the charge and the event row that records the admission are one step.
const ADMITTED = "type = 'hook.decision' AND json_extract(data_json, '$.decision') = 'allow' AND json_extract(data_json, '$.budget') = 'subagentsTotal'";
const RELEASED = "type = 'tool.completed' AND json_extract(data_json, '$.subagentReleased') = 1";

function countEvents(db: DatabaseSync, invocationId: string, condition: string, ...params: string[]): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE invocation_id = ? AND ${condition}`).get(invocationId, ...params) as { n: number };
  return Number(row.n);
}

const inFlightSubagents = (db: DatabaseSync, invocationId: string): number => countEvents(db, invocationId, ADMITTED) - countEvents(db, invocationId, RELEASED);

// Whether the completion of a subagent call frees a slot, each call at most once:
//   - a background call is never released: its PostToolUse reports the launch, not the end, so it holds its slot for the invocation;
//   - with a tool_use_id, the call must have been admitted in this invocation as a foreground call and not released before;
//   - without one, a completion frees a slot only while a foreground admission is unreleased, so the count never goes below zero.
function releasesSubagent(db: DatabaseSync, invocationId: string, toolUseId: string | undefined, background: boolean): boolean {
  if (background) return false;
  if (toolUseId === undefined) {
    return countEvents(db, invocationId, `${ADMITTED} AND json_extract(data_json, '$.background') IS NOT 1`) > countEvents(db, invocationId, RELEASED);
  }
  const admitted = db
    .prepare(`SELECT data_json FROM events WHERE invocation_id = ? AND ${ADMITTED} AND json_extract(data_json, '$.toolUseId') = ? ORDER BY seq LIMIT 1`)
    .get(invocationId, toolUseId) as { data_json: string } | undefined;
  if (admitted === undefined || (JSON.parse(admitted.data_json) as { background?: unknown }).background === true) return false;
  return countEvents(db, invocationId, `${RELEASED} AND json_extract(data_json, '$.toolUseId') = ?`, toolUseId) === 0;
}

function toolUseIdOf(input: Record<string, unknown>): string | undefined {
  const id = input['tool_use_id'];
  return typeof id === 'string' && id !== '' ? short(id) : undefined;
}

// What a later completion needs to find a subagent admission again: the call's tool_use_id, and whether it runs in the background.
function subagentIdentity(call: NormalizedToolCall, toolInput: unknown, input: Record<string, unknown>): Record<string, unknown> {
  if (call.kind !== 'subagent') return {};
  const id = toolUseIdOf(input);
  const background = typeof toolInput === 'object' && toolInput !== null && (toolInput as Record<string, unknown>)['run_in_background'] === true;
  return { ...(id !== undefined ? { toolUseId: id } : {}), ...(background ? { background: true } : {}) };
}

function emit(json: unknown): void {
  writeSync(1, JSON.stringify(json) + '\n');
}

function preToolUse(policy: HookPolicy, input: Record<string, unknown>): void {
  const tool = input['tool_name'];
  if (typeof tool !== 'string' || tool === '') fail('the hook input has no tool_name');
  const toolInput = input['tool_input'];
  const cwd = typeof input['cwd'] === 'string' && input['cwd'].startsWith('/') ? input['cwd'] : policy.stagingPath;
  const normalized = normalizeToolCall(tool, typeof toolInput === 'object' && toolInput !== null && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : {}, cwd);
  if (!normalized.ok) fail(normalized.reason);
  const decided = decideToolCall(normalized.call, policy, canonicalAbsolute);

  const db = openLedger(policy.ledgerPath);
  let final: HookDecision;
  try {
    final = inTransaction(db, () => {
      let result = decided;
      // O-1: at the concurrency limit, a subagent call is refused before it is charged. When the total is also spent the charge below
      // reports that (budget_exhausted), so the more fundamental limit is the one named.
      const totalHasRoom = (): boolean => db.prepare("SELECT 1 AS room FROM budgets WHERE run_id = ? AND name = 'subagentsTotal' AND used + reserved + 1 <= limit_value").get(policy.runId) !== undefined;
      if (decided.decision === 'allow' && decided.budget === 'subagentsTotal' && inFlightSubagents(db, policy.invocationId) >= policy.subagentsConcurrent && totalHasRoom()) {
        result = { decision: 'deny', rule: SUBAGENT_CONCURRENT_RULE };
      } else if (decided.decision === 'allow' && decided.budget !== undefined) {
        const charged = db
          .prepare('UPDATE budgets SET used = used + 1 WHERE run_id = ? AND name = ? AND used + reserved + 1 <= limit_value')
          .run(policy.runId, decided.budget);
        if (Number(charged.changes) === 0) {
          // No row at all is a broken ledger (fail closed); a row at its limit is the budget doing its job.
          if (db.prepare('SELECT 1 AS found FROM budgets WHERE run_id = ? AND name = ?').get(policy.runId, decided.budget) === undefined) {
            throw new Error(`the ledger has no ${decided.budget} budget for run ${policy.runId}`);
          }
          result = { decision: 'deny', rule: 'budget_exhausted', budget: decided.budget };
        }
      }
      appendEventRow(db, {
        type: 'hook.decision',
        level: result.decision === 'deny' ? 'warn' : 'info',
        runId: policy.runId,
        invocationId: policy.invocationId,
        data: { ...identity(policy, tool, input['agent_id']), ...subagentIdentity(normalized.call, toolInput, input), decision: result.decision, rule: result.rule, ...(result.budget !== undefined ? { budget: result.budget } : {}) },
        nowMs: Date.now(),
      });
      return result;
    });
  } finally {
    db.close();
  }

  if (final.decision === 'deny') {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `avarice: ${final.rule}` } });
  } else if (final.explicit === true) {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `avarice: ${final.rule}` } });
  }
}

// PostToolUse: attribute the completed call to the onboarding and invocation. A file write records the target
// relative to the staging root, so a staging change is traceable to the call that made it (S-31).
function postToolUse(policy: HookPolicy, input: Record<string, unknown>): void {
  const tool = input['tool_name'];
  if (typeof tool !== 'string' || tool === '') fail('the hook input has no tool_name');
  const toolInput = input['tool_input'];
  const cwd = typeof input['cwd'] === 'string' && input['cwd'].startsWith('/') ? input['cwd'] : policy.stagingPath;
  const normalized = normalizeToolCall(tool, typeof toolInput === 'object' && toolInput !== null && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : {}, cwd);
  if (!normalized.ok) fail(normalized.reason);

  const data: Record<string, unknown> = identity(policy, tool, input['agent_id']);
  if (normalized.call.kind === 'file-write') {
    const canonical = canonicalAbsolute(normalized.call.paths[0] as string);
    const staging = canonicalAbsolute(policy.stagingPath);
    const rel = canonical !== null && staging !== null ? relative(staging, canonical) : null;
    if (rel === null) {
      data['targetUnresolved'] = true;
    } else if (rel === '' || rel.startsWith('..')) {
      data['outsideStaging'] = true;
    } else if (rel.length > MAX_TARGET_CHARS) {
      data['target'] = rel.slice(0, MAX_TARGET_CHARS);
      data['targetDigest'] = 'sha256:' + sha256Hex(rel);
    } else {
      data['target'] = rel;
    }
  }
  if (input['hook_event_name'] === 'PostToolUseFailure') data['failed'] = true;
  const db = openLedger(policy.ledgerPath);
  try {
    inTransaction(db, () => {
      // O-1: the completion of a subagent call frees its concurrency slot, decided and recorded in the same transaction as the event.
      if (normalized.call.kind === 'subagent') {
        const id = toolUseIdOf(input);
        const background = typeof toolInput === 'object' && toolInput !== null && (toolInput as Record<string, unknown>)['run_in_background'] === true;
        if (id !== undefined) data['toolUseId'] = id;
        data['subagentReleased'] = releasesSubagent(db, policy.invocationId, id, background);
      }
      appendEventRow(db, { type: 'tool.completed', runId: policy.runId, invocationId: policy.invocationId, data, nowMs: Date.now() });
    });
  } finally {
    db.close();
  }
}

// ConfigChange is refused every time: a contained run may not change its settings, hooks or permissions. The
// event is best effort (the refusal does not depend on it).
function configChange(policyPath: string | undefined): never {
  try {
    if (policyPath !== undefined) {
      const policy = loadPolicy(policyPath);
      let source: unknown;
      try {
        source = (JSON.parse(readStdin()) as Record<string, unknown>)['source'];
      } catch {
        source = undefined;
      }
      const db = openLedger(policy.ledgerPath);
      try {
        inTransaction(db, () =>
          appendEventRow(db, {
            type: 'config.change.denied',
            level: 'warn',
            runId: policy.runId,
            invocationId: policy.invocationId,
            data: { onboardingId: policy.onboardingId, invocationId: policy.invocationId, ...(typeof source === 'string' ? { source: short(source) } : {}) },
            nowMs: Date.now(),
          }),
        );
      } finally {
        db.close();
      }
    }
  } catch {
    // refused regardless
  }
  return fail('configuration changes are not allowed during a contained invocation');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.event === 'config-change') configChange(args.policy);
  if (args.event !== 'pre' && args.event !== 'post') fail('--event must be pre, post or config-change');
  if (args.policy === undefined) fail('--policy is required');
  const policy = loadPolicy(args.policy);
  const input = parseInput(readStdin());
  if (args.event === 'pre') preToolUse(policy, input);
  else postToolUse(policy, input);
}

try {
  main();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
