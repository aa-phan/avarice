// Plan 02-18 Task 1 (CON-1, T-02-59): the enforcement coverage matrix in docs/containment.md is checked, so the owner's
// picture of what is enforced cannot drift from what a test proves. Every row needs five non-empty cells, a mechanism that
// labels each control P (prevention), D (detection) or R (recovery) in that order, and every `test/...` file named in the
// last column must be tracked by git. A named file that is missing, or that only shares a prefix with a tracked one, is
// reported. The checker is exercised on synthetic tables first and then on the real document.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEADING = '## Enforcement coverage matrix';
const COLUMNS = 5;
const LABEL_ORDER = 'PDR';

interface MatrixRow {
  line: number;
  cells: string[];
}

interface Matrix {
  header: string[];
  rows: MatrixRow[];
}

// A table row split on `|` that is not escaped as `\|`; an escaped pipe is cell content (GFM). Backticks do not change the
// split, so a `\|` inside a code span stays inside its cell and the backticks stay part of the text.
export function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i] as string;
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  // A row starts and ends with a pipe: the empty pieces before the first and after the last are not cells.
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop();
  return cells.map((cell) => cell.trim());
}

export function parseMatrix(markdown: string): Matrix | undefined {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start < 0) return undefined;
  let i = start + 1;
  while (i < lines.length && !(lines[i] as string).trim().startsWith('|')) {
    if ((lines[i] as string).startsWith('#')) return undefined;
    i += 1;
  }
  if (i >= lines.length) return undefined;
  const header = splitRow(lines[i] as string);
  i += 1;
  if (i < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i] as string)) i += 1;
  const rows: MatrixRow[] = [];
  for (; i < lines.length && (lines[i] as string).trim().startsWith('|'); i += 1) rows.push({ line: i + 1, cells: splitRow(lines[i] as string) });
  return { header, rows };
}

// The labels of a mechanism cell, in the order they appear: `P: ...; D: ...; R: ...`. A label opens the cell or follows `; `.
export function mechanismLabels(cell: string): string[] {
  return [...cell.matchAll(/(?:^|;\s+)([PDR]):\s/g)].map((match) => match[1] as string);
}

