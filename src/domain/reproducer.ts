// The smallest useful reproducer of a failing required check (D-11, AUT-10; plan 03-06). Pure. What a person or the next repair
// attempt needs to run the failure again: the check, its command, the exit code, a digest of the output, the failing test IDs when
// the output names them, and the diff since the last pass as a bounded path list and a digest. The output text is never stored,
// only its digest, so a reproducer is bounded and holds nothing the check printed.
export interface Reproducer {
  check: string;
  command: string;
  exitCode: number;
  outputDigest: string;
  failingTests: string[];
  diff: { paths: string[]; digest: string };
}

export interface ReproducerInput {
  check: string;
  argv: readonly string[];
  exitCode: number;
  output: string;
  changedSinceLastPass: readonly string[];
}

export function extractFailingTests(_output: string): string[] {
  return [];
}

export function buildReproducer(input: ReproducerInput): Reproducer {
  return { check: input.check, command: '', exitCode: input.exitCode, outputDigest: '', failingTests: [], diff: { paths: [], digest: '' } };
}
