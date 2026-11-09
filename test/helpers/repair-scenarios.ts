// The scenarios of plan 03-19 (D-11, AUT-10, AUT-16, S-21, S-52): a required check that a later unit breaks, the one repair it gets, and what a repair may not
// do. Shared by test/integration/run-regression.test.ts, run-repair.test.ts, run-g1.test.ts and the kill-point suite. The fake run host plays the units; the
// repository, the sandboxed checks, the ledger, the gates and the supervisor commit are real. No test calls a real model.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { BriefItem } from '../../src/domain/brief.ts';
import { FakeRunHost } from './fake-run-host.ts';
import type { FakeRunOptions } from './fake-run-host.ts';
import { makeRoots } from './run-cli.ts';
import type { CliRoots } from './run-cli.ts';
import {
  FIXED_SLUG,
  LIST_TESTS_SCRIPT,
  RUN_BRIEF,
  RUN_CONVENTIONS,
  RUN_CONVENTIONS_WITH_INVENTORY,
  RUN_REPO_FILES,
  TWO_TESTS,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  profileEnv,
  writeBrief,
  writeItemsBrief,
} from './run-fixtures.ts';
import type { ItemsBriefOptions } from './run-fixtures.ts';
import { git } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';
import type { DepsOverrides } from '../../src/cli/composition.ts';

// A slugify that still passes the repository's own test ('Hello,  World!' becomes 'hello-world') and no longer collapses a dash that is already there: the
// test item A adds ('a--b' becomes 'a-b') fails against it.
export const BROKEN_SLUG = [
  '// Turns a title into a URL slug.',
  'export function slugify(title: string): string {',
  "  return title.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');",
  '}',
  '',
].join('\n');

// The test item A adds to the repository, by name (the fake host appends `test('<name>', ...)` with a slugify assertion).
export const A_TEST = { file: 'test/slug.test.ts', name: 'collapses a dash that is already there' } as const;

export const MARKER_CHECK = { name: 'marker', argv: ['node', 'scripts/marker-check.mjs'], timeoutSec: 60, required: true } as const;
// Fails while src/marker.txt says `bad`.
export const MARKER_SCRIPT = "import { readFileSync } from 'node:fs';\nif (readFileSync('src/marker.txt', 'utf8').includes('bad')) {\n  console.error('marker check failed: src/marker.txt says bad');\n  process.exit(1);\n}\n";

export const S52_ITEMS: readonly BriefItem[] = [
  { id: 'A', title: 'Add a test for dashes that are already there', dependsOn: [], acceptance: ['AC1'] },
  { id: 'B', title: 'Trim the title before it is slugged', dependsOn: ['A'], acceptance: ['AC2'] },
];
export const S52_ACCEPTANCE: readonly string[] = ['A dash that is already there is kept as one dash | verifiedBy: check:test', 'The title is trimmed before it is slugged | verifiedBy: check:test'];

// Unit options: A adds its test and a helper; B's first unit breaks A's test, and the repair puts the slug back. The repair writes its quick records under
// another ID, as a real unit's are (the fake host would write the same files, and a record with unchanged content is no change).
export const A_UNIT: FakeRunOptions = { addTest: A_TEST, edits: { 'src/a-helper.ts': 'export const aHelper = 1;\n' }, summary: true, verification: 'passed' };
export const B_FIRST: FakeRunOptions = { edits: { 'src/slug.ts': BROKEN_SLUG, 'src/b-first.ts': 'export const bFirst = 1;\n' }, summary: true, verification: 'passed' };
export const B_REPAIR: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG, 'src/b-repair.ts': 'export const bRepair = 1;\n' }, quickId: '261105-fk2-repair', summary: true, verification: 'passed' };

export function s52Host(extra: { b?: FakeRunOptions; repair?: FakeRunOptions } = {}): FakeRunOptions {
  return { perItem: { A: A_UNIT, B: { ...B_FIRST, ...(extra.b ?? {}), perAttempt: [{}, { ...B_REPAIR, ...(extra.repair ?? {}) }] } } };
}

// ---- S-21: one item, a test inventory, a unit that breaks a test the repository already had ----------------------------------------------------------

// The name of the test the first unit breaks, and the ID the inventory lists it under (the list script prints `<file> > <name>`).
export const S21_TEST_NAME = 'repeated separators collapse to one dash';
export const S21_TEST_ID = `test/slug.test.ts > ${S21_TEST_NAME}`;
// The first unit puts back the slug the repository had before it was fixed: the test above fails, and the other still passes.
export const S21_FIRST: FakeRunOptions = { edits: { 'src/slug.ts': RUN_REPO_FILES['src/slug.ts'] as string }, summary: true, verification: 'passed' };

// The host script of one repair: the first unit breaks the test, the second unit plays `repair` (its own quick ID, and no edit of the first unit's unless it names them).
export function s21Host(repair: FakeRunOptions): FakeRunOptions {
  return { ...S21_FIRST, perAttempt: [{}, { edits: {}, quickId: '261105-fk2-repair', summary: true, verification: 'passed', ...repair }] };
}

// A run of the single item A on a repository whose slug is fixed (the required check passes at the pin), with a declared test inventory of two tests.
export function s21Scenario(cleanup: string[], o: Pick<ScenarioOptions, 'files'> = {}): Scenario {
  return scenario(cleanup, {
    files: { 'test/slug.test.ts': TWO_TESTS, 'scripts/list-tests.mjs': LIST_TESTS_SCRIPT, ...(o.files ?? {}) },
    conventions: RUN_CONVENTIONS_WITH_INVENTORY,
    briefText: RUN_BRIEF,
  });
}