// The `test/...` files a tests cell names in backticks.
export function namedTests(cell: string): string[] {
  return [...cell.matchAll(/`(test\/[^`\s]+)`/g)].map((match) => match[1] as string);
}

// Every problem found in the matrix of a document. `tracked` is the set of git-tracked paths; a path is tracked only on an
// exact match, never by prefix.
export function checkMatrix(markdown: string, tracked: ReadonlySet<string>): string[] {
  const matrix = parseMatrix(markdown);
  if (matrix === undefined) return [`the document has no table under "${HEADING}"`];
  const problems: string[] = [];
  if (matrix.header.length !== COLUMNS) problems.push(`the header has ${matrix.header.length} columns, expected ${COLUMNS}`);
  if (matrix.rows.length === 0) problems.push('the matrix has no rows');
  for (const row of matrix.rows) {
    const name = row.cells[0] !== undefined && row.cells[0] !== '' ? row.cells[0].slice(0, 60) : `line ${row.line}`;
    if (row.cells.length !== COLUMNS) {
      problems.push(`row "${name}" (line ${row.line}) has ${row.cells.length} cells, expected ${COLUMNS}`);
      continue;
    }
    row.cells.forEach((cell, index) => {
      if (cell === '') problems.push(`row "${name}" (line ${row.line}) has an empty cell: ${matrix.header[index] ?? `column ${index + 1}`}`);
    });
    const mechanism = row.cells[1] as string;
    if (mechanism !== '') {
      const labels = mechanismLabels(mechanism);
      if (labels.length === 0) problems.push(`row "${name}" (line ${row.line}) has a mechanism without a P:, D: or R: label`);
      for (let k = 1; k < labels.length; k += 1) {
        if (LABEL_ORDER.indexOf(labels[k] as string) < LABEL_ORDER.indexOf(labels[k - 1] as string)) {
          problems.push(`row "${name}" (line ${row.line}) lists mechanism labels out of order (${labels.join(', ')}); the order is P, D, R`);
          break;
        }
      }
    }
    for (const file of namedTests(row.cells[COLUMNS - 1] as string)) {
      if (!tracked.has(file)) problems.push(`row "${name}" (line ${row.line}) names ${file}, which is not tracked by git`);
    }
  }
  return problems;
}

function table(...rows: string[]): string {
  return [HEADING, '', '| Restriction | Mechanism | Covered paths | Limitations | Bypass and failure tests |', '|---|---|---|---|---|', ...rows, ''].join('\n');
}

const TRACKED: ReadonlySet<string> = new Set(['test/unit/a.test.ts', 'test/integration/b.test.ts']);
const GOOD_ROW = '| writes | P: sandbox; D: diff; R: discard | Bash | none known | `test/unit/a.test.ts` |';

describe('the matrix checker on synthetic tables (CON-1)', () => {
  it('accepts a complete row whose test is tracked', () => {
    assert.deepEqual(checkMatrix(table(GOOD_ROW), TRACKED), []);
  });

  it('adjacency: a path that only shares a prefix with a tracked file is reported missing', () => {
    const row = '| writes | P: sandbox | Bash | none | `test/unit/a.test.tsx` |';
    assert.deepEqual(checkMatrix(table(row), TRACKED), ['row "writes" (line 5) names test/unit/a.test.tsx, which is not tracked by git']);
    const shorter = '| writes | P: sandbox | Bash | none | `test/unit/a.test` |';
    assert.equal(checkMatrix(table(shorter), TRACKED).length, 1, 'a prefix of a tracked file is missing too');
  });

  it('empty: a row whose tests cell is empty fails, and so does any other empty cell', () => {
    const noTests = '| writes | P: sandbox | Bash | none |  |';
    assert.deepEqual(checkMatrix(table(noTests), TRACKED), ['row "writes" (line 5) has an empty cell: Bypass and failure tests']);
    const noLimits = '| writes | P: sandbox | Bash |  | `test/unit/a.test.ts` |';
    assert.deepEqual(checkMatrix(table(noLimits), TRACKED), ['row "writes" (line 5) has an empty cell: Limitations']);
    const noName = '|  | P: sandbox | Bash | none | `test/unit/a.test.ts` |';
    assert.match(checkMatrix(table(noName), TRACKED).join('\n'), /empty cell: Restriction/);
  });

  it('encoding: escaped pipes and backticks inside a cell are cell content, not separators', () => {
    const row = '| a \\| b | P: sandbox \\| seatbelt; D: `a \\| b` | Bash | uses `\\|` | `test/unit/a.test.ts` and `test/integration/b.test.ts` |';
    assert.deepEqual(splitRow(row), ['a | b', 'P: sandbox | seatbelt; D: `a | b`', 'Bash', 'uses `|`', '`test/unit/a.test.ts` and `test/integration/b.test.ts`']);
    assert.deepEqual(checkMatrix(table(row), TRACKED), []);
    // The same line with an unescaped pipe has one cell too many.
    const broken = '| a | b | P: sandbox | Bash | none | `test/unit/a.test.ts` |';
    assert.equal(splitRow(broken).length, 6);
    assert.match(checkMatrix(table(broken), TRACKED).join('\n'), /has 6 cells, expected 5/);
  });

  it('a path in a code span that holds an escaped pipe is not read as a test path', () => {
    const row = '| writes | P: sandbox | Bash | none | `test/unit/a.test.ts` (not `test/unit/a.test.ts \\| other`) |';
    assert.deepEqual(namedTests(splitRow(row)[4] as string), ['test/unit/a.test.ts']);
  });

  it('a mechanism needs at least one P:, D: or R: label', () => {
    const none = '| writes | sandbox and hook | Bash | none | `test/unit/a.test.ts` |';
    assert.deepEqual(checkMatrix(table(none), TRACKED), ['row "writes" (line 5) has a mechanism without a P:, D: or R: label']);
    const prose = '| writes | D and P at the gate | Bash | none | `test/unit/a.test.ts` |';
    assert.equal(checkMatrix(table(prose), TRACKED).length, 1);
    const single = '| writes | R: restore | Bash | none | `test/unit/a.test.ts` |';
    assert.deepEqual(checkMatrix(table(single), TRACKED), []);
  });

  it('ordering: when more than one label is present they appear in the order P, D, R', () => {
    for (const bad of ['D: diff; P: sandbox', 'R: discard; P: sandbox', 'P: sandbox; R: discard; D: diff', 'D: diff; R: discard; P: hook']) {
      const row = `| writes | ${bad} | Bash | none | \`test/unit/a.test.ts\` |`;
      assert.match(checkMatrix(table(row), TRACKED).join('\n'), /out of order/, bad);
    }
    for (const good of ['P: a; P: b; D: c', 'P: a; R: b', 'D: a; R: b', 'P: a; D: b; R: c']) {
      const row = `| writes | ${good} | Bash | none | \`test/unit/a.test.ts\` |`;
      assert.deepEqual(checkMatrix(table(row), TRACKED), [], good);
    }
  });

  it('reports a row with the wrong number of cells, a missing table and a missing section', () => {
    assert.match(checkMatrix(table('| writes | P: sandbox | Bash |'), TRACKED).join('\n'), /has 3 cells, expected 5/);
    assert.match(checkMatrix('# Title\n\nno matrix here\n', TRACKED)[0] as string, /no table under/);
    assert.match(checkMatrix(`${HEADING}\n\nprose only\n\n## Next\n`, TRACKED)[0] as string, /no table under/);
  });

  it('reads the table under the heading only, and stops at the first line that is not a row', () => {
    const doc = `${table(GOOD_ROW)}\nSome prose.\n\n| other | table |\n|---|---|\n| x | y |\n`;
    assert.equal(parseMatrix(doc)?.rows.length, 1);
  });
});

