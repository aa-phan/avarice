// Plan 04-41 (CR-05, FR-14): the planning-section heading parser is linear, and a planning line over the cap is body text. The timing case runs the adapter in a
// child process, because synchronous regular-expression work cannot be interrupted by this runner's own timeout.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as planning from '../../src/adapters/context/gsd-planning.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const CHILD = join(import.meta.dirname, '..', 'helpers', 'planning-heading-child.ts');

// The parser this plan replaced, kept here as the reference for ordinary headings.
const OLD_HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const oldHeading = (line: string): string | null => OLD_HEADING.exec(line.replace(/\r$/, ''))?.[1] ?? null;

const headingOf = (line: string): string | null => {
  const fn = (planning as unknown as { headingOf?: (l: string) => string | null }).headingOf;
  assert.equal(typeof fn, 'function', 'gsd-planning.ts exports headingOf');
  return (fn as (l: string) => string | null)(line);
};

describe('gsd-planning headings: a pathological heading line no longer stops the supervisor (CR-05)', () => {
  it('finds in a PROJECT.md whose heading is "# a" + 200,000 spaces + "x" within 2 seconds, in a child process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-heading-'));
    cleanup.push(dir);
    const started = Date.now();
    const child = spawnSync(process.execPath, [CHILD, dir], { timeout: 10_000, killSignal: 'SIGKILL', encoding: 'utf8' });
    const elapsed = Date.now() - started;
    assert.equal(child.status, 0, `the child exited ${String(child.status)} (signal ${String(child.signal)}, error ${String(child.error?.message)}) after ${elapsed} ms: ${child.stderr}`);
    assert.ok(elapsed < 2000, `the child took ${elapsed} ms`);
    assert.match(child.stdout, /^handles=\d+$/m);
  });
});

describe('gsd-planning headings: headingOf semantics', () => {
  const cases: Array<[string, string | null]> = [
    ['## Goal ##', 'Goal'],
    ['## Goal#', 'Goal#'],
    ['#hashtag', null],
    ['####### seven', null],
    ['## Goal   \r', 'Goal'],
    ['# ', null],
    ['#  a  b  ', 'a  b'],
    ['###### six', 'six'],
    ['#\tTabbed', 'Tabbed'],
    ['## Goal\t##\t', 'Goal'],
    ['not a heading', null],
    ['', null],
  ];
  for (const [line, expected] of cases) {
    it(`headingOf(${JSON.stringify(line)}) is ${JSON.stringify(expected)}`, () => {
      assert.equal(headingOf(line), expected);
    });
  }

  it('gives the same heading text as the old regular expression for 20 or more ordinary heading lines', () => {
    const corpus = [
      '# Project',
      '## Goal',
      '### Core value',
      '#### Constraints',
      '##### Notes',
      '###### Deep',
      '# Requirements ##',
      '## Workflow',
      '## Phase 4: Profiles, budgets and the portability proof',
      '## Decisions (locked)',
      '## `code` in a heading',
      '## A heading with trailing spaces   ',
      '## A heading with a carriage return\r',
      '### FR-22 / CON-11',
      '## Quotes "and" apostrophes\'s',
      '## Unicode: naïve café',
      '# One',
      '# Two words',
      '## Numbers 1 2 3',
      '## Mixed   internal   spacing',
      '### Closing hashes ###',
      '## Plan 41: gap closure',
      '#\tTab after the hashes',
    ];
    assert.ok(corpus.length >= 20);
    for (const line of corpus) assert.equal(headingOf(line), oldHeading(line), JSON.stringify(line));
  });

  it('exports the line cap as 2,000 and treats a heading-shaped line of 2,001 characters as body text', () => {
    assert.equal((planning as unknown as { MAX_HEADING_LINE_CHARS?: number }).MAX_HEADING_LINE_CHARS, 2000);
    const atCap = `## ${'x'.repeat(1997)}`;
    const overCap = `## ${'x'.repeat(1998)}`;
    assert.equal(atCap.length, 2000);
    assert.equal(overCap.length, 2001);
    assert.equal(headingOf(atCap), 'x'.repeat(1997));
    assert.equal(headingOf(overCap), null);
  });

  it('does not start a section at a heading-shaped line over the cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-heading-'));
    cleanup.push(dir);
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'PROJECT.md'), `# Top\n\nzorbflux opening\n\n## ${'x'.repeat(1998)}\n\nlater words\n`);
    const source = new planning.GsdPlanningContext({ nowMs: () => Date.parse('2026-11-17T00:00:00Z') });
    const found = await source.find({ term: 'later words', workspace: { stagingPath: dir, repoPath: dir }, indexRevision: 'git:0123456789abcdef' }, 4000);
    assert.ok(found.ok);
    assert.deepEqual(found.value.map((h) => h.ref.id), ['PROJECT.md#top']);
  });
});
