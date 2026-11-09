// Contract amendment (RC-6, D-18, D-19, D-20; docs/contracts-and-state.md "Contract amendments"). Pure: the clock and the
// conventions' write set are arguments. The run never calls this; the amend command, outside the run and from a terminal,
// does. Nothing here is reachable from a contained invocation, because a contained invocation holds no path to the command.
//
// An amendment is a request for contract version n+1. `applyAmendment` returns the next contract, the field-level diff and the
// classes of earlier results the change invalidates (D-20), or an `invalid` error that names the flag at fault. It never
// touches the input and never raises a limit by itself: a human asked for the new value, and D-19 sets no upper bound on it.
// Invalidation is a selection, not an edit: `staleTargets` names the rows that get a stale copy appended, and no function here
// proposes an update or a delete of an evidence or gate row (T-03-17).
import { BRIEF_LIMITS, parseAcceptanceSection } from './brief.ts';
import { CHECK_NAME_PATTERN, validateGlob } from './conventions.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import { BUDGET_OVERRIDE_NAMES, checkG0Static, globWithin } from './run-contract.ts';
import type { RunContract } from './run-contract.ts';

export interface AmendmentRequest {
  budgets?: Readonly<Record<string, number>>;
  addWrite?: readonly string[];
  checks?: ReadonlyArray<{ op: '+' | '-'; name: string }>;
  acceptance?: { text: string; item?: string };
  reason: string;
}

export type FieldDiff = { path: string; from?: unknown; to?: unknown; added?: string[]; removed?: string[] };

export type InvalidationClass = 'gates' | 'acceptance-mappings' | 'checks-rerun' | 'scope-conformance' | 'check-evidence' | 'approvals';

// The order a list of classes is reported in. Every function that returns classes uses it, so equal amendments give equal lists.
export const INVALIDATION_CLASSES: readonly InvalidationClass[] = [
  'gates',
  'acceptance-mappings',
  'checks-rerun',
  'scope-conformance',
  'check-evidence',
  'approvals',
];

export interface AmendmentContext {
  // The write globs of the repository conventions: an added write glob must sit inside one of them.
  conventionsWrite: readonly string[];
  nowIso: string;
}

export interface AmendmentResult {
  contract: RunContract;
  diff: FieldDiff[];
  invalidates: InvalidationClass[];
}

// A budget row of the ledger whose limit an amendment changes (the same mapping as budgetRowsOfRun in src/app/budget.ts, which a
// unit test compares row by row; the domain cannot import the app layer).
export interface BudgetRowChange {
  name: string;
  limit: number;
  exactness: 'exact' | 'estimated';
}

export const REASON_MAX_CHARS = 500;

type BudgetName = (typeof BUDGET_OVERRIDE_NAMES)[number];

// Where each amendable budget lives in the contract, and whether it counts whole units.
const BUDGET_FIELDS: Readonly<Record<BudgetName, { path: string; integer: boolean }>> = {
  wallClockMinutes: { path: 'budgets.wallClockMinutes', integer: true },
  invocations: { path: 'budgets.invocations', integer: true },
  toolCalls: { path: 'budgets.toolCalls', integer: true },
  subagentsTotal: { path: 'budgets.subagentsTotal', integer: true },
  subagentsConcurrent: { path: 'budgets.subagentsConcurrent', integer: true },
  costUsdPerInvocation: { path: 'budgets.costUsd.perInvocation', integer: false },
  costUsdPerRun: { path: 'budgets.costUsd.perRun', integer: false },
};

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const withinAny = (inner: string, outers: readonly string[]): boolean => outers.some((outer) => globWithin(inner, outer));

function readBudget(budgets: RunContract['budgets'], name: BudgetName): number {
  switch (name) {
    case 'wallClockMinutes':
      return budgets.wallClockMinutes;
    case 'invocations':
      return budgets.invocations;
    case 'toolCalls':
      return budgets.toolCalls;
    case 'subagentsTotal':
      return budgets.subagentsTotal;
    case 'subagentsConcurrent':
      return budgets.subagentsConcurrent;
    case 'costUsdPerInvocation':
      return budgets.costUsd.perInvocation;
    case 'costUsdPerRun':
      return budgets.costUsd.perRun;
  }
}

