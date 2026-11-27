// avarice context <term> [--project id] [--budget n] [--json]
// Asks the active project record's fresh indexes (intel first, then the graph) for a term, through GSD's own readers, and
// prints each item with its source path, revision and freshness. Read-only and offline: it writes nothing and uses no
// network. Exit 0 on an answer (including "no entry matches"), 3 when there is no active project record or the indexes
// cannot be read, 64 for a usage error, 70 for an internal failure.
//
// avarice context add --file <path> --source "<title> rev <n>" --run <runId>
// The manual equivalent of documentation retrieval (plan 04-27; FR-19): records an excerpt the owner pasted as a reference of the run, stored redacted and cited by its
// source and the digest of the file, and offered to the run's next pack as untrusted data. Offline; writes the ledger and the artifact store only. It is the form `add`
// takes when `--file`, `--source` or `--run` is given; `context add user` with none of them is still a search for the term "add user". It refuses inside a run
// (AVARICE_RUN, or the run's process tree) before the profile is resolved, and needs no terminal. Exit 0 recorded (or already recorded), 3 an unknown run, 64 a usage
// error or a file that cannot be stored, 70 an internal failure.
import { basename, resolve } from 'node:path';
import { describeError } from '../../adapters/sqlite/db.ts';
import { MAX_CONTEXT_BUDGET, queryContext, renderContext } from '../../app/context.ts';
import type { AppDeps } from '../../app/deps.ts';
import { profileLimits } from '../../app/resource-limits.ts';
import { MANUAL_CONTEXT_MAX_BYTES, SOURCE_MAX_CHARS, readInputFile, recordManualContext } from '../../app/manual-inputs.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { refuseInsideRun, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { failure, runIdProblem } from '../manual-command.ts';
import { errorLine, stripControl } from '../render/style.ts';

const EXIT_NO_ANSWER = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const USAGE = 'usage: avarice context <term> [--project <id>] [--budget <tokens>] [--json]';

const ADD_USAGE = 'usage: avarice context add --file <path> --source "<title> rev <n>" --run <runId>';

// `add` is the recording form only when one of its flags is given, so every search that starts with the word add (`context add user`) keeps its meaning.
const isAdd = (args: ParsedArgs): boolean => args.positionals[0] === 'add' && (args.flags['file'] !== undefined || args.flags['source'] !== undefined || args.flags['run'] !== undefined);

// The search reads the indexes through GSD and writes nothing; `add` writes the ledger and needs no GSD.
export const readOnly = (args: ParsedArgs): boolean => !isAdd(args);
export const needsGsd = (args: ParsedArgs): boolean => !isAdd(args);
export const booleanFlags = ['json'] as const;

// The `--budget` the owner typed: a number, a refusal text, or undefined when none was given (the profile's limits.contextTokens is the budget then).
function budgetOf(args: ParsedArgs): number | string | undefined {
  const raw = args.flags['budget'];
  if (raw === undefined) return undefined;
  if (raw === true || !/^[1-9][0-9]{0,5}$/.test(raw) || Number(raw) > MAX_CONTEXT_BUDGET) return `--budget must be a whole number of tokens from 1 to ${MAX_CONTEXT_BUDGET}`;
  return Number(raw);
}

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk (T-04-74).
function addUsage(args: ParsedArgs, env: NodeJS.ProcessEnv, context: IdentityContext | undefined): string | undefined {
  const refused = refuseInsideRun(env, context);
  if (refused !== undefined) return refused;
  const message = (text: string): string => `${text}\n${ADD_USAGE}`;
  if (args.positionals.length > 1) return message('context add takes no word besides add');
  const file = args.flags['file'];
  if (typeof file !== 'string' || file === '') return message('--file needs the path of the excerpt');
  const source = args.flags['source'];
  if (typeof source !== 'string' || source.trim() === '') return message('--source needs where the text came from, as "<title> rev <n>"');
  if (source.length > SOURCE_MAX_CHARS) return message(`--source is at most ${SOURCE_MAX_CHARS} characters`);
  const run = runIdProblem(args.flags['run']);
  if (run !== undefined) return message(run);
  return undefined;
}

export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  if (isAdd(args)) return addUsage(args, env, context);
  if (args.positionals.length === 0 || args.positionals.join(' ').trim() === '') return `a term is required\n${USAGE}`;
  const budget = budgetOf(args);
  if (typeof budget === 'string') return budget;
  if (args.flags['project'] === true || args.flags['project'] === '') return '--project needs a project ID';
  return undefined;
}

// Records the excerpt. The file is read here, after usage() has refused what must not run, and only the bytes go to the service.
function runAdd(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const file = resolve(args.flags['file'] as string);
  const read = readInputFile(file, MANUAL_CONTEXT_MAX_BYTES);
  if (!read.ok) {
    io.err(`${errorLine('context', `${stripControl(file)} ${read.reason}`)}\n`);
    return EXIT_USAGE;
  }
  const recorded = recordManualContext(deps, {
    runId: args.flags['run'] as string,
    fileName: basename(file),
    bytes: read.bytes,
    source: args.flags['source'] as string,
    by: responderName(),
    nowMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return failure(io, 'context', recorded.error);
  const { ref, fileDigest, duplicate } = recorded.value;
  io.out(`${duplicate ? 'already recorded' : 'recorded'} excerpt "${stripControl(ref.id)}" (${stripControl(ref.scope)}, ${fileDigest}) for run ${args.flags['run'] as string}\n`);
  return 0;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  if (isAdd(args)) return runAdd(args, deps, io);
  const typed = budgetOf(args);
  if (typeof typed === 'string') {
    io.err(`avarice context: ${typed}\n`);
    return EXIT_USAGE;
  }
  // No --budget: the profile's ceiling (limits.contextTokens, 24,000 by default). A limits section that cannot be read is a usage problem naming the key, not a silent default.
  let budget = typed;
  if (budget === undefined) {
    const limits = profileLimits(deps);
    if (!limits.ok) {
      io.err(`avarice context: ${describeError(limits.error)}\n`);
      return EXIT_USAGE;
    }
    budget = limits.value.contextTokens;
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
