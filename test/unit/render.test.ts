// The shared OPS-7 render functions (docs/extensions.md "Human-readable output"; plan 02-02). One test group per row of
// the OPS-7 table: result line, tables, states, errors, numbers, colour and escapes; then status through them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { colourEnabled, duration, errorLine, localTime, resultLine, stateWord, stripControl, usd } from '../../src/cli/render/style.ts';
import { renderTable, terminalWidth } from '../../src/cli/render/table.ts';
import { renderStatus } from '../../src/cli/render/status-view.ts';
import type { ProjectStatus } from '../../src/app/status.ts';

describe('result line and states (OPS-7 rows 1 and 3)', () => {
  it('prints the ledger word with its reason in parentheses', () => {
    assert.equal(stateWord('blocked', 'enforcement_failure'), 'blocked (enforcement_failure)');
    assert.equal(stateWord('active'), 'active');
    assert.equal(stateWord('active', null), 'active');
    assert.equal(stateWord('blocked', ''), 'blocked');
  });

  it('states the subject and the state on one line, as onboard prints it', () => {
    assert.equal(resultLine('onboarding onb_X', 'blocked', 'enforcement_failure'), 'onboarding onb_X: blocked (enforcement_failure)');
    assert.equal(resultLine('profile personal-local', 'initialized'), 'profile personal-local: initialized');
    assert.equal(resultLine('status', '2 project(s)'), 'status: 2 project(s)');
  });

  it('removes control characters from a recorded subject or reason (T-02-03)', () => {
    assert.equal(resultLine('project \x1b[31mp\x1b[0m', 'blocked', 'a\x07b'), 'project p: blocked (ab)');
  });
});

describe('errors (OPS-7 row 4)', () => {
  it('prefixes a command, and a subcommand when the command names one', () => {
    assert.equal(errorLine('status', 'status failed: x'), 'avarice status: status failed: x');
    assert.equal(errorLine('repo add', 'refused'), 'avarice repo add: refused');
  });

  it('prefixes only the program before a command is chosen', () => {
    assert.equal(errorLine(undefined, "unknown command 'x'"), "avarice: unknown command 'x'");
  });

  it('keeps a multi-line message as given and ends without a newline', () => {
    assert.equal(errorLine('repo', 'a\nusage: b'), 'avarice repo: a\nusage: b');
  });

  it('removes escape sequences from the message', () => {
    assert.equal(errorLine('repo add', 'path \x1b]0;title\x07x'), 'avarice repo add: path x');
  });
});

describe('numbers (OPS-7 row 5)', () => {
  it('prints money in USD with two decimals', () => {
    assert.equal(usd(0.1), '0.10 USD');
    assert.equal(usd(5), '5.00 USD');
    assert.equal(usd(0.1596), '0.16 USD');
    assert.equal(usd(0), '0.00 USD');
  });

  it('prints a duration in its largest whole unit and the remainder one unit down', () => {
    assert.equal(duration(190_000), '3 min 10 s');
    assert.equal(duration(4_000), '4 s');
    assert.equal(duration(180_000), '3 min');
    assert.equal(duration(3_600_000), '1 h');
    assert.equal(duration(3_900_000), '1 h 5 min');
    assert.equal(duration(90_000_000), '1 d 1 h');
    assert.equal(duration(0), '0 s');
    assert.equal(duration(400), '<1 s');
    assert.equal(duration(-5), '0 s');
  });

  it('prints a local time with a relative form', () => {
    const now = new Date(2026, 10, 5, 14, 5, 0).getTime();
    assert.equal(localTime(now - 180_000, now), '14:02, 3 min ago');
    assert.ok(localTime(now - 180_000, now).endsWith(', 3 min ago'));
    assert.equal(localTime(now - 30_000, now), '14:04, 30 s ago');
    assert.equal(localTime(now - 2 * 3_600_000, now), '12:05, 2 h ago');
    assert.equal(localTime(now - 200, now), '14:04, just now');
    assert.equal(localTime(now + 120_000, now), '14:07, in 2 min');
  });

  it('adds the local date when the time is not today', () => {
    const now = new Date(2026, 10, 5, 12, 0, 0).getTime();
    assert.equal(localTime(new Date(2026, 10, 4, 9, 30, 0).getTime(), now), '2026-11-04 09:30, 1 d ago');
  });
});

