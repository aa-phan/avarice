// The actions of the interactive shell menu (ADR-013 decisions 2 to 4). Each action is a small async function over the ActionContext of
// shell.ts; the work itself is done by the command modules, which the context runs in this process through main(). Start and resume spawn the
// detached `avarice supervise` through those modules, exactly as the one-shot path does, and return without waiting: the shell shows progress by
// reading the ledger (the watch action) and sends no signal to a supervisor when it exits.
import { describeError } from '../../adapters/sqlite/db.ts';
import { getInbox, getRunStatuses, orderRuns } from '../../app/run-status.ts';
import type { RunStatus } from '../../app/run-status.ts';
import type { AppDeps } from '../../app/deps.ts';
import { ROUTINE_POLICY } from '../../domain/run-contract.ts';
import { isRunStopState } from '../../domain/run-lifecycle.ts';
import { runStateWord } from '../render/run-view.ts';
import { errorLine, resultLine, stateWord } from '../render/style.ts';
import { renderTable } from '../render/table.ts';
import type { Column } from '../render/table.ts';
import { renderWatch } from './home-view.ts';
import type { WatchView } from './home-view.ts';
import { printable } from './line-editor.ts';
import type { ActionContext, LiveFrame } from './shell.ts';

export interface ShellAction {
  id: string;
  // The keys that activate it; the first is shown in the menu.
  keys: readonly string[];
  label: string;
  // Resolves 'quit' to leave the shell.
  run(ctx: ActionContext): Promise<'quit' | void>;
}

// Splits a command line into words. Single and double quotes group words (the quotes are dropped); there are no escapes. Returns the
// error text for an unterminated quote.
export function splitWords(line: string): string[] | string {
  const words: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;
  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote !== null) return `unterminated ${quote} in the command line`;
  if (started) words.push(current);
  return words;
}

// One command-line entry, in the one-shot grammar without the `avarice` prefix (`status --json`, `resume onb_123`). An empty entry runs nothing.
export async function runCommandLine(ctx: ActionContext, line: string): Promise<'quit' | void> {
  const entry = printable(line).trim();
  if (entry === '') return;
  const words = splitWords(entry);
  if (typeof words === 'string') {
    ctx.show(`${errorLine(undefined, words)}\n`);
    return;
  }
  // A habit from the one-shot form: `avarice status` typed inside the shell means `status`.
  if (words[0] === 'avarice') words.shift();
  if (words.length === 0) return;
  if (words.length === 1 && (words[0] === 'quit' || words[0] === 'exit')) return 'quit';
  ctx.remember(entry);
  await ctx.command(words);
}

// ---- choosing a run or an onboarding ------------------------------------------------------------------------------

interface Choice {
  id: string;
  kind: 'run' | 'onboarding';
  state: string;
  detail: string;
}

const CHOICE_COLUMNS: readonly Column[] = [
  { key: 'n', header: '#', subject: true },
  { key: 'kind', header: 'KIND', subject: true },
  { key: 'id', header: 'ID', subject: true },
  { key: 'state', header: 'STATE', subject: true },
  { key: 'detail', header: 'WHAT' },
];

function listChoices(choices: readonly Choice[], width: number): string {
  const rows = choices.map((c, i) => ({ n: String(i + 1), kind: c.kind, id: c.id, state: c.state, detail: c.detail }));
  return renderTable(CHOICE_COLUMNS, rows, width);
}

// The entry as an ID from the list: a number is a position (1 is the first row), anything else must be an ID on the list.
function pick(answer: string, ids: readonly string[]): string | undefined {
  const entry = printable(answer).trim();
  if (/^[0-9]+$/.test(entry)) return ids[Number(entry) - 1];
  return ids.includes(entry) ? entry : undefined;
}

const runChoice = (run: RunStatus): Choice => ({ id: run.runId, kind: 'run', state: runStateWord(run), detail: run.title });

// ---- start ---------------------------------------------------------------------------------------------------------

