// avarice contract amend <runId> --reason <text> [--budget name=value]... [--add-write glob]... [--acceptance-file file [--item id]]
//                         [--check +name | -name]... [--decision decisionId]
// Records contract version n+1 for a run (RC-6, D-17, D-18, D-19, D-20): the one way a limit rises or a scope widens, and it is a person at a
// terminal outside the run who does it. The command prints the field-level diff and what it would invalidate, asks `apply contract v<n+1>? [y/N]`,
// and on yes writes the amendment in one ledger transaction (version, limits, stale rows, the decision it answers), then the contract file.
// Declining prints `not amended` and exits 0. It refuses inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the
// process tree of a run, before the profile is resolved, so a refusal creates nothing (CS-11). Exit 0 amended or declined, 3 when the run has ended,
// the contract moved or the decision is no longer open, 64 for a refusal, a usage error, an invalid flag or an unknown run, 70 for an internal failure.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { commitAmendment, planAmendment } from '../../app/amend.ts';
import type { AmendRequest, AmendmentPlan } from '../../app/amend.ts';
import { describeError } from '../../app/run-start.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { FieldDiff } from '../../domain/amendment.ts';
import type { PortError } from '../../domain/result.ts';
import { parseBudgetFlags } from '../args.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { refuseOutsideTerminal, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { errorLine, stripControl } from '../render/style.ts';

const EXIT_REFUSED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

const USAGE = [
  'usage: avarice contract amend <runId> --reason <text> [--budget name=value]... [--add-write glob]...',
  '         [--acceptance-file file [--item id]] [--check +name|-name]... [--decision decisionId]',
].join('\n');
const RUN_ID = /^run_[0-9A-Za-z]+$/;
const DECISION_ID = /^dec_[0-9A-Za-z]+$/;
const CHECK_FLAG = /^([+-])(.+)$/;
const ACCEPTANCE_FILE_MAX_BYTES = 64 * 1024;

// The values a repeatable flag was given, or a message for the usage line when it was given without one.
function values(args: ParsedArgs, flag: string): string[] | string {
  if (args.flags[flag] === true) return `--${flag} needs a value`;
  return args.repeated?.[flag] ?? [];
}

function checkEntries(args: ParsedArgs): Array<{ op: '+' | '-'; name: string }> | string {
  const given = values(args, 'check');
  if (typeof given === 'string') return given;
  const out: Array<{ op: '+' | '-'; name: string }> = [];
  for (const entry of given) {
    const match = CHECK_FLAG.exec(entry);
    if (match === null) return `--check ${JSON.stringify(entry)} must be +name or -name`;
    out.push({ op: match[1] as '+' | '-', name: match[2] as string });
  }
  return out;
}

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk: no data root, no store, no file (CS-11). The
// refusals come first: inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run. Without
// the context that tells where the command runs, it refuses.
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = context === undefined ? 'needs an interactive terminal' : refuseOutsideTerminal(env, context);
  if (refused !== undefined) return refused;
  const message = (text: string): string => `${text}\n${USAGE}`;
  const [sub, runId, ...rest] = args.positionals;
  if (sub !== 'amend') return message('contract needs a subcommand: amend');
  if (runId === undefined || !RUN_ID.test(runId) || rest.length > 0) return message('contract amend needs exactly one run ID');
  const reason = args.flags['reason'];
  if (typeof reason !== 'string' || reason.trim() === '') return message('--reason is required: say why the contract changes');
  const budgets = parseBudgetFlags(args);
  if (typeof budgets === 'string') return message(budgets);
  const globs = values(args, 'add-write');
  if (typeof globs === 'string') return message(globs);
  const checks = checkEntries(args);
  if (typeof checks === 'string') return message(checks);
  const file = args.flags['acceptance-file'];
  if (file !== undefined && (typeof file !== 'string' || file === '')) return message('--acceptance-file needs a file');
  const item = args.flags['item'];
  if (item !== undefined && (typeof item !== 'string' || item === '')) return message('--item needs a work item ID');
  if (item !== undefined && file === undefined) return message('--item names the work item of a new criterion and goes with --acceptance-file');
  const decision = args.flags['decision'];
  if (decision !== undefined && (typeof decision !== 'string' || !DECISION_ID.test(decision))) return message('--decision needs a decision ID (dec_...)');
  if (Object.keys(budgets).length === 0 && globs.length === 0 && checks.length === 0 && file === undefined) {
    return message('nothing to amend: name a budget, a write glob, a check or an acceptance file');
  }
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
  if (plan.resolvesDecisionId !== undefined) lines.push(`answers decision ${plan.resolvesDecisionId} as amended:v${plan.version}`);
  return lines.map(stripControl);
}