describe('colour and escapes (OPS-7 row 6)', () => {
  const env = { TERM: 'xterm-256color' };
  it('is on only for a terminal with NO_COLOR unset and TERM not dumb', () => {
    assert.equal(colourEnabled({ isTTY: true, env }), true);
    assert.equal(colourEnabled({ isTTY: false, env }), false);
    assert.equal(colourEnabled({ isTTY: undefined, env }), false);
    assert.equal(colourEnabled({ isTTY: true, env: { ...env, NO_COLOR: '1' } }), false);
    assert.equal(colourEnabled({ isTTY: true, env: { ...env, NO_COLOR: '' } }), false);
    assert.equal(colourEnabled({ isTTY: true, env: { ...env, TERM: 'dumb' } }), false);
  });

  it('removes C0 and C1 controls and ANSI sequences but keeps newline and tab', () => {
    assert.equal(stripControl('a\nb\tc'), 'a\nb\tc');
    assert.equal(stripControl('\x1b[31mred\x1b[0m'), 'red');
    assert.equal(stripControl('x\x1b[2Ky'), 'xy');
    assert.equal(stripControl('x\x1b]0;window title\x07y'), 'xy');
    assert.equal(stripControl('x\x1b]8;;http://e\x1b\\link\x1b]8;;\x1b\\y'), 'xlinky');
    assert.equal(stripControl('a\rb\x08c\x00d\x7fe'), 'abcde');
    assert.equal(stripControl('a\x9b31mb\x85c'), 'abc');
    assert.equal(stripControl('a\x1bPdcs\x1b\\b'), 'ab');
    assert.equal(stripControl('plain text, 100% ünïcode ✔'), 'plain text, 100% ünïcode ✔');
  });
});