const start: ShellAction = {
  id: 'start',
  keys: ['1'],
  label: 'Start a run',
  run: async (ctx) => {
    ctx.show(`start a run\npolicy: ${ROUTINE_POLICY}`);
    const answer = await ctx.prompt('brief path: ');
    const path = answer === undefined ? '' : printable(answer).trim();
    if (path === '') return;
    // The start command module authorizes the run, stores it and spawns the detached supervisor; it returns without waiting for it.
    await ctx.command(['start', '--brief', path, '--policy', ROUTINE_POLICY]);
  },
};

// ---- watch ---------------------------------------------------------------------------------------------------------

// What the watch view shows of one run, read from the ledger: undefined when the run does not exist.
function readWatch(deps: AppDeps, runId: string): WatchView | undefined {
  const row = deps.ledger.getRun(runId);
  if (!row.ok) {
    if (row.error.kind === 'not_found') return undefined;
    throw new Error(describeError(row.error));
  }
  const nowMs = deps.clock.nowMs();
  const statuses = getRunStatuses(deps.ledger, row.value.projectId, nowMs);
  if (!statuses.ok) throw new Error(describeError(statuses.error));
  const run = statuses.value.find((r) => r.runId === runId);
  if (run === undefined) return undefined;
  const checkpoints = deps.ledger.listRunCheckpoints(runId);
  if (!checkpoints.ok) throw new Error(describeError(checkpoints.error));
  const events = deps.ledger.listRunEvents(runId, 6);
  if (!events.ok) throw new Error(describeError(events.error));
  return {
    run,
    checkpoints: checkpoints.value.slice(-4).map((c) => ({ seq: c.seq, nextAction: c.nextAction, at: c.createdAt })),
    events: events.value,
    nowMs,
  };
}

function watchFrame(ctx: ActionContext, runId: string): LiveFrame {
  const read = ctx.read((deps) => readWatch(deps, runId));
  if (!read.ok) return { text: `store: unavailable (${read.detail.replace(/\s+/g, ' ')})\n`, done: false };
  if (read.value === undefined) return { text: `${resultLine(`run ${runId}`, 'not found')}\n`, done: true };
  // A run that stopped short of a stop state with nobody holding its lease is shown as paused and watched on: it may be resumed from another terminal.
  const { run } = read.value;
  return { text: renderWatch(read.value, { width: ctx.width }), done: run.interrupted === undefined && isRunStopState(run.state) };
}

const watch: ShellAction = {
  id: 'watch',
  keys: ['2'],
  label: 'Watch a run',
  run: async (ctx) => {
    const home = ctx.reread();
    if (!home.store.ok) {
      ctx.show(`store: unavailable (${home.store.detail.replace(/\s+/g, ' ')})`);
      return;
    }
    const runs = orderRuns(home.projects.flatMap((p) => p.runs ?? []));
    if (runs.length === 0) {
      ctx.show('no runs to watch');
      return;
    }
    ctx.show(listChoices(runs.map(runChoice), ctx.width));
    const answer = await ctx.prompt('run to watch (number or ID): ');
    const entry = answer === undefined ? '' : printable(answer).trim();
    if (entry === '') return;
    const runId = pick(entry, runs.map((r) => r.runId));
    if (runId === undefined) {
      ctx.show(`no run matches ${JSON.stringify(entry)}`);
      return;
    }
    await ctx.live(() => watchFrame(ctx, runId));
  },
};

// ---- resume --------------------------------------------------------------------------------------------------------

const ONBOARDING_ID = /^onb_/;
const RUN_ID = /^run_/;

