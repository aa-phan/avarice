// The S-17 scenario of plan 03-18 (AUT-3): four work items, A, B (depends on A), C (independent) and D (depends on B), where the unit of B stops to ask. The
// offline suites of the plan (test/integration/run-independent-work.test.ts, test/fault/run-park.test.ts) share the brief, the host script and the
// reads of what a blocked run leaves behind. The fake run host plays one script per item; everything else is real: git, the sandboxed checks, the
// ledger, the gates and the supervisor commit. No test calls a real model.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefItem } from '../../src/domain/brief.ts';
import type { FakeRunOptions } from './fake-run-host.ts';
import { makeRoots } from './run-cli.ts';
import type { CliRoots } from './run-cli.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, writeItemsBrief } from './run-fixtures.ts';
import { git } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';

export const S17_ITEMS: readonly BriefItem[] = [
  { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], acceptance: ['AC1'] },
  { id: 'B', title: 'Map a status code', dependsOn: ['A'], acceptance: ['AC2'] },
  { id: 'C', title: 'Add a helper module', dependsOn: [], acceptance: ['AC3'] },
  { id: 'D', title: 'Cover the status mapper with a test', dependsOn: ['B'], acceptance: ['AC4'] },
];

export const S17_ACCEPTANCE: readonly string[] = [
  'Repeated separators collapse to one dash | verifiedBy: check:test',
  'A status code is mapped | verifiedBy: check:test',
  'The helper module exists | verifiedBy: check:test',
  'The status mapper has a test | verifiedBy: check:test',
];

// The question B's unit ends with: a question line, then numbered choices as the last lines, the shape the pause detector reads.
export const S17_QUESTION = 'Which status code?\n1. 404\n2. 410';

export const S17_FILES: Readonly<Record<string, string>> = {
  A: 'src/slug.ts',
  B: 'src/status.ts',
  C: 'src/helper.ts',
  D: 'src/status-test-helper.ts',
};

const FILE_TEXT: Readonly<Record<string, string>> = {
  'src/slug.ts': FIXED_SLUG,
  'src/status.ts': 'export const status = 410;\n',
  'src/helper.ts': 'export const helper = 1;\n',
  'src/status-test-helper.ts': 'export const statusTest = true;\n',
};

// One item's unit: it edits its own file, writes its records and passes its verification. `extra` adds to it (a question, a record of the prompt).
export function unitOf(itemId: keyof typeof S17_FILES, extra: FakeRunOptions = {}): FakeRunOptions {
  const file = S17_FILES[itemId] as string;
  return { edits: { [file]: FILE_TEXT[file] as string }, summary: true, verification: 'passed', ...extra };
}

// The host script of the scenario: B asks (and has edited its file when it did), A, C and D finish.
export function s17Host(b: FakeRunOptions = { question: S17_QUESTION }): FakeRunOptions {
  return { perItem: { A: unitOf('A'), B: unitOf('B', b), C: unitOf('C'), D: unitOf('D') } };
}

export interface S17Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
}

// An onboarded repository with the conventions committed and the four-item brief written; `cleanup` collects the directories to remove.
export function s17Fixture(cleanup: string[]): S17Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, pin, brief: writeItemsBrief(join(roots.base, 'briefs'), S17_ITEMS, S17_ACCEPTANCE) };
}

export const runIdOfOutput = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): /m.exec(stdout);
  if (match === null) throw new Error(`no run ID in the output:\n${stdout}`);
  return match[1] as string;
};

export interface RunRowDb {
  state: string;
  reason: string | null;
  workspace_path: string;
  lease_holder: string | null;
  lease_fence: number;
}

export const runRowOf = (roots: CliRoots, runId: string): RunRowDb =>
  ledgerRows<RunRowDb>(roots, 'SELECT state, reason, workspace_path, lease_holder, lease_fence FROM runs WHERE run_id = ?', runId)[0] as RunRowDb;

export const itemStatesOf = (roots: CliRoots, runId: string): Array<[string, string]> =>
  ledgerRows<{ item_id: string; state: string }>(roots, 'SELECT item_id, state FROM work_items WHERE run_id = ? ORDER BY rowid', runId).map((r) => [r.item_id, r.state]);

export const attemptsOfRun = (roots: CliRoots, runId: string): Array<{ item_id: string | null; reason: string; outcome: string | null }> =>
  ledgerRows<{ item_id: string | null; reason: string; outcome: string | null }>(roots, 'SELECT item_id, reason, outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);

export interface DecisionDb {
  decision_id: string;
  class: string;
  issue: string;
  recommendation: string | null;
  options_json: string;
  consequences_json: string;
  affected_items_json: string;
  state_digest: string;
  state: string;
  answer: string | null;
  contract_version: number;
}

export const decisionsOf = (roots: CliRoots, runId: string): DecisionDb[] =>
  ledgerRows<DecisionDb>(roots, 'SELECT * FROM decisions WHERE run_id = ? ORDER BY opened_at, rowid', runId);

// The subjects of the commits the run's clone carries on top of the pin, oldest first, and the paths they touched. (The source repository has the
// run branch only after the hand-off, so a blocked run is read in its clone.)
export function commitsOfRun(clone: string, pin: string): Array<{ subject: string; files: string[] }> {
  const out = git(clone, ['log', '--reverse', '--name-only', '--format=%x1e%s', `${pin}..HEAD`]);
  return out
    .split('\x1e')
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const [subject = '', ...files] = entry.split('\n');
      return { subject, files: files.filter((f) => f !== '') };
    });
}

export const parkRefOf = (clone: string, runId: string, itemId: string): string | null => {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/avarice/park/${runId}/${itemId}`], { cwd: clone, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

export const existsInClone = (clone: string, rel: string): boolean => existsSync(join(clone, rel));

export const headHas = (clone: string, rel: string): boolean => git(clone, ['ls-tree', '-r', '--name-only', 'HEAD', '--', rel]).trim() !== '';