function writeBudget(budgets: RunContract['budgets'], name: BudgetName, value: number): void {
  switch (name) {
    case 'wallClockMinutes':
      budgets.wallClockMinutes = value;
      break;
    case 'invocations':
      budgets.invocations = value;
      break;
    case 'toolCalls':
      budgets.toolCalls = value;
      break;
    case 'subagentsTotal':
      budgets.subagentsTotal = value;
      break;
    case 'subagentsConcurrent':
      budgets.subagentsConcurrent = value;
      break;
    case 'costUsdPerInvocation':
      budgets.costUsd.perInvocation = value;
      break;
    case 'costUsdPerRun':
      budgets.costUsd.perRun = value;
      break;
  }
}

// D-19: a budget may be raised or lowered, to any finite value above 0 (a whole number where the budget counts units). The same
// consistency the compiler keeps holds afterwards: a per-invocation cap above the per-run cap, or a concurrent cap above the total,
// could never bind, so the amendment is refused rather than quietly moving a second field.
function amendBudgets(next: RunContract, raw: unknown, diff: FieldDiff[]): Result<void> {
  if (!isPlainObject(raw)) return invalid('budget', 'must be an object of budget names to numbers');
  for (const [key, value] of Object.entries(raw)) {
    const field = `budget.${key}`;
    if (!(BUDGET_OVERRIDE_NAMES as readonly string[]).includes(key)) {
      return invalid(field, `unknown budget; the amendable budgets are ${BUDGET_OVERRIDE_NAMES.join(', ')}`);
    }
    const name = key as BudgetName;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return invalid(field, 'must be a finite number above 0');
    const spec = BUDGET_FIELDS[name];
    if (spec.integer && !Number.isSafeInteger(value)) return invalid(field, 'must be an integer');
    const from = readBudget(next.budgets, name);
    if (from === value) continue;
    writeBudget(next.budgets, name, value);
    diff.push({ path: spec.path, from, to: value });
  }
  const { costUsd, subagentsConcurrent, subagentsTotal } = next.budgets;
  if (costUsd.perInvocation > costUsd.perRun) {
    return invalid(
      'budget.costUsdPerRun',
      `the per-invocation cost cap ${costUsd.perInvocation} is above the per-run cap ${costUsd.perRun}: amend costUsdPerInvocation in the same request`,
    );
  }
  if (subagentsConcurrent > subagentsTotal) {
    return invalid(
      'budget.subagentsTotal',
      `the concurrent subagent cap ${subagentsConcurrent} is above the total ${subagentsTotal}: amend subagentsConcurrent in the same request`,
    );
  }
  return ok(undefined);
}

// Assumption A8: --add-write widens only inside the write set of the repository conventions and off the protected globs, by the
// same containment rule the compiler applies to a brief. A path outside the conventions needs new conventions and a new run.
function amendWrite(next: RunContract, raw: unknown, conventionsWrite: readonly string[], diff: FieldDiff[]): Result<void> {
  if (!Array.isArray(raw)) return invalid('add-write', 'must be a list of globs');
  if (raw.length > BRIEF_LIMITS.listItems) return invalid('add-write', `at most ${BRIEF_LIMITS.listItems} globs`);
  const wanted: string[] = [];
  for (const entry of raw as unknown[]) {
    const glob = validateGlob('add-write', entry);
    if (!glob.ok) return glob;
    if (withinAny(glob.value, next.files.protected)) return invalid('add-write', `${glob.value} is a protected path`);
    if (!withinAny(glob.value, conventionsWrite)) {
      return invalid(
        'add-write',
        `${glob.value} is not inside the write set of the repository conventions: change the conventions and start a new run to write there`,
      );
    }
    if (!wanted.includes(glob.value)) wanted.push(glob.value);
  }
  const toWrite = wanted.filter((glob) => !next.files.write.includes(glob));
  const toCreate = wanted.filter((glob) => !next.files.create.includes(glob));
  if (toWrite.length > 0) {
    next.files.write.push(...toWrite);
    diff.push({ path: 'files.write', added: toWrite });
  }
  if (toCreate.length > 0) {
    next.files.create.push(...toCreate);
    diff.push({ path: 'files.create', added: toCreate });
  }
  return ok(undefined);
}