export interface Scenario {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
}

export interface ScenarioOptions {
  // Files of the repository at the pin, over the standard ones; the slug is already fixed unless a scenario says otherwise (the required check passes at the pin).
  files?: Readonly<Record<string, string>>;
  conventions?: unknown;
  items?: readonly BriefItem[];
  acceptance?: readonly string[];
  brief?: ItemsBriefOptions;
  // The text of a brief without items (a run of the single item A), used instead of the two items above.
  briefText?: string;
}

// An onboarded repository with the conventions committed and a brief with work items written; `cleanup` collects the directories to remove.
export function scenario(cleanup: string[], o: ScenarioOptions = {}): Scenario {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'src/slug.ts': FIXED_SLUG, ...(o.files ?? {}) });
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, o.conventions ?? { ...RUN_CONVENTIONS, agentCommands: ['npm test'] });
  const brief = o.briefText !== undefined ? writeBrief(join(roots.base, 'briefs'), o.briefText) : writeItemsBrief(join(roots.base, 'briefs'), o.items ?? S52_ITEMS, o.acceptance ?? S52_ACCEPTANCE, o.brief ?? {});
  return { roots, repo, pin, brief };
}

export interface Ran {
  runId: string;
  state: string;
  reason: string | null;
  host: FakeRunHost;
}

// `start` and the supervisor in this process with the fake run host, so a test reads the prompts the host was given.
export async function runScenario(s: Scenario, run: FakeRunOptions, overrides: DepsOverrides = {}, budgetOverrides: Readonly<Record<string, number>> = {}): Promise<Ran> {
  const host = new FakeRunHost(run);
  const composed = createDeps(profileEnv(s.roots), { host, ...overrides });
  if (!composed.ok) throw new Error(`composition: ${composed.message}`);
  try {
    const started = startRun(composed.value.deps, { cwd: s.repo.path, briefPath: s.brief, policy: 'routine', budgetOverrides });
    if (!started.ok) throw new Error(`start: ${JSON.stringify(started.failure)}`);
    const outcome = await runSupervisor(composed.value.deps, started.value.runId);
    if (!outcome.ok) throw new Error(`supervisor: ${JSON.stringify(outcome.error)}`);
    return { runId: started.value.runId, state: outcome.value.state, reason: outcome.value.reason, host };
  } finally {
    composed.value.close();
  }
}

// ---- reads of what a run left behind --------------------------------------------------------------------------------------------------------

export interface GateRow {
  gate: string;
  work_item: string | null;
  passed: number;
  failures_json: string;
}

export const gatesOf = (roots: CliRoots, runId: string): GateRow[] =>
  ledgerRows<GateRow>(roots, 'SELECT gate, work_item, passed, failures_json FROM gate_results WHERE run_id = ? ORDER BY rowid', runId);

export interface EvidenceDb {
  name: string;
  kind: string;
  status: string;
  work_item: string | null;
  attempt_id: string;
  environment_json: string;
  artifact_digest: string | null;
}

export const evidenceOf = (roots: CliRoots, runId: string): EvidenceDb[] =>
  ledgerRows<EvidenceDb>(
    roots,
    'SELECT e.name, e.kind, e.status, e.work_item, e.attempt_id, e.environment_json, e.artifact_digest FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? ORDER BY e.rowid',
    runId,
  );

export interface StepDb {
  step: string;
  attempt: number;
  status: string;
  result: Record<string, unknown>;
}

export const stepsOf = (roots: CliRoots, runId: string, name?: string): StepDb[] =>
  ledgerRows<{ step: string; attempt: number; status: string; result_json: string }>(roots, 'SELECT step, attempt, status, result_json FROM run_steps WHERE run_id = ? ORDER BY rowid', runId)
    .filter((r) => name === undefined || r.step === name)
    .map((r) => ({ step: r.step, attempt: r.attempt, status: r.status, result: JSON.parse(r.result_json) as Record<string, unknown> }));

export interface AttemptDb {
  attempt_id: string;
  item_id: string | null;
  reason: string;
  outcome: string | null;
  ended_at: string | null;
}

export const attemptsDb = (roots: CliRoots, runId: string): AttemptDb[] =>
  ledgerRows<AttemptDb>(roots, 'SELECT attempt_id, item_id, reason, outcome, ended_at FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);

export const checkpointsOf = (roots: CliRoots, runId: string): string[] => ledgerRows<{ next_action: string }>(roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);

export const workspaceOf = (roots: CliRoots, runId: string): string => (ledgerRows<{ workspace_path: string }>(roots, 'SELECT workspace_path FROM runs WHERE run_id = ?', runId)[0] as { workspace_path: string }).workspace_path;

export interface CloneCommit {
  sha: string;
  subject: string;
  attempt: string | undefined;
  files: string[];
}

// The commits the run's clone carries on top of the pin, oldest first, with the attempt each names in its trailer and the paths it touched.
export function cloneCommits(clone: string, pin: string): CloneCommit[] {
  const out = git(clone, ['log', '--reverse', '--name-only', '--format=%x1e%H%x1f%s%x1f%B%x1f', `${pin}..HEAD`]);
  return out
    .split('\x1e')
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const [sha = '', subject = '', body = '', files = ''] = entry.split('\x1f');
      return { sha, subject, attempt: /^Avarice-Attempt: (\S+)$/m.exec(body)?.[1], files: files.split('\n').filter((f) => f.trim() !== '') };
    });
}

// A scratch directory for a recorded prompt, a log or a banner.
export const scratchDir = (cleanup: string[], prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
};
