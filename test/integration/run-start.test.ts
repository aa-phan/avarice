// `avarice start` up to a stored contract (plan 02-10; RC-1, RC-2, RC-3, RC-5, FR-1, AUT-7). A scratch GSD project is
// onboarded to `active` through the real CLI with the fake host, conventions are committed after the pin, and `start`
// runs from inside the repository. Every refusal leaves the ledger and the data root untouched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { digestOf } from '../../src/domain/digest.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { RUN_BRIEF, RUN_CONVENTIONS, commitConventions, commitFiles, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
}

// An onboarded repository with committed conventions, ready for `start`.
function fixture(options: { conventions?: unknown | false } = {}): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  if (options.conventions !== false) commitConventions(repo, options.conventions ?? RUN_CONVENTIONS);
  const brief = writeBrief(join(roots.base, 'briefs'));
  return { roots, repo, pin, brief };
}

function start(f: Fixture, extra: readonly string[] = [], options: { brief?: string | null; policy?: string | null; cwd?: string } = {}): CliResult {
  const args = ['start'];
  const brief = options.brief === undefined ? f.brief : options.brief;
  if (brief !== null) args.push('--brief', brief);
  const policy = options.policy === undefined ? 'routine' : options.policy;
  if (policy !== null) args.push('--policy', policy);
  args.push(...extra);
  return runCli(args, { roots: f.roots, cwd: options.cwd ?? f.repo.path });
}

function db(roots: CliRoots): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const handle = db(roots);
  try {
    return (handle.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    handle.close();
  }
}

// Row counts that a refused start must leave unchanged, and the data-root entry for runs.
interface Counts {
  runs: number;
  contracts: number;
  budgets: number;
  workItems: number;
  events: number;
  runsDir: string[];
}

function counts(roots: CliRoots): Counts {
  const one = (table: string, where = ''): number => rows<{ n: number }>(roots, `SELECT COUNT(*) AS n FROM ${table} ${where}`)[0]?.n ?? 0;
  const runsDir = join(roots.AVARICE_DATA_ROOT, 'runs');
  return {
    runs: one('runs', "WHERE state <> 'onboarding'"),
    contracts: one('contracts', "WHERE run_id IN (SELECT run_id FROM runs WHERE state <> 'onboarding')"),
    budgets: one('budgets', "WHERE run_id IN (SELECT run_id FROM runs WHERE state <> 'onboarding')"),
    workItems: one('work_items'),
    events: one('events', "WHERE type LIKE 'run.%' OR type LIKE 'contract.%' OR type LIKE 'work_item.%'"),
    runsDir: existsSync(runsDir) ? readdirSync(runsDir) : [],
  };
}