// D-20 / AUT-16: `+name` makes a declared check required, `-name` makes it not required. The declaration stays; only the contract's
// required list changes, in the declaration order the compiler uses. A run keeps at least one required check (G0).
function amendChecks(next: RunContract, raw: unknown, diff: FieldDiff[]): Result<void> {
  if (!Array.isArray(raw)) return invalid('check', 'must be a list of +name or -name entries');
  const declared = new Set(next.execution.checks.map((check) => check.name));
  const plus = new Set<string>();
  const minus = new Set<string>();
  for (const entry of raw as unknown[]) {
    if (!isPlainObject(entry) || (entry.op !== '+' && entry.op !== '-') || typeof entry.name !== 'string') {
      return invalid('check', 'each entry is +name or -name');
    }
    const { op, name } = entry as { op: '+' | '-'; name: string };
    if (!CHECK_NAME_PATTERN.test(name)) return invalid('check', `${JSON.stringify(name)} is not a check name`);
    if (!declared.has(name)) return invalid('check', `${name} is not a declared check`);
    (op === '+' ? plus : minus).add(name);
  }
  for (const name of plus) {
    if (minus.has(name)) return invalid('check', `${name} is named with both + and -`);
  }
  const current = new Set(next.verification.requiredChecks);
  const target = new Set(current);
  for (const name of plus) target.add(name);
  for (const name of minus) target.delete(name);
  if (target.size === 0) {
    return invalid('check', 'the run would have no required check: a contract needs at least one, so name another with + in the same request');
  }
  const added = [...plus].filter((name) => !current.has(name));
  const removed = [...minus].filter((name) => current.has(name));
  if (added.length === 0 && removed.length === 0) return ok(undefined);
  next.verification.requiredChecks = next.execution.checks.map((check) => check.name).filter((name) => target.has(name));
  diff.push({ path: 'verification.requiredChecks', ...(added.length > 0 ? { added } : {}), ...(removed.length > 0 ? { removed } : {}) });
  return ok(undefined);
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, n) => value === b[n]);

// D-20: the file holds criteria in the brief's line syntax. An ID the contract has keeps its item and takes the new text and
// references; an ID it does not have goes to the item named by `item` (needed when the run has more than one item). No criterion
// is deleted by an amendment in this phase.
function amendAcceptance(next: RunContract, raw: unknown, diff: FieldDiff[]): Result<void> {
  if (!isPlainObject(raw) || typeof raw.text !== 'string') return invalid('acceptance', 'must carry the text of an acceptance file');
  if (raw.item !== undefined && typeof raw.item !== 'string') return invalid('item', 'must be a work item ID');
  const itemId = raw.item as string | undefined;
  const items = next.intent.workItems;
  if (itemId !== undefined && !items.some((item) => item.id === itemId)) {
    return invalid('item', `${JSON.stringify(itemId)} is not a work item of the run (${items.map((item) => item.id).join(', ')})`);
  }
  const parsed = parseAcceptanceSection(raw.text.split(/\r?\n/));
  if (!parsed.ok) return parsed.error.kind === 'invalid' ? invalid('acceptance', parsed.error.reason) : err(parsed.error);
  if (parsed.value.length === 0) return invalid('acceptance', 'the acceptance file holds no criterion');

  const changes: FieldDiff[] = [];
  const added: string[] = [];
  const addedByItem = new Map<string, string[]>();
  for (const criterion of parsed.value) {
    const existing = next.intent.acceptance.find((c) => c.id === criterion.id);
    if (existing !== undefined) {
      if (existing.text !== criterion.text) {
        changes.push({ path: `intent.acceptance.${criterion.id}.text`, from: existing.text, to: criterion.text });
        existing.text = criterion.text;
      }
      if (!sameList(existing.verifiedBy, criterion.verifiedBy)) {
        changes.push({ path: `intent.acceptance.${criterion.id}.verifiedBy`, from: [...existing.verifiedBy], to: [...criterion.verifiedBy] });
        existing.verifiedBy = [...criterion.verifiedBy];
      }
      continue;
    }
    let target = itemId;
    if (target === undefined) {
      if (items.length !== 1) {
        return invalid('item', `is required: ${criterion.id} is new and the run has ${items.length} work items (${items.map((item) => item.id).join(', ')})`);
      }
      target = (items[0] as { id: string }).id;
    }
    next.intent.acceptance.push({ id: criterion.id, text: criterion.text, verifiedBy: [...criterion.verifiedBy] });
    added.push(criterion.id);
    addedByItem.set(target, [...(addedByItem.get(target) ?? []), criterion.id]);
  }
  if (next.intent.acceptance.length > BRIEF_LIMITS.acceptance) {
    return invalid('acceptance', `at most ${BRIEF_LIMITS.acceptance} acceptance criteria in a contract`);
  }
  diff.push(...changes);
  if (added.length > 0) diff.push({ path: 'intent.acceptance', added });
  for (const item of items) {
    const ids = addedByItem.get(item.id);
    if (ids === undefined) continue;
    item.acceptance.push(...ids);
    diff.push({ path: `intent.workItems[${item.id}].acceptance`, added: ids });
  }
  return ok(undefined);
}

