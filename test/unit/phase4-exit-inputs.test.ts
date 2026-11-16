// The drafts of the Phase 4 exit inputs (plan 04-03; D-05, D-06, D-07, D-08): the AC-14 repository list and the AC-8 evaluation task list.
// Both files are read from the repository and checked for shape so a later edit cannot silently drop a repository, a pin, a held-out test or an arm.
// When the owner's checkouts are present, the pins, the commit parents and the held-out test paths are also checked against git objects
// (read only, through `git rev-parse`, `git cat-file` and `git ls-tree`; nothing is written to a checkout).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIR = join(ROOT, 'test', 'benchmark', 'phase4');
const HOME = process.env['AVARICE_OWNER_HOME'] ?? homedir();
const SHA = /^[0-9a-f]{40}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

interface Repository {
  id: string;
  stack: string;
  source: string;
  sourceKind: 'owner-path' | 'public-url';
  pin: string;
  hasPlanning: boolean;
  licence?: string;
  trackedFiles?: number;
}

interface Check {
  name: string;
  argv: string[];
}

interface Task {
  id: string;
  repository: string;
  commit: string;
  parent: string;
  subject: string;
  brief: string;
  checks: Check[];
  heldOutTest: string;
  heldOutCommand: string[];
  allowedReads: string[];
  deniedReads: string[];
  size: 'small' | 'medium';
}

interface Approval {
  approvedBy: string | null;
  approvedAt: string | null;
}

interface RepositoryFile extends Approval {
  schema: number;
  repositories: Repository[];
}

interface TaskFile extends Approval {
  schema: number;
  arms: Record<string, { name: string; description: string }>;
  passRule: { text: string; maxTokenShare: number };
  knowledgeRule: { text: string };
  tokenMetric: { text: string };
  isolation: { text: string };
  tasks: Task[];
}

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T;
}

const repositoryFile = read<RepositoryFile>('ac14-repositories.json');
const taskFile = read<TaskFile>('eval-tasks.json');

// The checkout of an owner repository, or null when the repository is public or its checkout is absent.
function checkout(repo: Repository | undefined): string | null {
  if (repo === undefined || repo.sourceKind !== 'owner-path') return null;
  const path = repo.source.replace(/^~/, HOME);
  return existsSync(join(path, '.git')) ? path : null;
}

function git(path: string, ...args: string[]): { status: number | null; stdout: string } {
  const ran = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: ran.status, stdout: ran.stdout.trim() };
}

function approvalShape(file: Approval): void {
  // Either both fields are null (a draft) or both are set (approved): a half-written approval is never valid (D-05, D-07).
  const bothNull = file.approvedBy === null && file.approvedAt === null;
  const bothSet = typeof file.approvedBy === 'string' && file.approvedBy.length > 0 && typeof file.approvedAt === 'string' && RFC3339.test(file.approvedAt) && !Number.isNaN(Date.parse(file.approvedAt));
  assert.ok(bothNull || bothSet, `approvedBy ${JSON.stringify(file.approvedBy)} and approvedAt ${JSON.stringify(file.approvedAt)} must be both null or both set (RFC 3339)`);
}