describe('start: a routine run is authorized by one command and stored with its contract (tracer)', () => {
  it('prints the summary, stores run, contract, budgets and work item, and writes the contract 0600', () => {
    const f = fixture();
    const statusBefore = runCli(['status', '--json'], { roots: f.roots });
    assert.equal(statusBefore.code, 0, statusBefore.stderr);

    const r = start(f);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const lines = r.stdout.split('\n');
    const first = /^run (run_[0-9A-Z]{26}): contract_ready$/.exec(lines[0] ?? '');
    assert.ok(first, `first line is the result line, got ${JSON.stringify(lines[0])}`);
    const runId = first[1] as string;
    assert.ok(lines.length <= 24, 'a one-screen summary');
    assert.match(r.stdout, /Collapse repeated dashes in slugs/);
    assert.match(r.stdout, new RegExp(f.pin));
    assert.match(r.stdout, /5\.00 USD per run, 2\.00 USD per invocation/);
    assert.match(r.stdout, /sonnet/);
    assert.match(r.stdout, /src\/\*\*, test\/\*\*/);
    assert.match(r.stdout, /required checks?: test/);
    assert.match(r.stdout, /acceptance: 1/);

    const [run] = rows<{ state: string; base_revision: string; branch: string; version: number }>(f.roots, 'SELECT state, base_revision, branch, version FROM runs WHERE run_id = ?', runId);
    assert.equal(run?.state, 'contract_ready');
    assert.equal(run?.base_revision, f.pin);
    assert.equal(run?.branch, `avarice/${runId}`);
    assert.equal(run?.version, 1);

    const contracts = rows<{ version: number; digest: string; body_json: string; authorized_by: string }>(f.roots, 'SELECT version, digest, body_json, authorized_by FROM contracts WHERE run_id = ?', runId);
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0]?.version, 1);
    const body = JSON.parse(contracts[0]?.body_json as string) as { workspace: { baseRevision: string; conventionsRevision: string }; policyPreset: string };
    assert.equal(contracts[0]?.digest, digestOf(body), 'the stored digest is the digest of the stored body');
    assert.equal(body.policyPreset, 'routine');
    assert.equal(body.workspace.baseRevision, f.pin);
    assert.equal(body.workspace.conventionsRevision, f.repo.head, 'conventions come from the commit after the pin');

    const budgets = Object.fromEntries(rows<{ name: string; limit_value: number; used: number; exactness: string }>(f.roots, 'SELECT name, limit_value, used, exactness FROM budgets WHERE run_id = ?', runId).map((b) => [b.name, b]));
    assert.equal(Object.keys(budgets).length, 5);
    assert.equal(budgets['invocations']?.limit_value, 3);
    assert.equal(budgets['toolCalls']?.limit_value, 400);
    assert.equal(budgets['subagentsTotal']?.limit_value, 10);
    assert.equal(budgets['wallClockMs']?.limit_value, 3_600_000);
    assert.equal(budgets['costUsd']?.limit_value, 5);
    assert.equal(budgets['costUsd']?.exactness, 'estimated');
    assert.ok(Object.values(budgets).every((b) => b.used === 0));

    const items = rows<{ item_id: string; state: string; model: string }>(f.roots, 'SELECT item_id, state, model FROM work_items WHERE run_id = ?', runId);
    assert.deepEqual(items, [{ item_id: 'A', state: 'ready', model: 'sonnet' }]);

    const [step] = rows<{ step: string; status: string; result_json: string }>(f.roots, "SELECT step, status, result_json FROM run_steps WHERE run_id = ? AND step = 'start:preflight'", runId);
    assert.equal(step?.status, 'completed');
    const result = JSON.parse(step?.result_json as string) as Record<string, unknown>;
    assert.equal(result['pin'], f.pin);
    assert.equal(result['head'], f.repo.head);
    assert.equal(result['conventionsRevision'], f.repo.head);
    assert.equal(result['commitsOutside'], 0);
    assert.match(String(result['briefDigest']), /^sha256:[0-9a-f]{64}$/);

    const created = rows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE type = 'run.created'");
    assert.equal(created.length, 1);
    assert.equal((JSON.parse(created[0]?.data_json as string) as { runId: string }).runId, runId);

    const file = join(f.roots.AVARICE_DATA_ROOT, 'runs', runId, 'contract-v1.json');
    assert.ok(existsSync(file), 'the contract file exists in the data root');
    assert.equal((statSync(file).mode & 0o777).toString(8), '600');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), body, 'the file equals the stored body');
    assert.equal(digestOf(JSON.parse(readFileSync(file, 'utf8'))), contracts[0]?.digest);

    // D-19: the new run adds one `runs` key (plan 02-15) and changes no other key or value of `status --json`.
    const statusAfter = runCli(['status', '--json'], { roots: f.roots });
    const after = JSON.parse(statusAfter.stdout) as Array<Record<string, unknown>>;
    const runs = after[0]?.['runs'] as Array<{ runId: string; state: string }>;
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.runId, runId);
    assert.equal(runs[0]?.state, 'contract_ready');
    delete after[0]?.['runs'];
    assert.equal(JSON.stringify(after, null, 2) + '\n', statusBefore.stdout);
  });

  it('does not touch the repository, and a subdirectory of it resolves the same project', () => {
    const f = fixture();
    const before = checkoutSnapshot(f.repo.path);
    assert.equal(start(f).code, 0);
    assert.equal(start(f, [], { cwd: join(f.repo.path, 'src') }).code, 0);
    assert.deepEqual(checkoutSnapshot(f.repo.path), before, 'HEAD, branch, status and file digest are unchanged');
    assert.equal(rows<{ n: number }>(f.roots, "SELECT COUNT(*) AS n FROM runs WHERE state <> 'onboarding'")[0]?.n, 2);
  });

  it('is authorization by running the command: no stdin read, no prompt (RC-3)', () => {
    for (const file of ['src/cli/commands/start.ts', 'src/app/run-start.ts']) {
      const text = readFileSync(join(import.meta.dirname, '..', '..', file), 'utf8');
      assert.equal(/stdin|readline|createInterface|confirm\(|prompt\(/.test(text), false, `${file} waits for no input`);
    }
    const f = fixture();
    const r = start(f);
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /\[y\/N\]|\(y\/n\)|confirm/i);
  });
});