// The run-purpose rows plan 02-18 adds (CON-1, D-11, ONB-10, D-02, D-03), by a pattern on the restriction cell.
const RUN_ROWS: ReadonlyArray<readonly [string, RegExp]> = [
  ['glob write set and protected paths', /glob write set/i],
  ['read-before-edit', /read-before-edit/i],
  ['loop limits', /loop limits/i],
  ['command identity with contract commands', /command identity.*contract commands/i],
  ['no human prompts', /no human prompts/i],
  ['no background shell', /no background shell/i],
  ['no network for invocations', /no network for invocations/i],
  ['the supervisor-step registry exception for the dependency install', /supervisor-step registry exception/i],
  ['ONB-10 validation and its detection-only network limit', /ONB-10 validation/i],
  ['the supervisor commit and the hand-off write to the source', /supervisor commit and the hand-off/i],
];

describe('docs/containment.md coverage matrix (CON-1, T-02-59)', () => {
  const markdown = readFileSync(join(ROOT, 'docs', 'containment.md'), 'utf8');
  const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', 'test'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter((p) => p !== ''));

  it('is complete: five cells in every row, labelled mechanisms in order, every named test file tracked', () => {
    assert.deepEqual(checkMatrix(markdown, tracked), []);
  });

  it('has the run-purpose rows', () => {
    const matrix = parseMatrix(markdown);
    assert.ok(matrix !== undefined);
    const missing = RUN_ROWS.filter(([, pattern]) => !matrix.rows.some((row) => pattern.test(row.cells[0] ?? ''))).map(([name]) => name);
    assert.deepEqual(missing, []);
  });

  it('names at least one tracked test for every run-purpose row', () => {
    const matrix = parseMatrix(markdown);
    assert.ok(matrix !== undefined);
    const bare: string[] = [];
    for (const [name, pattern] of RUN_ROWS) {
      const row = matrix.rows.find((candidate) => pattern.test(candidate.cells[0] ?? ''));
      if (row !== undefined && namedTests(row.cells[COLUMNS - 1] ?? '').length === 0) bare.push(name);
    }
    assert.deepEqual(bare, []);
  });

  it('names every limitation 8 outcome: resolved, with the spike record', () => {
    assert.match(markdown, /8\. Resolved/);
    assert.match(markdown, /spikes\/phase-2-wave-0\/S2-D-sandbox-commit\.md/);
  });
});
