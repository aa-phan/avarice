// The smallest useful reproducer of a failing required check (D-11, AUT-10; plan 03-06). Pure. What a person or the next repair
// attempt needs to run the failure again: the check, its command, the exit code, a digest of the output, the failing test IDs when
// the output names them, and the diff since the last pass as a bounded path list and a digest. The output text is never stored,
// only its digest, so a reproducer is bounded and holds nothing the check printed.
import { digestOf, sha256Hex } from './digest.ts';
import { storedText } from './quick-record.ts';

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

const MAX_FAILING_TESTS = 20;
const MAX_ID_LENGTH = 200;
const MAX_DIFF_PATHS = 20;
const MAX_COMMAND_LENGTH = 1000;

// Terminal colour codes, built from escapes so the source holds no invisible character.
const ANSI = new RegExp('\\u001b\\[[0-9;]*[A-Za-z]', 'g');
// vitest: ` FAIL  <file> > <suite> > <test>`. A line that names only a file has no test ID and is skipped.
const VITEST_FAIL = /^\s*FAIL\s+(\S.*? > .*\S)\s*$/;
// node:test with the TAP reporter: `not ok <n> - <name>`, at any indentation. A TODO or SKIP directive is not a failure.
const TAP_NOT_OK = /^\s*not ok\s+\d+\s+-\s+(.*\S)\s*$/;
const TAP_DIRECTIVE = /\s#\s*(?:TODO|SKIP)\b/i;

// Best effort: the failing test IDs the output names, in order of first appearance, at most 20, each cut to 200 characters and
// stripped of control characters. Output it does not recognize gives []; a reproducer is valid without test IDs.
export function extractFailingTests(output: string): string[] {
  const found: string[] = [];
  for (const raw of output.split('\n')) {
    if (found.length >= MAX_FAILING_TESTS) break;
    const line = raw.replace(ANSI, '').replace(/\r$/, '');
    let name: string | undefined;
    const vitest = VITEST_FAIL.exec(line);
    if (vitest !== null) {
      name = vitest[1];
    } else {
      const tap = TAP_NOT_OK.exec(line);
      if (tap !== null && !TAP_DIRECTIVE.test(line)) name = tap[1];
    }
    if (name === undefined) continue;
    const id = storedText(name, MAX_ID_LENGTH).trim();
    if (id !== '' && !found.includes(id)) found.push(id);
  }
  return found;
}

// The reproducer for one failed check. `changedSinceLastPass` is the path list of the diff since the last revision where the check
// passed: it is sorted and de-duplicated, the first 20 are kept, and the digest covers the whole list so a change past the cap
// still moves it. The output is digested and dropped.
export function buildReproducer(input: ReproducerInput): Reproducer {
  const paths = [...new Set(input.changedSinceLastPass)].sort();
  return {
    check: input.check,
    command: storedText(input.argv.join(' '), MAX_COMMAND_LENGTH),
    exitCode: input.exitCode,
    outputDigest: `sha256:${sha256Hex(input.output)}`,
    failingTests: extractFailingTests(input.output),
    diff: { paths: paths.slice(0, MAX_DIFF_PATHS), digest: digestOf(paths) },
  };
}