// ---- Task 2: every refusal happens before anything is created -------------------------------------------------------------

// A start that is refused or invalid leaves the ledger and the data root exactly as they were.
function assertNothingCreated(f: Fixture, before: Counts): void {
  assert.deepEqual(counts(f.roots), before, 'no run, contract, budget row, work item or event, and no data-root runs/ entry');
  assert.equal(before.runsDir.length, 0, 'the data root has no runs/ entry');
}

function refuse(f: Fixture, extra: readonly string[] = [], options: Parameters<typeof start>[2] = {}): CliResult {
  const before = counts(f.roots);
  const r = start(f, extra, options);
  assert.equal(r.code, 3, r.stderr + r.stdout);
  assert.match(r.stderr, /^avarice start: refused: /, 'the refusal line is on stderr');
  assert.equal(r.stdout, '');
  assertNothingCreated(f, before);
  return r;
}

function invalid(f: Fixture, extra: readonly string[] = [], options: Parameters<typeof start>[2] = {}): CliResult {
  const before = counts(f.roots);
  const r = start(f, extra, options);
  assert.equal(r.code, 64, r.stderr + r.stdout);
  assert.equal(r.stdout, '');
  assertNothingCreated(f, before);
  return r;
}

const DAY_MS = 86_400_000;

describe('start refuses before anything is created (D-04, D-16)', () => {
  it('without an active project record: exit 3, naming avarice onboard', () => {
    const f = fixture();
    const elsewhere = makeRunRepo();
    cleanup.push(elsewhere.base);
    const r = refuse(f, [], { cwd: elsewhere.path });
    assert.match(r.stderr, /avarice onboard/);
  });

  it('--project with an unknown ID: exit 3, naming avarice onboard', () => {
    const f = fixture();
    const r = refuse(f, ['--project', 'proj_01JC8Z3V7QABCDEFGHJKMNPQRS']);
    assert.match(r.stderr, /avarice onboard/);
  });

  it('--project names the project from any directory', () => {
    const f = fixture();
    const [project] = rows<{ project_id: string }>(f.roots, 'SELECT project_id FROM projects');
    const r = start(f, ['--project', project?.project_id as string], { cwd: f.roots.base });
    assert.equal(r.code, 0, r.stderr);
  });

  it('a brief that names another base revision: exit 3, asks for a re-onboard', () => {
    const f = fixture();
    const brief = writeBrief(join(f.roots.base, 'b2'), RUN_BRIEF.replace('title: Collapse repeated dashes in slugs', 'title: Collapse repeated dashes in slugs\nbaseRevision: abc1234'));
    const r = refuse(f, [], { brief });
    assert.match(r.stderr, /abc1234/);
    assert.match(r.stderr, /re-onboard/);
  });

  it('a brief that names the pin by an abbreviation starts', () => {
    const f = fixture();
    const brief = writeBrief(join(f.roots.base, 'b2'), RUN_BRIEF.replace('title: Collapse repeated dashes in slugs', `title: Collapse repeated dashes in slugs\nbaseRevision: ${f.pin.slice(0, 9)}`));
    const r = start(f, [], { brief });
    assert.equal(r.code, 0, r.stderr);
  });

  it('a source HEAD that does not descend from the pin: exit 3', () => {
    const f = fixture();
    git(f.repo.path, ['checkout', '-q', '--orphan', 'unrelated']);
    commitFiles(f.repo, { 'README.md': 'rewritten\n' }, 'unrelated history');
    const r = refuse(f);
    assert.match(r.stderr, /does not descend from the onboarded revision/);
    assert.match(r.stderr, /re-onboard/);
  });

  it('26 commits outside .avarice/ and .planning/ refuse; 25 start', () => {
    const f = fixture();
    for (let i = 1; i <= 25; i += 1) commitFiles(f.repo, { [`src/gen${i}.ts`]: `export const n${i} = ${i};\n` }, `change ${i}`);
    // `--wait` lets the detached supervisor (plan 02-12) finish before the counts are taken: with no admitted host it blocks the run
    // (exit 3), and nothing then changes the ledger while the refused second start is compared with it.
    const ok = start(f, ['--wait']);
    assert.equal(ok.code, 3, ok.stderr);
    assert.match(ok.stdout, /^run run_[0-9A-Z]{26}: contract_ready\n/);
    const [step] = rows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE step = 'start:preflight'");
    assert.equal((JSON.parse(step?.result_json as string) as { commitsOutside: number }).commitsOutside, 25);

    commitFiles(f.repo, { 'src/gen26.ts': 'export const n26 = 26;\n' }, 'change 26');
    // The refusal leaves the first run in place; only a new run, contract or budget row would be a change.
    const before = counts(f.roots);
    const r = start(f);
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, new RegExp(`the source has 26 commits past the onboarded revision ${f.pin.slice(0, 7)} outside \\.avarice/ and \\.planning/ \\(limit 25\\); re-onboard the repository`));
    assert.deepEqual(counts(f.roots), before);
  });

  it('commits that touch only .avarice/ or .planning/ do not count as drift', () => {
    const f = fixture();
    for (let i = 1; i <= 30; i += 1) commitFiles(f.repo, { '.planning/STATE.md': `# State\n\nround ${i}\n` }, `planning ${i}`);
    const r = start(f);
    assert.equal(r.code, 0, r.stderr);
  });

  it('an oldest outside commit more than 14 days old refuses; 13 days starts', () => {
    const fresh = fixture();
    commitFiles(fresh.repo, { 'src/extra.ts': 'export const x = 1;\n' }, 'recent change', Date.now() - 13 * DAY_MS);
    assert.equal(start(fresh).code, 0);

    const stale = fixture();
    commitFiles(stale.repo, { 'src/extra.ts': 'export const x = 1;\n' }, 'old change', Date.now() - 15 * DAY_MS);
    const r = refuse(stale);
    assert.match(r.stderr, /days old \(limit 14\); re-onboard the repository/);
  });

  it('no conventions at the pin or after it: exit 3, naming .avarice/config.json', () => {
    const f = fixture({ conventions: false });
    const r = refuse(f);
    assert.match(r.stderr, /\.avarice\/config\.json/);
  });

  it('conventions committed together with other changes are not conventions (D-16): exit 3', () => {
    const f = fixture({ conventions: false });
    commitFiles(f.repo, { '.avarice/config.json': JSON.stringify(RUN_CONVENTIONS), 'src/extra.ts': 'export const x = 1;\n' }, 'conventions and code');
    const r = refuse(f);
    assert.match(r.stderr, /\.avarice\/config\.json/);
  });

  it('conventions that are not valid: exit 3, naming the file', () => {
    const f = fixture({ conventions: '{"schema": 2}' });
    const r = refuse(f);
    assert.match(r.stderr, /\.avarice\/config\.json/);
    assert.match(r.stderr, /conventions\.schema/);
  });

  it('a pin tree without .planning/ROADMAP.md: exit 3', () => {
    const roots = makeRoots();
    const repo = makeRunRepo({}, ['.planning/PROJECT.md', '.planning/ROADMAP.md', '.planning/STATE.md']);
    cleanup.push(roots.base, repo.base);
    const pin = onboardRunRepo(roots, repo);
    commitConventions(repo);
    const f: Fixture = { roots, repo, pin, brief: writeBrief(join(roots.base, 'briefs')) };
    const r = refuse(f);
    assert.match(r.stderr, /\.planning\/ROADMAP\.md/);
  });
});