const resume: ShellAction = {
  id: 'resume',
  keys: ['3'],
  label: 'Resume a run',
  run: async (ctx) => {
    const home = ctx.reread();
    if (!home.store.ok) {
      ctx.show(`store: unavailable (${home.store.detail.replace(/\s+/g, ' ')})`);
      return;
    }
    const choices: Choice[] = [];
    for (const project of home.projects) {
      for (const run of project.runs ?? []) if (run.interrupted !== undefined) choices.push({ ...runChoice(run), detail: run.interrupted.nextAction });
      if (project.onboardingId !== null && project.interrupted !== undefined) {
        choices.push({ id: project.onboardingId, kind: 'onboarding', state: stateWord(project.interrupted.state, 'interrupted'), detail: project.interrupted.nextAction });
      }
    }
    if (choices.length === 0) {
      ctx.show('nothing to resume: no interrupted run or onboarding');
      return;
    }
    ctx.show(listChoices(choices, ctx.width));
    const answer = await ctx.prompt('run or onboarding to resume (number or ID): ');
    const entry = answer === undefined ? '' : printable(answer).trim();
    if (entry === '') return;
    // A number or a listed ID; any other run or onboarding ID goes to the resume command, which checks it and says if it cannot be resumed.
    const id = pick(entry, choices.map((c) => c.id)) ?? (RUN_ID.test(entry) || ONBOARDING_ID.test(entry) ? entry : undefined);
    if (id === undefined) {
      ctx.show(`no run or onboarding matches ${JSON.stringify(entry)}`);
      return;
    }
    // The resume command module checks that the lease has lapsed, spawns the detached supervisor and returns; watch it with the Watch item.
    await ctx.command(['resume', id]);
  },
};

// ---- status, inbox, command line, quit -----------------------------------------------------------------------------

const status: ShellAction = {
  id: 'status',
  keys: ['4'],
  label: 'Status',
  run: async (ctx) => void (await ctx.command(['status'])),
};

const inbox: ShellAction = {
  id: 'inbox',
  keys: ['5'],
  label: 'Inbox',
  run: async (ctx) => void (await ctx.command(['inbox'])),
};

const commandLine: ShellAction = {
  id: 'command-line',
  keys: ['6', ':'],
  label: 'Command line',
  run: async (ctx) => {
    const line = await ctx.prompt('avarice> ', { history: true, complete: true });
    if (line === undefined) return;
    return runCommandLine(ctx, line);
  },
};

// ---- decide --------------------------------------------------------------------------------------------------------

const DECISION_COLUMNS: readonly Column[] = [
  { key: 'n', header: '#', subject: true },
  { key: 'decision', header: 'DECISION', subject: true },
  { key: 'run', header: 'RUN', subject: true },
  { key: 'class', header: 'CLASS', subject: true },
  { key: 'issue', header: 'ISSUE (the unit\'s words, as data)' },
];

// The first line of a decision's issue that has anything on it: the issue is the unit's own text, shown as data and never acted on.
const firstLineOf = (issue: string): string =>
  issue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';

// Lists the open decisions, lets the owner pick one by number or ID, and runs `decide <id>` in this process. The command prints the record and asks
// its question through the shell's own prompt, so the answer goes through the same engine and the same checks as `avarice decide` (D-13, ADR-013).
const decide: ShellAction = {
  id: 'decide',
  keys: ['7', 'd'],
  label: 'Decide',
  run: async (ctx) => {
    const read = ctx.read((deps) => getInbox(deps.ledger));
    if (!read.ok) {
      ctx.show(`store: unavailable (${read.detail.replace(/\s+/g, ' ')})`);
      return;
    }
    if (!read.value.ok) {
      ctx.show(`store: unavailable (${describeError(read.value.error).replace(/\s+/g, ' ')})`);
      return;
    }
    const { decisions } = read.value.value;
    if (decisions.length === 0) {
      ctx.show('no open decisions');
      return;
    }
    const rows = decisions.map((d, i) => ({ n: String(i + 1), decision: d.decisionId, run: d.runId, class: d.class, issue: firstLineOf(d.issue) }));
    ctx.show(renderTable(DECISION_COLUMNS, rows, ctx.width));
    const answer = await ctx.prompt('decision to answer (number or ID): ');
    const entry = answer === undefined ? '' : printable(answer).trim();
    if (entry === '') return;
    const id = pick(entry, decisions.map((d) => d.decisionId));
    if (id === undefined) {
      ctx.show(`no decision matches ${JSON.stringify(entry)}`);
      return;
    }
    await ctx.command(['decide', id]);
  },
};

const quit: ShellAction = {
  id: 'quit',
  keys: ['q'],
  label: 'Quit',
  run: () => Promise.resolve('quit'),
};

export const SHELL_ACTIONS: readonly ShellAction[] = [start, watch, resume, status, inbox, commandLine, decide, quit];
