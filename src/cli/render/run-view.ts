// Human-readable run views (OPS-7; plan 02-15): the runs part of `status` and the whole of `inbox`. Pure functions over the read models of
// src/app/run-status.ts: the caller passes the time and the terminal width in, and every recorded string (a title, a branch, a decision
// issue, a path) passes through stripControl before it is printed (T-02-49). The `--json` paths never come through here.
import type { InboxDecision, InboxReview, InboxView, RunStatus } from '../../app/run-status.ts';
import { orderRuns } from '../../app/run-status.ts';
import { duration, localTime, resultLine, stateWord, stripControl, usd } from './style.ts';
import { renderTable } from './table.ts';
import type { Column } from './table.ts';

// A revision or digest for a person: without its scheme prefix, the first 12 characters.
function shortRevision(revision: string): string {
  return stripControl(revision.replace(/^[a-z0-9-]+:/, '')).slice(0, 12);
}

const sha7 = (sha: string): string => stripControl(sha).slice(0, 7);

// The ledger's word and reason; an interrupted run is shown as paused, with what interrupted it as the reason.
export function runStateWord(run: RunStatus): string {
  return run.interrupted !== undefined ? stateWord(run.interrupted.presentedAs, run.interrupted.reason) : stateWord(run.state, run.reason);
}

const BUDGET_ORDER = ['costUsd', 'invocations', 'toolCalls', 'subagentsTotal', 'wallClockMs'] as const;
const BUDGET_LABEL: Readonly<Record<string, string>> = {
  costUsd: 'cost',
  invocations: 'invocations',
  toolCalls: 'tool calls',
  subagentsTotal: 'subagents',
  wallClockMs: 'wall clock',
};

function amount(name: string, n: number): string {
  if (name === 'costUsd') return usd(n);
  if (name === 'wallClockMs') return duration(n);
  return String(n);
}

function budgetLine(run: RunStatus): string | null {
  if (run.budgets.length === 0) return null;
  const known = BUDGET_ORDER.flatMap((name) => run.budgets.filter((b) => b.name === name));
  const unknown = run.budgets.filter((b) => !(BUDGET_ORDER as readonly string[]).includes(b.name));
  const parts = [...known, ...unknown].map((b) => `${stripControl(BUDGET_LABEL[b.name] ?? b.name)} ${amount(b.name, b.used)} of ${amount(b.name, b.limit)}`);
  return `budget: ${parts.join('; ')}`;
}

function branchLine(run: RunStatus): string | null {
  if (run.branch === null) return null;
  const branch = stripControl(run.branch);
  if (run.commit === null) return `branch ${branch} (not handed off)`;
  const clean = run.clean === null ? '' : run.clean ? ' (clean)' : ' (not clean)';
  return `branch ${branch} at ${sha7(run.commit)}${clean}`;
}

// The detail lines of one run, each indented two spaces and ending with a newline. The first line is the result line.
export function renderRunDetails(run: RunStatus, nowMs: number, _width: number): string {
  const lines: string[] = [resultLine(`run ${run.runId}`, run.interrupted !== undefined ? run.interrupted.presentedAs : run.state, run.interrupted !== undefined ? run.interrupted.reason : run.reason)];
  const detail = (text: string): void => void lines.push(`  ${text}`);
  if (run.interrupted !== undefined) {
    const i = run.interrupted;
    detail(i.attemptId === null ? `interrupted at ${stripControl(i.step)}` : `interrupted attempt ${stripControl(i.attemptId)} at ${stripControl(i.step)}`);
    detail(`continue with: ${stripControl(i.resumeCommand)}`);
  }
  if (run.lastCheckpoint !== null) detail(`last checkpoint: ${stripControl(run.lastCheckpoint.nextAction)} (${localTime(Date.parse(run.lastCheckpoint.at), nowMs)})`);
  const branch = branchLine(run);
  if (branch !== null) detail(branch);
  detail(
    run.evidence.length === 0
      ? 'evidence: none'
      : `evidence: ${run.evidence.map((e) => `${stripControl(e.name)} ${stripControl(e.status)}${e.preExisting === true ? ' (pre-existing)' : ''}`).join(', ')}`,
  );
  detail(run.gates.length === 0 ? 'gates: none' : `gates: ${run.gates.map((g) => `${stripControl(g.gate)} ${g.passed ? 'passed' : 'failed'}`).join(', ')}`);
  if (run.openDecisions > 0) detail(`decisions: ${run.openDecisions} open (see avarice inbox)`);
  const budget = budgetLine(run);
  if (budget !== null) detail(budget);
  if (run.references.length > 0) detail(`references: ${run.references.map((r) => `${stripControl(r.kind)} ${stripControl(r.id)} at ${shortRevision(r.revision)}`).join('; ')}`);
  return `${lines.join('\n')}\n`;
}