const NOTHING_TO_AMEND = 'nothing to amend';

export function applyAmendment(contract: RunContract, request: AmendmentRequest, context: AmendmentContext): Result<AmendmentResult> {
  const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
  if (reason === '') return invalid('reason', 'is required: say why the contract changes');
  if (reason.length > REASON_MAX_CHARS) return invalid('reason', `is longer than ${REASON_MAX_CHARS} characters`);
  if (request.budgets === undefined && request.addWrite === undefined && request.checks === undefined && request.acceptance === undefined) {
    return invalid('amendment', `${NOTHING_TO_AMEND}: name a budget, a write glob, a check or an acceptance file`);
  }

  const next = structuredClone(contract);
  const diff: FieldDiff[] = [];
  if (request.budgets !== undefined) {
    const done = amendBudgets(next, request.budgets, diff);
    if (!done.ok) return done;
  }
  if (request.addWrite !== undefined) {
    const done = amendWrite(next, request.addWrite, context.conventionsWrite, diff);
    if (!done.ok) return done;
  }
  if (request.checks !== undefined) {
    const done = amendChecks(next, request.checks, diff);
    if (!done.ok) return done;
  }
  if (request.acceptance !== undefined) {
    const done = amendAcceptance(next, request.acceptance, diff);
    if (!done.ok) return done;
  }
  if (diff.length === 0) return invalid('amendment', `${NOTHING_TO_AMEND}: the request leaves every field as it is`);

  next.contractVersion = contract.contractVersion + 1;
  next.compiledAt = context.nowIso;
  const failures = checkG0Static(next);
  if (failures.length > 0) {
    return invalid('g0', `G0 static conditions failed: ${failures.map((f) => `${f.rule}: ${f.detail}`).join('; ')}`);
  }
  return ok({ contract: next, diff, invalidates: classifyInvalidation(diff) });
}

// D-20, the table in docs/contracts-and-state.md "Contract amendments", read off the diff's field paths: an acceptance change
// invalidates the gate results and the acceptance mappings and needs the checks run again; a change to a writable or protected path
// invalidates the scope-conformance results; a change to the required checks invalidates all check evidence; a policy revision change
// invalidates gate results and approvals; budgets, notifications and exclusions invalidate nothing. Any other path invalidates nothing.
export function classifyInvalidation(diff: ReadonlyArray<{ path: string }>): InvalidationClass[] {
  const found = new Set<InvalidationClass>();
  for (const { path } of diff) {
    if (path === 'intent.acceptance' || path.startsWith('intent.acceptance.') || /^intent\.workItems\[[^\]]*\]\.acceptance$/.test(path)) {
      found.add('gates');
      found.add('acceptance-mappings');
      found.add('checks-rerun');
    } else if (path.startsWith('files.')) {
      found.add('scope-conformance');
    } else if (path === 'verification.requiredChecks') {
      found.add('check-evidence');
    } else if (path === 'policyRevision') {
      found.add('gates');
      found.add('approvals');
    }
  }
  return INVALIDATION_CLASSES.filter((cls) => found.has(cls));
}