describe('start exits 64 for an invalid request, creating nothing (RC-5, AUT-7)', () => {
  it('a brief with no acceptance criteria names brief.acceptance', () => {
    const f = fixture();
    const brief = writeBrief(join(f.roots.base, 'b2'), '## Behavior\nDo something.\n');
    const r = invalid(f, [], { brief });
    assert.match(r.stderr, /brief\.acceptance/);
  });

  it('a brief file that does not exist names brief', () => {
    const f = fixture();
    const r = invalid(f, [], { brief: join(f.roots.base, 'nope.md') });
    assert.match(r.stderr, /brief/);
  });

  it('an over-preset budget names budget.costUsdPerRun', () => {
    const f = fixture();
    const r = invalid(f, ['--budget', 'costUsdPerRun=6']);
    assert.match(r.stderr, /budget\.costUsdPerRun/);
  });

  it('a lower budget starts and is stored lowered', () => {
    const f = fixture();
    const r = start(f, ['--budget', 'costUsdPerRun=3', '--budget', 'costUsdPerInvocation=1']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /3\.00 USD per run, 1\.00 USD per invocation/);
    const [cost] = rows<{ limit_value: number }>(f.roots, "SELECT limit_value FROM budgets WHERE name = 'costUsd' AND run_id IN (SELECT run_id FROM runs WHERE state <> 'onboarding')");
    assert.equal(cost?.limit_value, 3);
  });

  it('a verifiedBy that names no declared check fails G0 and names it', () => {
    const f = fixture();
    const brief = writeBrief(join(f.roots.base, 'b2'), RUN_BRIEF.replace('check:test', 'check:nope'));
    const r = invalid(f, [], { brief });
    assert.match(r.stderr, /g0/);
    assert.match(r.stderr, /check:nope/);
  });

  it('a missing --policy names --policy; a missing --brief names --brief', () => {
    const f = fixture();
    const before = counts(f.roots);
    const noPolicy = start(f, [], { policy: null });
    assert.equal(noPolicy.code, 64);
    assert.match(noPolicy.stderr, /--policy/);
    const noBrief = start(f, [], { brief: null });
    assert.equal(noBrief.code, 64);
    assert.match(noBrief.stderr, /--brief/);
    const other = start(f, [], { policy: 'onboarding' });
    assert.equal(other.code, 64);
    assert.deepEqual(counts(f.roots), before);
  });

  it('a malformed --budget is a usage error', () => {
    const f = fixture();
    const r = invalid(f, ['--budget', 'costUsdPerRun']);
    assert.match(r.stderr, /--budget/);
  });
});

