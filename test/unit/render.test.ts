// The shared OPS-7 render functions (docs/extensions.md "Human-readable output"; plan 02-02). One test group per row of
// the OPS-7 table: result line, tables, states, errors, numbers, colour and escapes; then status through them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { colourEnabled, duration, errorLine, localTime, resultLine, stateWord, stripControl, usd } from '../../src/cli/render/style.ts';
import { renderTable, terminalWidth } from '../../src/cli/render/table.ts';
import { renderStatus } from '../../src/cli/render/status-view.ts';
import { renderInbox, renderRunDetails, renderRuns, runStateWord } from '../../src/cli/render/run-view.ts';
import type { ProjectStatus } from '../../src/app/status.ts';
import type { RunStatus } from '../../src/app/run-status.ts';

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

// ---- run views (plan 02-15) --------------------------------------------------------------------------------------------------------------

const NOW = Date.parse('2026-11-05T14:05:00.000Z');

function runStatus(over: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: 'run_01JABCDEFGHJKMNPQRSTVWXYZ0',
    title: 'Collapse repeated dashes',
    state: 'ready_for_review',
    reason: null,
    lastCheckpoint: { seq: 16, nextAction: 'handoff:fetch', revision: 'git:abcdef1234567890', at: '2026-11-05T14:02:00.000Z' },
    branch: 'avarice/run_01JABCDEFGHJKMNPQRSTVWXYZ0',
    commit: 'abcdef1234567890abcdef1234567890abcdef12',
    clean: true,
    evidence: [{ name: 'test', kind: 'check', status: 'passed', revision: 'git:abcdef1234567890', clean: true }],
    gates: [
      { gate: 'G2', passed: true, revision: 'git:abc' },
      { gate: 'G4', passed: false, revision: 'git:abc' },
    ],
    openDecisions: 0,
    budgets: [
      { name: 'wallClockMs', used: 190_000, limit: 3_600_000 },
      { name: 'costUsd', used: 0.5, limit: 5 },
      { name: 'invocations', used: 1, limit: 3 },
    ],
    references: [{ kind: 'brief', id: 'brief.md', revision: 'sha256:0123456789abcdef0123' }],
    ...over,
  };
}

describe('run details (OPS-7, FR-11)', () => {
  it('prints the result line, then the details, each as the plan lists them', () => {
    const text = renderRunDetails(runStatus(), NOW, 100);
    const lines = text.split('\n');
    assert.equal(lines[0], 'run run_01JABCDEFGHJKMNPQRSTVWXYZ0: ready_for_review');
    assert.match(text, /^ {2}last checkpoint: handoff:fetch \(\d{2}:\d{2}, 3 min ago\)$/m);
    assert.match(text, /^ {2}branch avarice\/run_01JABCDEFGHJKMNPQRSTVWXYZ0 at abcdef1 \(clean\)$/m);
    assert.match(text, /^ {2}evidence: test passed$/m);
    assert.match(text, /^ {2}gates: G2 passed, G4 failed$/m);
    assert.match(text, /^ {2}budget: cost 0\.50 USD of 5\.00 USD; invocations 1 of 3; wall clock 3 min 10 s of 1 h$/m);
    assert.match(text, /^ {2}references: brief brief\.md at 0123456789ab$/m);
    assert.ok(text.endsWith('\n'));
  });

  it('flags a check that already failed at the pin, and says when nothing was handed off or recorded', () => {
    const flagged = renderRunDetails(runStatus({ evidence: [{ name: 'format', kind: 'check', status: 'failed', revision: 'git:a', clean: true, preExisting: true }] }), NOW, 100);
    assert.match(flagged, /^ {2}evidence: format failed \(pre-existing\)$/m);
    const bare = renderRunDetails(runStatus({ commit: null, clean: null, evidence: [], gates: [], budgets: [], references: [], lastCheckpoint: null }), NOW, 100);
    assert.match(bare, /^ {2}branch avarice\/run_\S+ \(not handed off\)$/m);
    assert.match(bare, /^ {2}evidence: none$/m);
    assert.match(bare, /^ {2}gates: none$/m);
    assert.doesNotMatch(bare, /last checkpoint|budget|references/);
  });

  it('shows an interrupted run as paused with its attempt, step and the command that continues it', () => {
    const run = runStatus({
      state: 'verifying',
      interrupted: { state: 'verifying', presentedAs: 'paused', reason: 'verification interrupted', attemptId: 'att_01JX', step: 'verify:checks', nextAction: 'verify:checks', resumeCommand: 'avarice resume run_01JABCDEFGHJKMNPQRSTVWXYZ0' },
    });
    const text = renderRunDetails(run, NOW, 100);
    assert.equal(text.split('\n')[0], 'run run_01JABCDEFGHJKMNPQRSTVWXYZ0: paused (verification interrupted)');
    assert.match(text, /^ {2}interrupted attempt att_01JX at verify:checks$/m);
    assert.match(text, /^ {2}continue with: avarice resume run_01JABCDEFGHJKMNPQRSTVWXYZ0$/m);
    assert.equal(runStateWord(run), 'paused (verification interrupted)');
  });

  it('names the open decisions of a blocked run', () => {
    const text = renderRunDetails(runStatus({ state: 'blocked_on_decision', reason: 'decision', openDecisions: 2 }), NOW, 100);
    assert.equal(text.split('\n')[0], 'run run_01JABCDEFGHJKMNPQRSTVWXYZ0: blocked_on_decision (decision)');
    assert.match(text, /^ {2}decisions: 2 open \(see avarice inbox\)$/m);
  });

  it('strips escape sequences from a title, a branch and an evidence name (T-02-49)', () => {
    const text = renderRuns([runStatus({ title: 'fix \x1b[31mit\x1b[0m', branch: 'avarice/\x1b]0;x\x07r', evidence: [{ name: 'te\x1bst', kind: 'check', status: 'passed', revision: 'g', clean: true }] })], NOW, 120);
    assert.ok(!text.includes('\x1b') && !text.includes('\x07'));
    assert.match(text, /fix it/);
  });

  it('lists interrupted runs first, then blocked ones, then the rest, in the order given within each', () => {
    const interrupted = { state: 'running', presentedAs: 'paused', reason: 'supervisor interrupted', attemptId: null, step: 'launch:run', nextAction: 'launch:run', resumeCommand: 'avarice resume run_C' } as const;
    const text = renderRuns(
      [runStatus({ runId: 'run_A' }), runStatus({ runId: 'run_B', state: 'blocked_on_decision', reason: 'decision' }), runStatus({ runId: 'run_C', state: 'running', interrupted }), runStatus({ runId: 'run_D' })],
      NOW,
      120,
    );
    const at = (id: string): number => text.indexOf(`run ${id}:`);
    assert.ok(at('run_C') < at('run_B') && at('run_B') < at('run_A') && at('run_A') < at('run_D'));
    assert.equal(text.split('\n')[0], 'runs: 4');
    assert.equal(renderRuns([], NOW, 100), '');
  });
});

