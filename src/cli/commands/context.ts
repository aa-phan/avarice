// avarice context <term> [--project id] [--budget n] [--json]
// Asks the active project record's fresh indexes (intel first, then the graph) for a term, through GSD's own readers, and
// prints each item with its source path, revision and freshness. Read-only and offline: it writes nothing and uses no
// network. Exit 0 on an answer (including "no entry matches"), 3 when there is no active project record or the indexes
// cannot be read, 64 for a usage error, 70 for an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import { DEFAULT_CONTEXT_BUDGET, MAX_CONTEXT_BUDGET, queryContext, renderContext } from '../../app/context.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';

const EXIT_NO_ANSWER = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const USAGE = 'usage: avarice context <term> [--project <id>] [--budget <tokens>] [--json]';

export const readOnly = true;
export const needsGsd = true;
export const booleanFlags = ['json'] as const;

function budgetOf(args: ParsedArgs): number | string {
  const raw = args.flags['budget'];
  if (raw === undefined) return DEFAULT_CONTEXT_BUDGET;
  if (raw === true || !/^[1-9][0-9]{0,5}$/.test(raw) || Number(raw) > MAX_CONTEXT_BUDGET) return `--budget must be a whole number of tokens from 1 to ${MAX_CONTEXT_BUDGET}`;
  return Number(raw);
}

export function usage(args: ParsedArgs): string | undefined {
  if (args.positionals.length === 0 || args.positionals.join(' ').trim() === '') return `a term is required\n${USAGE}`;
  const budget = budgetOf(args);
  if (typeof budget === 'string') return budget;
  if (args.flags['project'] === true || args.flags['project'] === '') return '--project needs a project ID';
  return undefined;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const budget = budgetOf(args);
  if (typeof budget === 'string') {
    io.err(`avarice context: ${budget}\n`);
    return EXIT_USAGE;
  }
  const project = args.flags['project'];
  const report = await queryContext(deps, {
    term: args.positionals.join(' ').trim(),
    budget,
    ...(typeof project === 'string' ? { projectId: project } : {}),
  });
  if (!report.ok) {
    const e = report.error;
    if (e.kind === 'not_found') {
      io.err(e.ref.startsWith('project ') ? `avarice context: unknown ${e.ref}\n` : `avarice context: no ${e.ref}; onboard a repository first (avarice onboard <repo>)\n`);
      return EXIT_NO_ANSWER;
    }
    if (e.kind === 'unavailable') {
      io.err(`avarice context: ${e.cause}\n`);
      return EXIT_NO_ANSWER;
    }
    if (e.kind === 'invalid') {
      io.err(`avarice context: ${e.reason}\n`);
      return EXIT_USAGE;
    }
    io.err(`avarice context failed: ${describeError(e)}\n`);
    return EXIT_INTERNAL;
  }
  io.out(args.flags['json'] === true ? `${JSON.stringify(report.value, null, 2)}\n` : renderContext(report.value));
  return 0;
}
