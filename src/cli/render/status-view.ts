// Human-readable `status` (OPS-7): a result line, then a table of the registered projects, then what to run for an
// interrupted onboarding and what each active record holds. The read model (`getStatus` in src/app/status.ts) is
// unchanged and so is the `--json` path; only this text depends on the style. Every recorded string passes through
// stripControl before it is printed (T-02-03).
import type { ProjectStatus } from '../../app/status.ts';
import { resultLine, stateWord, stripControl } from './style.ts';
import { renderTable, terminalWidth } from './table.ts';
import type { Column } from './table.ts';

export interface RenderOptions {
  // Terminal width in columns; 100 when absent.
  width?: number;
}

const COLUMNS: readonly Column[] = [
  { key: 'project', header: 'PROJECT', subject: true },
  { key: 'repository', header: 'REPOSITORY', cut: 'start' },
  { key: 'activity', header: 'ACTIVITY', subject: true },
  { key: 'state', header: 'STATE', subject: true },
  { key: 'next', header: 'NEXT', keep: true },
];

function asObject(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// `graph, intel`: the indexes the record lists; `graph absent (graphify-missing)`: one it records as not built.
function describeIndexes(indexes: Readonly<Record<string, unknown>>): string {
  const parts = Object.keys(indexes)
    .filter((name) => name !== 'absent')
    .map(stripControl);
  const absent = indexes['absent'];
  if (Array.isArray(absent)) {
    for (const entry of absent) {
      const item = asObject(entry);
      if (item !== null) parts.push(`${stripControl(String(item['index']))} absent (${stripControl(String(item['reason']))})`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'none';
}

// The ledger's own word and reason; an interrupted onboarding shows the state it stopped in, and the checkpoint's next
// action is in NEXT. ACTIVITY says it is interrupted, so STATE stays a ledger word.
function stateOf(e: ProjectStatus): string {
  return e.interrupted !== undefined ? stateWord(e.interrupted.state) : stateWord(e.state, e.reason);
}

function rowOf(e: ProjectStatus): Record<string, string> {
  return {
    project: e.projectId,
    repository: e.repoPath,
    activity: e.onboardingId === null ? 'not onboarded' : e.interrupted !== undefined ? 'interrupted' : 'onboarding',
    state: stateOf(e),
    next: e.interrupted !== undefined ? e.interrupted.nextAction : '-',
  };
}

function recordLine(e: ProjectStatus): string | null {
  if (e.recordVersion === null) return null;
  const m = e.mapping;
  const mapping = m ? `; mapping ${stripControl(String(m['mode']))} (${stripControl(String(m['completeness']))}, ${stripControl(String(m['freshness']))})` : '';
  return `record v${e.recordVersion} at ${stripControl(String(e.onboardedRevision))}${mapping}; indexes: ${describeIndexes(e.indexes)}`;
}

export function renderStatus(entries: readonly ProjectStatus[], options: RenderOptions = {}): string {
  const head = resultLine('status', `${entries.length} project(s)`);
  if (entries.length === 0) return `${head}\nNo projects registered. Add one with: avarice repo add <path>\n`;
  const width = options.width ?? terminalWidth(undefined);
  // Below the table, per project in table order: the onboarding with its ID, what continues it when interrupted, the record.
  const lines: string[] = [];
  for (const e of entries) {
    if (e.onboardingId !== null) lines.push(resultLine(`onboarding ${e.onboardingId}`, e.interrupted !== undefined ? stateWord(e.interrupted.state, 'interrupted') : stateOf(e)));
    if (e.interrupted !== undefined) lines.push(`continue with: ${stripControl(e.interrupted.resumeCommand)}`);
    const record = recordLine(e);
    if (record !== null) lines.push(record);
  }
  return `${head}\n${renderTable(COLUMNS, entries.map(rowOf), width)}${lines.map((l) => `${l}\n`).join('')}`;
}