describe('the AC-14 repository list (D-05): per entry', () => {
  it('has schema 1 and a whole-or-absent approval', () => {
    assert.equal(repositoryFile.schema, 1);
    approvalShape(repositoryFile);
  });

  it('gives every entry an id, a stack, a source, a source kind and a 40-hex pin', () => {
    assert.ok(repositoryFile.repositories.length > 0);
    for (const repo of repositoryFile.repositories) {
      assert.ok(typeof repo.id === 'string' && repo.id.length > 0, 'id');
      assert.ok(typeof repo.stack === 'string' && repo.stack.length > 0, `${repo.id}: stack`);
      assert.ok(typeof repo.source === 'string' && repo.source.length > 0, `${repo.id}: source`);
      assert.ok(repo.sourceKind === 'owner-path' || repo.sourceKind === 'public-url', `${repo.id}: sourceKind`);
      assert.match(repo.pin, SHA, `${repo.id}: pin must be 40 hex characters`);
      assert.equal(typeof repo.hasPlanning, 'boolean', `${repo.id}: hasPlanning`);
    }
  });

  it('keeps ids unique and public entries under a licence, an https URL and 3,000 tracked files', () => {
    const ids = repositoryFile.repositories.map((repo) => repo.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const repo of repositoryFile.repositories.filter((entry) => entry.sourceKind === 'public-url')) {
      assert.match(repo.source, /^https:\/\//, `${repo.id}: public source is an https URL`);
      assert.ok(typeof repo.licence === 'string' && repo.licence.length > 0, `${repo.id}: licence`);
      assert.ok(Number.isInteger(repo.trackedFiles) && (repo.trackedFiles as number) > 0 && (repo.trackedFiles as number) < 3000, `${repo.id}: trackedFiles under 3,000`);
    }
  });

  it('includes the portfolio at the pin 9f1cd8d', () => {
    const portfolio = repositoryFile.repositories.find((repo) => repo.id === 'aa-phan-portfolio-v2');
    assert.ok(portfolio, 'the portfolio entry is present');
    assert.ok(portfolio.pin.startsWith('9f1cd8d'), portfolio.pin);
    assert.equal(portfolio.hasPlanning, true);
  });

  it('resolves every owner pin to a commit in its checkout, and records hasPlanning as the tracked state at the pin', (t) => {
    let checked = 0;
    for (const repo of repositoryFile.repositories) {
      const path = checkout(repo);
      if (path === null) continue;
      checked += 1;
      assert.equal(git(path, 'cat-file', '-t', repo.pin).stdout, 'commit', `${repo.id}: pin is a commit`);
      const planning = git(path, 'ls-tree', '--name-only', repo.pin, '.planning').stdout.length > 0;
      assert.equal(planning, repo.hasPlanning, `${repo.id}: hasPlanning matches the tree at the pin`);
    }
    if (checked === 0) t.skip('no owner checkout is present');
  });
});

describe('the AC-14 repository list (D-05): the whole set', () => {
  it('lists exactly 5 repositories', () => {
    assert.equal(repositoryFile.repositories.length, 5);
  });

  it('has at least one repository with tracked .planning files', () => {
    assert.ok(repositoryFile.repositories.some((repo) => repo.hasPlanning));
  });

  it('spans at least three distinct stacks', () => {
    assert.ok(new Set(repositoryFile.repositories.map((repo) => repo.stack)).size >= 3);
  });
});

describe('the evaluation task list (D-07): per task', () => {
  it('has schema 1 and a whole-or-absent approval', () => {
    assert.equal(taskFile.schema, 1);
    approvalShape(taskFile);
  });

  it('gives every task a repository, a commit, a parent, a brief, non-empty checks and a held-out test', () => {
    assert.ok(taskFile.tasks.length > 0);
    const known = new Set(repositoryFile.repositories.map((repo) => repo.id));
    for (const task of taskFile.tasks) {
      assert.ok(typeof task.id === 'string' && task.id.length > 0, 'id');
      assert.ok(known.has(task.repository), `${task.id}: repository ${task.repository} is in the AC-14 list`);
      assert.match(task.commit, SHA, `${task.id}: commit`);
      assert.match(task.parent, SHA, `${task.id}: parent`);
      assert.notEqual(task.commit, task.parent, `${task.id}: parent differs from commit`);
      assert.ok(typeof task.subject === 'string' && task.subject.length > 0, `${task.id}: subject`);
      assert.ok(typeof task.brief === 'string' && task.brief.startsWith(task.subject), `${task.id}: the brief starts with the commit subject`);
      assert.ok(Array.isArray(task.checks) && task.checks.length > 0, `${task.id}: checks`);
      for (const check of task.checks) {
        assert.ok(typeof check.name === 'string' && check.name.length > 0, `${task.id}: check name`);
        assert.ok(Array.isArray(check.argv) && check.argv.length > 0 && check.argv.every((word) => typeof word === 'string'), `${task.id}: check ${check.name} argv`);
      }
      assert.ok(typeof task.heldOutTest === 'string' && task.heldOutTest.length > 0, `${task.id}: heldOutTest`);
      assert.ok(Array.isArray(task.heldOutCommand) && task.heldOutCommand.length > 0, `${task.id}: heldOutCommand`);
      assert.ok(task.size === 'small' || task.size === 'medium', `${task.id}: size`);
    }
  });

  it('keeps task ids and commits unique', () => {
    assert.equal(new Set(taskFile.tasks.map((task) => task.id)).size, taskFile.tasks.length, 'ids');
    assert.equal(new Set(taskFile.tasks.map((task) => task.commit)).size, taskFile.tasks.length, 'commits');
  });

  it('never lists the held-out test among the paths the agent may read, and denies it (T-04-06)', () => {
    for (const task of taskFile.tasks) {
      assert.ok(Array.isArray(task.allowedReads) && task.allowedReads.length > 0, `${task.id}: allowedReads`);
      assert.ok(!task.allowedReads.includes(task.heldOutTest), `${task.id}: heldOutTest ${task.heldOutTest} is in allowedReads`);
      assert.ok(Array.isArray(task.deniedReads) && task.deniedReads.includes(task.heldOutTest), `${task.id}: deniedReads names the held-out test`);
    }
  });

  it('records the parent as the commit first parent, and the held-out test as a path of the commit tree, in each owner checkout', (t) => {
    const byId = new Map(repositoryFile.repositories.map((repo) => [repo.id, repo]));
    let checked = 0;
    for (const task of taskFile.tasks) {
      const path = checkout(byId.get(task.repository));
      if (path === null) continue;
      checked += 1;
      assert.equal(git(path, 'rev-parse', `${task.commit}^1`).stdout, task.parent, `${task.id}: parent is the first parent`);
      assert.equal(git(path, 'cat-file', '-t', `${task.commit}:${task.heldOutTest}`).stdout, 'blob', `${task.id}: ${task.heldOutTest} exists at the commit`);
      assert.equal(git(path, 'rev-list', '--count', '--merges', `${task.parent}..${task.commit}`).stdout, '0', `${task.id}: the commit is not a merge`);
    }
    if (checked === 0) t.skip('no owner checkout is present');
  });
});

describe('the evaluation task list (D-06, D-07, D-08): arms and rules', () => {
  it('has exactly the arms A, B and C, each described', () => {
    assert.deepEqual(Object.keys(taskFile.arms).sort(), ['A', 'B', 'C']);
    for (const [key, arm] of Object.entries(taskFile.arms)) {
      assert.ok(typeof arm.name === 'string' && arm.name.length > 0, `${key}: name`);
      assert.ok(typeof arm.description === 'string' && arm.description.length > 0, `${key}: description`);
    }
  });

  it('carries the AC-8 pass rule at 50 percent of the baseline tokens, the D-08 knowledge rule, the token metric and the isolation rule', () => {
    assert.ok(typeof taskFile.passRule.text === 'string' && taskFile.passRule.text.length > 0, 'passRule.text');
    assert.equal(taskFile.passRule.maxTokenShare, 0.5);
    assert.ok(typeof taskFile.knowledgeRule.text === 'string' && taskFile.knowledgeRule.text.length > 0, 'knowledgeRule.text');
    assert.ok(typeof taskFile.tokenMetric.text === 'string' && taskFile.tokenMetric.text.length > 0, 'tokenMetric.text');
    assert.ok(typeof taskFile.isolation.text === 'string' && taskFile.isolation.text.length > 0, 'isolation.text');
  });
});

describe('the evaluation task list (D-07): the whole set', () => {
  it('lists exactly 20 tasks', () => {
    assert.equal(taskFile.tasks.length, 20);
  });

  it('spreads the tasks across at least three repositories', () => {
    assert.ok(new Set(taskFile.tasks.map((task) => task.repository)).size >= 3);
  });
});