describe('tables (OPS-7 row 2)', () => {
  const columns = [
    { key: 'id', header: 'ID', subject: true },
    { key: 'note', header: 'NOTE' },
  ] as const;

  it('prints a header row and aligns the columns', () => {
    const text = renderTable(columns, [{ id: 'a', note: 'first' }, { id: 'longer-id', note: 'second' }], 80);
    assert.equal(text, ['ID         NOTE', 'a          first', 'longer-id  second', ''].join('\n'));
  });

  it('cuts a non-subject column with … to fit the width and never cuts the subject', () => {
    const rows = [{ id: 'proj_ABCDEFGHJKMNPQRSTVWXYZ0123', note: 'a very long note that does not fit in the line at all' }, { id: 'p2', note: 'short' }];
    const text = renderTable(columns, rows, 30);
    const lines = text.split('\n');
    assert.equal(lines.at(-1), '');
    assert.ok(lines[1]?.startsWith('proj_ABCDEFGHJKMNPQRSTVWXYZ0123'), 'the ID is whole');
    const tight = renderTable(columns, [{ id: 'abc-123', note: 'a very long note that does not fit in the line at all' }], 30);
    const [header, row] = tight.split('\n');
    assert.ok((header ?? '').startsWith('ID       NOTE'), header);
    assert.ok((row ?? '').length <= 30, `row is ${(row ?? '').length} columns`);
    assert.ok((row ?? '').endsWith('…'), row);
    assert.ok((row ?? '').startsWith('abc-123  a very long'), row);
  });

  it('does not cut when the table fits', () => {
    const text = renderTable(columns, [{ id: 'abc-123', note: 'fits' }], 30);
    assert.ok(!text.includes('…'));
  });

  it('lets a subject column overflow rather than cutting it', () => {
    const text = renderTable(columns, [{ id: 'x'.repeat(40), note: 'some note here' }], 20);
    assert.ok(text.split('\n')[1]?.startsWith('x'.repeat(40)));
  });

  it('keeps the order of the rows and of the columns', () => {
    const text = renderTable(columns, [{ id: 'z', note: '1' }, { id: 'a', note: '2' }, { id: 'm', note: '3' }], 40);
    const lines = text.split('\n');
    assert.deepEqual(lines.slice(1, 4).map((l) => l.split(/\s+/)[0]), ['z', 'a', 'm']);
    assert.ok((lines[0] ?? '').indexOf('ID') < (lines[0] ?? '').indexOf('NOTE'));
  });

  it('cuts the start of a column marked cut: start, keeping the tail of a path', () => {
    const cols = [{ key: 'id', header: 'ID', subject: true }, { key: 'path', header: 'PATH', cut: 'start' as const }];
    const text = renderTable(cols, [{ id: 'p1', path: '/Users/someone/projects/the-repository' }], 30);
    const row = text.split('\n')[1] ?? '';
    assert.ok(row.length <= 30, row);
    assert.ok(row.includes('…') && row.endsWith('the-repository'), row);
  });

  it('cuts a column marked keep only after the other cuttable columns are at their minimum', () => {
    const cols = [
      { key: 'id', header: 'ID', subject: true },
      { key: 'path', header: 'PATH', cut: 'start' as const },
      { key: 'next', header: 'NEXT', keep: true },
    ];
    const row = { id: 'p1', path: '/a/very/long/path/to/some/repository', next: 'compile-contract' };
    const roomy = (renderTable(cols, [row], 36).split('\n')[1] ?? '').split(/\s{2,}/);
    assert.equal(roomy[2], 'compile-contract', 'the kept column is whole while the path can still shrink');
    assert.ok((roomy[1] ?? '').startsWith('…'));
    const tight = renderTable(cols, [row], 20).split('\n')[1] ?? '';
    assert.ok(tight.includes('…'), tight);
    assert.ok(!tight.endsWith('compile-contract'), 'the kept column is cut once the path is at its minimum');
  });

  it('prints the header alone for no rows', () => {
    assert.equal(renderTable(columns, [], 40), 'ID  NOTE\n');
  });

  it('strips control characters from every cell and flattens newlines (T-02-03)', () => {
    const text = renderTable(columns, [{ id: 'a', note: 'x\x1b[31my\nz' }], 40);
    assert.equal(text.split('\n').length, 3);
    assert.ok(!text.includes('\x1b'));
    assert.ok(text.includes('xy z'));
  });

  it('reads a missing cell as empty', () => {
    assert.equal(renderTable(columns, [{ id: 'a' }], 40), 'ID  NOTE\na\n');
  });

  it('takes the terminal width from the stream, or 100 when unknown', () => {
    assert.equal(terminalWidth(132), 132);
    assert.equal(terminalWidth(undefined), 100);
    assert.equal(terminalWidth(0), 100);
  });
});

function project(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    projectId: 'proj_01JABCDEFGHJKMNPQRSTVWXYZ0',
    repoPath: '/work/repo',
    onboardingId: 'onb_01JABCDEFGHJKMNPQRSTVWXYZ0',
    state: 'active',
    reason: null,
    recordVersion: 1,
    onboardedRevision: 'git:9f1cd8d',
    mapping: { mode: 'full', completeness: 'complete', freshness: 'fresh' },
    indexes: { graph: {}, intel: {}, absent: [{ index: 'knowledge', reason: 'graphify-missing' }] },
    ...overrides,
  };
}

