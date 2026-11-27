// What the four manual-input commands share (plan 04-27; FR-19): the run ID check, the exit codes and the one place a port error becomes an exit code and a line.
// Exit 0 recorded, 3 an unknown run (or a run with nothing to attach to), 64 a usage error or an input that cannot be stored, 70 an internal failure.
import { describeError } from '../adapters/sqlite/db.ts';
import type { PortError } from '../domain/result.ts';
import type { Io } from './args.ts';
import { errorLine } from './render/style.ts';

export const EXIT_NOT_FOUND = 3;
export const EXIT_USAGE = 64;
export const EXIT_INTERNAL = 70;
export const RUN_ID = /^run_[0-9A-Za-z]{4,64}$/;

// The line for a run ID that is missing or malformed, or undefined when it is fine.
export function runIdProblem(value: string | true | undefined): string | undefined {
  return typeof value === 'string' && RUN_ID.test(value) ? undefined : '--run needs a run ID (run_...)';
}

// Reports a failed recording on the error stream and returns the exit code.
export function failure(io: Io, command: string, error: PortError): number {
  if (error.kind === 'not_found') {
    io.err(`${errorLine(command, `not found: ${describeError(error)}`)}\n`);
    return EXIT_NOT_FOUND;
  }
  if (error.kind === 'invalid') {
    io.err(`${errorLine(command, describeError(error))}\n`);
    return EXIT_USAGE;
  }
  io.err(`${errorLine(command, `failed: ${describeError(error)}`)}\n`);
  return EXIT_INTERNAL;
}
