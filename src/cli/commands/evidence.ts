// avarice evidence add --kind ci|review|manual --file <path> [--ref <url>] --run <runId>
// The manual equivalent of CI results and review feedback (plan 04-27; FR-19): records a log or a note the owner brings in as one evidence row of the run, with the file
// stored redacted and the source, the digest of the file, who recorded it and when. The row is never a measurement: it is `inconclusive`, it never overwrites an earlier row
// and it satisfies no gate (how review and CI feedback enter a new attempt is a later phase's). Offline: it writes the ledger and the artifact store only.
//
// It refuses inside a run (AVARICE_RUN, or the run's process tree) before the profile is resolved, so a run cannot record evidence for itself; it needs no terminal, so the
// owner can script a paste. Exit 0 recorded, 3 an unknown run or a run with no attempt yet, 64 a usage error or a file that cannot be stored (empty, not UTF-8, too large),
// 70 an internal failure.
import { basename, resolve } from 'node:path';
import type { AppDeps } from '../../app/deps.ts';
import { EVIDENCE_KINDS, MANUAL_EVIDENCE_MAX_BYTES, REF_MAX_CHARS, isEvidenceKind, readInputFile, recordManualEvidence } from '../../app/manual-inputs.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { refuseInsideRun, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { EXIT_USAGE, failure, runIdProblem } from '../manual-command.ts';
import { errorLine, stripControl } from '../render/style.ts';

const USAGE = 'usage: avarice evidence add --kind ci|review|manual --file <path> [--ref <url>] --run <runId>';

// The module writes the ledger, so the store is opened for writing, and it needs no GSD.
export const readOnly = false;
export const needsGsd = false;

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk (T-04-74).
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = refuseInsideRun(env, context);
  if (refused !== undefined) return refused;
  const message = (text: string): string => `${text}\n${USAGE}`;
  if (args.positionals[0] !== 'add' || args.positionals.length !== 1) return message('the form is `evidence add`');
  const kind = args.flags['kind'];
  if (typeof kind !== 'string' || !isEvidenceKind(kind)) return message(`--kind is one of ${EVIDENCE_KINDS.join(', ')}`);
  const file = args.flags['file'];
  if (typeof file !== 'string' || file === '') return message('--file needs the path of the log or note');
  const ref = args.flags['ref'];
  if (ref !== undefined && (typeof ref !== 'string' || ref === '' || ref.length > REF_MAX_CHARS)) return message(`--ref needs a reference of at most ${REF_MAX_CHARS} characters`);
  const run = runIdProblem(args.flags['run']);
  if (run !== undefined) return message(run);
  return undefined;
}

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const file = resolve(args.flags['file'] as string);
  const read = readInputFile(file, MANUAL_EVIDENCE_MAX_BYTES);
  if (!read.ok) {
    io.err(`${errorLine('evidence', `${stripControl(file)} ${read.reason}`)}\n`);
    return EXIT_USAGE;
  }
  const ref = args.flags['ref'];
  const recorded = recordManualEvidence(deps, {
    runId: args.flags['run'] as string,
    kind: args.flags['kind'] as string,
    fileName: basename(file),
    bytes: read.bytes,
    ...(typeof ref === 'string' ? { ref } : {}),
    by: responderName(),
    nowMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return failure(io, 'evidence', recorded.error);
  io.out(`recorded ${recorded.value.kind} evidence ${recorded.value.evidenceId} (${recorded.value.fileDigest}) for run ${args.flags['run'] as string}; it satisfies no gate\n`);
  return 0;
}