describe('status through the shared functions', () => {
  it('starts with a result line and prints the table', () => {
    const text = renderStatus([project()], { width: 200 });
    const lines = text.split('\n');
    assert.equal(lines[0], 'status: 1 project(s)');
    assert.deepEqual((lines[1] ?? '').split(/\s+/).filter((s) => s !== ''), ['PROJECT', 'REPOSITORY', 'ACTIVITY', 'STATE', 'NEXT']);
    assert.ok(lines[2]?.includes('proj_01JABCDEFGHJKMNPQRSTVWXYZ0'));
    assert.ok(lines[2]?.includes('/work/repo'));
    assert.ok(/\bactive\b/.test(lines[2] ?? ''));
    assert.ok(text.endsWith('\n'));
  });

  it('names the onboarding with its ID and state below the table, so the table stays narrow', () => {
    const text = renderStatus([project({ state: 'blocked', reason: 'decision', recordVersion: null, onboardedRevision: null, mapping: null, indexes: {} })], { width: 200 });
    assert.ok(text.includes('\nonboarding onb_01JABCDEFGHJKMNPQRSTVWXYZ0: blocked (decision)\n'), text);
    assert.ok(!(text.split('\n')[2] ?? '').includes('onb_'), 'the ID is not in the table row');
  });

  it('describes the record and its indexes after the table', () => {
    const text = renderStatus([project()], { width: 200 });
    assert.match(text, /\nrecord v1 at git:9f1cd8d; mapping full \(complete, fresh\); indexes: graph, intel, knowledge absent \(graphify-missing\)/);
  });

  it('shows an interrupted onboarding with its state, its next action and the resume command', () => {
    const text = renderStatus(
      [
        project({
          state: 'mapping',
          recordVersion: null,
          onboardedRevision: null,
          mapping: null,
          indexes: {},
          interrupted: { state: 'mapping', nextAction: 'launch:map', resumeCommand: 'avarice resume onb_01JABCDEFGHJKMNPQRSTVWXYZ0' },
        }),
      ],
      { width: 200 },
    );
    const row = text.split('\n')[2] ?? '';
    assert.match(row, /\binterrupted\s+mapping\s+launch:map$/);
    assert.ok(text.includes('\nonboarding onb_01JABCDEFGHJKMNPQRSTVWXYZ0: mapping (interrupted)\n'), text);
    assert.ok(text.includes('continue with: avarice resume onb_01JABCDEFGHJKMNPQRSTVWXYZ0\n'));
    assert.ok(text.indexOf('continue with:') > text.indexOf('launch:map'), 'the line follows the table');
  });

  it('prints a blocked state with its reason in parentheses', () => {
    const text = renderStatus([project({ state: 'blocked', reason: 'enforcement_failure', recordVersion: null, onboardedRevision: null, mapping: null, indexes: {} })], { width: 200 });
    assert.ok(text.includes('blocked (enforcement_failure)'));
  });

  it('handles a project with no onboarding and no projects at all', () => {
    const none = renderStatus([project({ onboardingId: null, state: 'unregistered', recordVersion: null, onboardedRevision: null, mapping: null, indexes: {} })], { width: 200 });
    assert.ok(none.includes('not onboarded'));
    const empty = renderStatus([], { width: 80 });
    assert.equal(empty.split('\n')[0], 'status: 0 project(s)');
    assert.match(empty, /No projects registered/);
  });

  it('keeps the order the read model gives', () => {
    const text = renderStatus([project({ projectId: 'proj_B' }), project({ projectId: 'proj_A' })], { width: 200 });
    assert.ok(text.indexOf('proj_B') < text.indexOf('proj_A'));
  });

  it('strips escape sequences from a repository path (T-02-03)', () => {
    const text = renderStatus([project({ repoPath: '/work/\x1b[2Jrepo\x1b]0;pwn\x07' })], { width: 200 });
    assert.ok(!text.includes('\x1b') && !text.includes('\x07'));
    assert.ok(text.includes('/work/repo'));
  });

  it('cuts the repository column and leaves the project ID whole at a narrow width', () => {
    const text = renderStatus([project({ repoPath: '/Users/someone/a/very/deep/path/to/the-repository' })], { width: 90 });
    const row = text.split('\n')[2] ?? '';
    assert.ok(row.includes('proj_01JABCDEFGHJKMNPQRSTVWXYZ0'));
    assert.ok(row.includes('…'));
  });
});