const RUN_COLUMNS: readonly Column[] = [
  { key: 'run', header: 'RUN', subject: true },
  { key: 'state', header: 'STATE', subject: true },
  { key: 'title', header: 'TITLE' },
];

// The runs of the profile: a table, then the detail block of each run. Interrupted runs come first, then blocked ones, each with
// the command that continues it.
export function renderRuns(runs: readonly RunStatus[], nowMs: number, width: number): string {
  if (runs.length === 0) return '';
  const ordered = orderRuns(runs);
  const rows = ordered.map((run) => ({ run: run.runId, state: runStateWord(run), title: run.title }));
  return `${resultLine('runs', String(ordered.length))}\n${renderTable(RUN_COLUMNS, rows, width)}${ordered.map((run) => renderRunDetails(run, nowMs, width)).join('')}`;
}

// ---- inbox -------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const DECISION_COLUMNS: readonly Column[] = [
  { key: 'id', header: 'DECISION', subject: true },
  { key: 'run', header: 'RUN', subject: true },
  { key: 'class', header: 'CLASS', subject: true },
  { key: 'urgency', header: 'URGENCY', subject: true },
  { key: 'opened', header: 'OPENED' },
];

const REVIEW_COLUMNS: readonly Column[] = [
  { key: 'run', header: 'RUN', subject: true },
  { key: 'branch', header: 'BRANCH', subject: true },
  { key: 'commit', header: 'COMMIT', subject: true },
  { key: 'repository', header: 'REPOSITORY', cut: 'start' },
];

const decisionRow = (d: InboxDecision, nowMs: number): Record<string, string> => ({
  id: d.decisionId,
  run: d.runId,
  class: d.class,
  urgency: d.urgency,
  opened: localTime(Date.parse(d.openedAt), nowMs),
});

// One line of free text cut to the terminal width with `…`: control characters removed, line breaks and runs of spaces made one space.
function fit(text: string, width: number): string {
  const flat = stripControl(text).replace(/\s+/g, ' ').trim();
  const all = Array.from(flat);
  return all.length <= width ? flat : width <= 1 ? '…' : `${all.slice(0, width - 1).join('')}…`;
}

const reviewRow = (r: InboxReview): Record<string, string> => ({ run: r.runId, branch: r.branch ?? '-', commit: r.commit === null ? '-' : sha7(r.commit), repository: r.repository });

// `inbox: 1 open decision, 1 review`, then a table of each. A decision's issue is model-derived text: it is printed on its own line under
// the table, cut to the terminal width, so a long issue never pushes an ID off a row.
export function renderInbox(view: InboxView, nowMs: number, width: number): string {
  const head = `inbox: ${plural(view.decisions.length, 'open decision', 'open decisions')}, ${plural(view.reviews.length, 'review', 'reviews')}\n`;
  const issues = view.decisions.map((d) => {
    const label = `issue ${stripControl(d.decisionId)}: `;
    return `${label}${fit(d.issue, Math.max(8, width - Array.from(label).length))}\n`;
  });
  const decisions = view.decisions.length === 0 ? '' : `decisions:\n${renderTable(DECISION_COLUMNS, view.decisions.map((d) => decisionRow(d, nowMs)), width)}${issues.join('')}`;
  const reviews = view.reviews.length === 0 ? '' : `reviews:\n${renderTable(REVIEW_COLUMNS, view.reviews.map(reviewRow), width)}`;
  return `${head}${decisions}${reviews}`;
}