// The facts of an evidence row the selector reads. `acceptance` is the IDs the row is mapped to.
export interface StaleEvidenceRow {
  evidenceId: string;
  kind: string;
  contractVersion: number;
  status: string;
  acceptance?: readonly string[];
}

// Which rows an amendment gets a stale copy of. Evidence rows come from the run's latest contract version in the list and not yet
// stale; `gates` are the ledger's gate rows oldest first, so a gate's latest row decides whether it stands as passed. A class that
// only asks for work (a check re-run) or names records outside these two tables (approvals) lists nothing here. The result holds IDs
// only: the caller appends a `stale` evidence copy for each evidence ID and a failed `stale-after-amendment` row for each gate, and
// the insert-only tables never see an update or a delete (D-20, T-03-17).
export function staleTargets(
  invalidates: readonly InvalidationClass[],
  evidence: readonly StaleEvidenceRow[],
  gates: ReadonlyArray<{ gate: string; passed: boolean }>,
): { evidenceIds: string[]; gates: string[] } {
  const wants = new Set(invalidates);
  const latest = evidence.reduce((max, row) => Math.max(max, row.contractVersion), 0);
  const current = evidence.filter((row) => row.contractVersion === latest && row.status !== 'stale');
  const evidenceIds = new Set<string>();
  if (wants.has('check-evidence')) {
    for (const row of current) if (row.kind === 'check') evidenceIds.add(row.evidenceId);
  }
  if (wants.has('acceptance-mappings')) {
    for (const row of current) if ((row.acceptance?.length ?? 0) > 0) evidenceIds.add(row.evidenceId);
  }

  const standing = new Map<string, boolean>();
  for (const row of gates) standing.set(row.gate, row.passed);
  const passed = [...standing].filter(([, stands]) => stands).map(([gate]) => gate);
  const gateNames = new Set<string>();
  if (wants.has('gates')) for (const gate of passed) gateNames.add(gate);
  if (wants.has('scope-conformance')) {
    for (const gate of ['G2', 'G4']) if (passed.includes(gate)) gateNames.add(gate);
  }
  return { evidenceIds: [...evidenceIds].sort(), gates: [...gateNames].sort() };
}

// The ledger budget rows whose limit the diff changes, with the new limit read from the amended contract. Only the five budgets the
// ledger keeps appear; a contract-only cap (concurrent subagents, the per-invocation cost cap) has no row.
export function budgetRowChanges(diff: readonly FieldDiff[], next: RunContract): BudgetRowChange[] {
  const b = next.budgets;
  const rows = new Map<string, BudgetRowChange>();
  for (const entry of diff) {
    switch (entry.path) {
      case 'budgets.invocations':
        rows.set('invocations', { name: 'invocations', limit: b.invocations, exactness: 'exact' });
        break;
      case 'budgets.toolCalls':
        rows.set('toolCalls', { name: 'toolCalls', limit: b.toolCalls, exactness: 'exact' });
        break;
      case 'budgets.subagentsTotal':
        rows.set('subagentsTotal', { name: 'subagentsTotal', limit: b.subagentsTotal, exactness: 'exact' });
        break;
      case 'budgets.wallClockMinutes':
        rows.set('wallClockMs', { name: 'wallClockMs', limit: b.wallClockMinutes * 60_000, exactness: 'exact' });
        break;
      case 'budgets.costUsd.perRun':
        rows.set('costUsd', { name: 'costUsd', limit: b.costUsd.perRun, exactness: b.costUsd.exactness });
        break;
    }
  }
  return [...rows.values()];
}
