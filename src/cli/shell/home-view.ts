// The home view of the interactive shell (ADR-013 decision 2): store health, the runs and onboardings of the profile with their state and
// last checkpoint, the number of open decisions and the spend against budget of each run. Pure functions over the read models of
// src/app/status.ts and src/app/run-status.ts, printed through the shared OPS-7 functions of src/cli/render/ (the shell and the one-shot
// commands print the same words). Every recorded string passes through stripControl (T-02-62). Nothing here reads the terminal or the clock.
import { orderRuns } from '../../app/run-status.ts';
import type { RunStatus } from '../../app/run-status.ts';
import type { ProjectStatus } from '../../app/status.ts';
import { runStateWord } from '../render/run-view.ts';
import { resultLine, stateWord, stripControl, usd } from '../render/style.ts';
import { renderTable } from '../render/table.ts';
import type { Column } from '../render/table.ts';

export interface HomeView {
  profile: string;
  // `ok: false` when the ledger could not be opened or read: `detail` names the failing query or error.
  store: { ok: true } | { ok: false; detail: string };
  projects: readonly ProjectStatus[];
  nowMs: number;
}

export interface HomeOptions {
  width: number;
  colour: boolean;
}

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const COLUMNS: readonly Column[] = [
  { key: 'kind', header: 'KIND', subject: true },
  { key: 'id', header: 'ID', subject: true },
  { key: 'state', header: 'STATE', subject: true },
  { key: 'checkpoint', header: 'LAST CHECKPOINT', keep: true },
  { key: 'spend', header: 'SPEND' },
];

// `1.25 USD of 5.00 USD` for the run's cost budget; `-` when the run has none.
function spendOf(run: RunStatus): string {
  const cost = run.budgets.find((b) => b.name === 'costUsd');
  return cost === undefined ? '-' : `${usd(cost.used)} of ${usd(cost.limit)}`;
}

function onboardingRow(project: ProjectStatus): Record<string, string> | null {
  if (project.onboardingId === null) return null;
  const interrupted = project.interrupted;
  return {
    kind: 'onboarding',
    id: project.onboardingId,
    state: interrupted !== undefined ? stateWord(interrupted.state, 'interrupted') : stateWord(project.state, project.reason),
    checkpoint: interrupted !== undefined ? interrupted.nextAction : '-',
    spend: '-',
  };
}

function runRow(run: RunStatus): Record<string, string> {
  return { kind: 'run', id: run.runId, state: runStateWord(run), checkpoint: run.lastCheckpoint?.nextAction ?? '-', spend: spendOf(run) };
}

// The failing query or error on one line, so a multi-line SQL text cannot push the view around.
function oneLine(text: string): string {
  const flat = stripControl(text).replace(/\s+/g, ' ').trim();
  const all = Array.from(flat);
  return all.length <= 300 ? flat : `${all.slice(0, 299).join('')}…`;
}

// Always ends with a newline. The first line is the result line `shell: <profile>`.
export function renderHome(view: HomeView, options: HomeOptions): string {
  const head = resultLine('shell', view.profile);
  if (!view.store.ok) {
    const line = `store: unavailable (${oneLine(view.store.detail)})`;
    return `${head}\n${options.colour ? `${RED}${line}${RESET}` : line}\n`;
  }
  const runs = orderRuns(view.projects.flatMap((p) => p.runs ?? []));
  const rows: Record<string, string>[] = runs.map(runRow);
  for (const project of view.projects) {
    const row = onboardingRow(project);
    if (row !== null) rows.push(row);
  }
  const table = rows.length === 0 ? 'no runs or onboardings\n' : renderTable(COLUMNS, rows, options.width);
  const open = runs.reduce((sum, run) => sum + run.openDecisions, 0);
  return `${head}\nstore: ok\n${table}open decisions: ${open}\n`;
}