describe('concurrency edges', () => {
  it('RC-2: an uncommitted edit of .avarice/config.json does not change the compiled contract', () => {
    const f = fixture();
    const edited = { ...RUN_CONVENTIONS, checks: [{ name: 'test', argv: ['npm', 'run', 'evil'], timeoutSec: 1, required: true }], paths: { write: ['**'], protected: [], artifacts: [] } };
    writeFileSync(join(f.repo.path, '.avarice', 'config.json'), JSON.stringify(edited));
    const r = start(f);
    assert.equal(r.code, 0, r.stderr);
    const [row] = rows<{ body_json: string }>(f.roots, "SELECT body_json FROM contracts WHERE run_id IN (SELECT run_id FROM runs WHERE state <> 'onboarding')");
    const body = JSON.parse(row?.body_json as string) as { execution: { checks: Array<{ argv: string[] }> }; files: { write: string[] } };
    assert.deepEqual(body.execution.checks.map((c) => c.argv), [['npm', 'test']]);
    assert.deepEqual(body.files.write, ['src/**', 'test/**']);
  });

  it('FR-1: the brief digest is stored in intent.requirementRefs and editing the brief later changes nothing stored', () => {
    const f = fixture();
    const r = start(f);
    assert.equal(r.code, 0, r.stderr);
    const [before] = rows<{ digest: string; body_json: string }>(f.roots, "SELECT digest, body_json FROM contracts WHERE run_id IN (SELECT run_id FROM runs WHERE state <> 'onboarding')");
    const body = JSON.parse(before?.body_json as string) as { intent: { requirementRefs: Array<{ provider: string; kind: string; revision: string }> } };
    assert.equal(body.intent.requirementRefs.length, 1);
    assert.match(body.intent.requirementRefs[0]?.revision ?? '', /^sha256:[0-9a-f]{64}$/);
    const [step] = rows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE step = 'start:preflight'");
    assert.equal((JSON.parse(step?.result_json as string) as { briefDigest: string }).briefDigest, body.intent.requirementRefs[0]?.revision);

    writeFileSync(f.brief, RUN_BRIEF.replace('Repeated separators collapse to one dash', 'Anything at all'));
    const [after] = rows<{ digest: string; body_json: string }>(f.roots, "SELECT digest, body_json FROM contracts WHERE run_id IN (SELECT run_id FROM runs WHERE state <> 'onboarding')");
    assert.equal(after?.digest, before?.digest);
    assert.equal(after?.body_json, before?.body_json);
  });
});