describe('inbox (OPS-7, FR-11)', () => {
  const decision = { decisionId: 'dec_01JD', runId: 'run_01JR', class: 'acceptance', urgency: 'blocking', openedAt: '2026-11-05T14:02:00.000Z', issue: 'Which approach?\n1. a\n2. b' } as const;
  const review = { runId: 'run_01JR2', title: 't', branch: 'avarice/run_01JR2', commit: 'abcdef1234567890abcdef1234567890abcdef12', repository: '/Users/me/projects/a-repository' } as const;

  it('says how many decisions and reviews there are, and prints nothing else when there are none', () => {
    assert.equal(renderInbox({ decisions: [], reviews: [] }, NOW, 100), 'inbox: 0 open decisions, 0 reviews\n');
    assert.equal(renderInbox({ decisions: [decision], reviews: [review, review] }, NOW, 100).split('\n')[0], 'inbox: 1 open decision, 2 reviews');
  });

  it('prints a decision row and its issue on one line cut to the width, with line breaks made spaces', () => {
    const text = renderInbox({ decisions: [decision], reviews: [] }, NOW, 100);
    assert.match(text, /^dec_01JD\s+run_01JR\s+acceptance\s+blocking\s+\d{2}:\d{2}, 3 min ago$/m);
    assert.match(text, /^issue dec_01JD: Which approach\? 1\. a 2\. b$/m);
    const narrow = renderInbox({ decisions: [{ ...decision, issue: 'x'.repeat(200) }], reviews: [] }, NOW, 60);
    const issue = narrow.split('\n').find((l) => l.startsWith('issue ')) ?? '';
    assert.equal(Array.from(issue).length, 60);
    assert.ok(issue.endsWith('…'));
  });

  it('strips control characters from an issue', () => {
    const text = renderInbox({ decisions: [{ ...decision, issue: 'a\x1b[31mb\x1b[0m\x1b]0;t\x07c' }], reviews: [] }, NOW, 100);
    assert.ok(!text.includes('\x1b') && !text.includes('\x07'));
    assert.match(text, /issue dec_01JD: abc$/m);
  });

  it('prints each review with its branch, a short commit and the repository cut from the start', () => {
    const text = renderInbox({ decisions: [], reviews: [review] }, NOW, 55);
    assert.match(text, /^reviews:$/m);
    assert.match(text, /^run_01JR2\s+avarice\/run_01JR2\s+abcdef1\s+/m);
    assert.ok(text.includes('…') && text.includes('a-repository'));
  });
});
