// avarice contract amend <runId> --reason <text> --budget name=value ...
// Records contract version n+1 for a run (RC-6, D-17, D-18, D-19, D-20): the one way a limit rises or a scope widens, and it is a person at a
// terminal outside the run who does it. The command prints the field-level diff and what it would invalidate, asks `apply contract v<n+1>? [y/N]`,
// and on yes writes the amendment in one ledger transaction, then the contract file. Declining prints `not amended` and exits 0. Exit 0 amended or
// declined, 3 when the run has ended or the contract moved, 64 for a usage error, an invalid flag or an unknown run, 70 for an internal failure.
import { createInterface } from 'node:readline';
import { describeError } from '../../adapters/sqlite/db.ts';
import { commitAmendment, planAmendment } from '../../app/amend.ts';
import type { AmendRequest, AmendmentPlan } from '../../app/amend.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { FieldDiff } from '../../domain/amendment.ts';
import type { PortError } from '../../domain/result.ts';
import { parseBudgetFlags } from '../args.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { responderName } from '../identity.ts';
import { errorLine, stripControl } from '../render/style.ts';

const EXIT_REFUSED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

const USAGE = 'usage: avarice contract amend <runId> --reason <text> [--budget name=value]...';
const RUN_ID = /^run_[0-9A-Za-z]+$/;

// Flags of the amendment grammar that a later change of this plan adds.
const NOT_YET: readonly string[] = ['add-write', 'check', 'acceptance-file', 'item', 'decision'];

// Checked before the profile is resolved, so a usage error leaves nothing on disk.
export function usage(args: ParsedArgs): string | undefined {
  const [sub, runId, ...rest] = args.positionals;
  if (sub !== 'amend') return `contract needs a subcommand: amend\n${USAGE}`;
  if (runId === undefined || !RUN_ID.test(runId) || rest.length > 0) return `contract amend needs exactly one run ID\n${USAGE}`;
  for (const flag of NOT_YET) if (args.flags[flag] !== undefined) return `--${flag} is not supported yet\n${USAGE}`;
  const reason = args.flags['reason'];
  if (typeof reason !== 'string' || reason.trim() === '') return `--reason is required: say why the contract changes\n${USAGE}`;
  const budgets = parseBudgetFlags(args);
  if (typeof budgets === 'string') return `${budgets}\n${USAGE}`;
  if (Object.keys(budgets).length === 0) return `nothing to amend: name a budget with --budget name=value\n${USAGE}`;
  return undefined;
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

// One line per field: `path: from -> to` for a value, `path: +added -removed` for a list.
function diffLine(entry: FieldDiff): string {
  if (entry.added !== undefined || entry.removed !== undefined) {
    const parts = [...(entry.added ?? []).map((a) => `+${a}`), ...(entry.removed ?? []).map((r) => `-${r}`)];
    return `${entry.path}: ${parts.join(' ')}`;
  }
  return `${entry.path}: ${show(entry.from)} -> ${show(entry.to)}`;
}

function planLines(plan: AmendmentPlan): string[] {
  const lines = [`run ${plan.runId}: amending contract v${plan.baseVersion} to v${plan.version}`, ...plan.diff.map(diffLine)];
  lines.push(`invalidates: ${plan.invalidates.length === 0 ? 'nothing' : plan.invalidates.join(', ')}`);
  if (plan.staleGates.length > 0) lines.push(`stale gates: ${plan.staleGates.join(', ')}`);
  if (plan.staleEvidenceIds.length > 0) lines.push(`stale evidence: ${plan.staleEvidenceIds.join(', ')}`);
  return lines.map(stripControl);
}

// One line from standard input, for a command run with no one to ask for it (the one-shot CLI). undefined at end of input.
function askStdin(question: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.once('close', () => {
      if (!answered) resolve(undefined);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

function fail(io: Io, error: PortError): number {
  switch (error.kind) {
    case 'not_found':
      io.err(`${errorLine('contract', `no run ${error.ref}`)}\n`);
      return EXIT_USAGE;
    case 'invalid':
      io.err(`${errorLine('contract', `invalid ${error.field}: ${error.reason}`)}\n`);
      return EXIT_USAGE;
    case 'conflict':
      io.err(`${errorLine('contract', `not amended: ${describeError(error)}`)}\n`);
      return EXIT_REFUSED;
    default:
      io.err(`${errorLine('contract', `failed: ${describeError(error)}`)}\n`);
      return EXIT_INTERNAL;
  }
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const runId = args.positionals[1] as string;
  const budgets = parseBudgetFlags(args);
  if (typeof budgets === 'string') return fail(io, { kind: 'invalid', field: 'budget', reason: budgets });
  const request: AmendRequest = { reason: args.flags['reason'] as string, budgets };

  const planned = planAmendment(deps, runId, request);
  if (!planned.ok) return fail(io, planned.error);
  const plan = planned.value;
  for (const line of planLines(plan)) io.out(`${line}\n`);

  const ask = io.ask ?? askStdin;
  const answer = await ask(`apply contract v${plan.version}? [y/N] `);
  if (answer === undefined || !/^(y|yes)$/i.test(answer.trim())) {
    io.out('not amended\n');
    return 0;
  }

  const committed = commitAmendment(deps, plan, `owner:${responderName()}`, deps.clock.nowMs());
  if (!committed.ok) return fail(io, committed.error);
  io.out(`contract v${committed.value.version} recorded\n`);
  return 0;
}