describe('createRunWithContract is one transaction (RC-1)', () => {
  it('a work item that fails leaves no run row, contract, budget row, work item or event', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-run-start-ledger-'));
    cleanup.push(dir);
    const handle = openDb(join(dir, 'state.db'));
    assert.ok(handle.ok);
    const store = handle.value;
    assert.ok(migrate(store, [MIGRATION_0001, MIGRATION_0002], { nowMs: 1 }).ok);
    let n = 0;
    const ledger = new SqliteLedger(store, (prefix) => prefix + String(++n).padStart(26, '0'));
    const project = ledger.registerProject({ projectId: 'proj_1', rootCommit: 'r', repoPath: '/repo', remote: null, defaultBranch: 'main', nowMs: 1 });
    assert.ok(project.ok);
    const count = (table: string): number => Number((store.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
    const snapshot = (): Record<string, number> => ({ runs: count('runs'), contracts: count('contracts'), budgets: count('budgets'), items: count('work_items'), events: count('events') });
    const baseline = snapshot();
    const contract = { digest: 'sha256:x', body: { a: 1 }, policyRevision: 'sha256:p', authorizedBy: 'cli:start', budgets: [{ name: 'invocations', limit: 3, exactness: 'exact' as const }], nowMs: 2 };
    const run = { runId: 'run_1', projectId: 'proj_1', title: 'fix', nowMs: 2, baseRevision: 'a'.repeat(40), branch: 'avarice/run_1' };

    const bad = ledger.createRunWithContract({ run, contract, workItems: [{ runId: 'run_1', itemId: 'A', size: 'medium', model: '', spec: {}, nowMs: 2 }] });
    assert.equal(bad.ok, false);
    assert.deepEqual(snapshot(), baseline);

    const good = ledger.createRunWithContract({ run, contract, workItems: [{ runId: 'run_1', itemId: 'A', size: 'medium', model: 'sonnet', spec: {}, nowMs: 2 }] });
    assert.ok(good.ok);
    assert.equal(good.value.run.state, 'contract_ready');
    assert.equal(good.value.run.baseRevision, 'a'.repeat(40));
    assert.equal(good.value.run.branch, 'avarice/run_1');
    assert.equal(good.value.contract.version, 1);
    assert.deepEqual(good.value.workItems.map((i) => i.itemId), ['A']);
    assert.equal(count('budgets'), 1);

    const again = ledger.createRunWithContract({ run: { ...run, nowMs: 3 }, contract, workItems: [] });
    assert.equal(again.ok, false, 'a second run with the same ID is a conflict');
    assert.equal(count('runs'), 1);
    store.close();
  });
});