// What the owner reads before confirming: the field diff, what it invalidates and the decision it answers, one line each, newline-terminated and with
// control characters removed. `contract amend` and the amend chain of `decide` show the same text.
export function renderAmendmentPreview(plan: AmendmentPlan): string {
  return planLines(plan).map((line) => `${line}\n`).join('');
}

// A regular file of at most 64 KiB, decoded as strict UTF-8: the acceptance criteria an owner file adds to a contract (T-03 trust boundary).
function readAcceptanceFile(path: string): { ok: true; text: string } | { ok: false; reason: string } {
  let fd: number;
  try {
    fd = openSync(resolve(path), constants.O_RDONLY);
  } catch (e) {
    return { ok: false, reason: `${JSON.stringify(path)} cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: `${JSON.stringify(path)} is not a regular file` };
    if (stat.size > ACCEPTANCE_FILE_MAX_BYTES) return { ok: false, reason: `${JSON.stringify(path)} is larger than ${ACCEPTANCE_FILE_MAX_BYTES} bytes` };
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    try {
      return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)) };
    } catch {
      return { ok: false, reason: `${JSON.stringify(path)} is not valid UTF-8` };
    }
  } finally {
    closeSync(fd);
  }
}

// One line from standard input, for a command run with no one to ask for it (the one-shot CLI). undefined at end of input.
export function askStdin(question: string): Promise<string | undefined> {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.once('close', () => {
      if (!answered) resolveAnswer(undefined);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolveAnswer(answer);
    });
  });
}

function fail(io: Io, error: PortError): number {
  switch (error.kind) {
    case 'not_found':
    case 'invalid':
      io.err(`${errorLine('contract', describeError(error))}\n`);
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
  const checks = checkEntries(args);
  if (typeof checks === 'string') return fail(io, { kind: 'invalid', field: 'check', reason: checks });
  const globs = values(args, 'add-write');
  if (typeof globs === 'string') return fail(io, { kind: 'invalid', field: 'add-write', reason: globs });

  const request: AmendRequest = { reason: args.flags['reason'] as string };
  if (Object.keys(budgets).length > 0) request.budgets = budgets;
  if (globs.length > 0) request.addWrite = globs;
  if (checks.length > 0) request.checks = checks;
  const file = args.flags['acceptance-file'];
  if (typeof file === 'string') {
    const read = readAcceptanceFile(file);
    if (!read.ok) return fail(io, { kind: 'invalid', field: 'acceptance-file', reason: read.reason });
    const item = args.flags['item'];
    request.acceptance = { text: read.text, ...(typeof item === 'string' ? { item } : {}) };
  }
  const decision = args.flags['decision'];
  if (typeof decision === 'string') request.decisionId = decision;

  const planned = planAmendment(deps, runId, request);
  if (!planned.ok) return fail(io, planned.error);
  const plan = planned.value;
  io.out(renderAmendmentPreview(plan));
  const confirmed = await confirmAndCommit(deps, io, plan, `owner:${responderName()}`);
  return confirmed.kind === 'failed' ? confirmed.code : 0;
}

// How an amendment ended: written (`recorded`), declined at the question (nothing written), or refused by the ledger (`failed`, with the exit code
// of the message already printed).
export type AmendConfirmation = { kind: 'recorded'; version: number } | { kind: 'declined' } | { kind: 'failed'; code: number };

// The question and the write of an amendment the owner has just been shown: asks `apply contract v<n+1>? [y/N]` (through the io, or one line of standard
// input), and on y or yes writes it in the ledger's one transaction (version, limits, stale rows and the decision it answers) and then the contract file.
// Shared by `contract amend` and the amend chain of `decide`, so both ask the same question and write the same rows.
export async function confirmAndCommit(deps: AppDeps, io: Io, plan: AmendmentPlan, authorizedBy: string): Promise<AmendConfirmation> {
  const ask = io.ask ?? askStdin;
  const answer = await ask(`apply contract v${plan.version}? [y/N] `);
  if (answer === undefined || !/^(y|yes)$/i.test(answer.trim())) {
    io.out('not amended\n');
    return { kind: 'declined' };
  }
  const committed = commitAmendment(deps, plan, authorizedBy, deps.clock.nowMs());
  if (!committed.ok) return { kind: 'failed', code: fail(io, committed.error) };
  const { value } = committed;
  io.out(`contract v${value.version} recorded\n`);
  if (value.staleEvidence > 0 || value.staleGates > 0) io.out(`appended ${value.staleEvidence} stale evidence row(s) and ${value.staleGates} stale gate row(s)\n`);
  if (value.resolvedDecisionId !== null) io.out(`decision ${value.resolvedDecisionId} answered amended:v${value.version}\n`);
  return { kind: 'recorded', version: value.version };
}
