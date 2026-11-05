// `avarice start` up to a stored contract (plan 02-10; RC-1, RC-2, RC-3, RC-5, FR-1, AUT-7). A scratch GSD project is
// onboarded to `active` through the real CLI with the fake host, conventions are committed after the pin, and `start`
// runs from inside the repository. Every refusal leaves the ledger and the data root untouched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { digestOf } from '../../src/domain/digest.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot } from '../helpers/scratch-repo.ts';
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

    // D-19: the new run does not change `status --json`.
    const statusAfter = runCli(['status', '--json'], { roots: f.roots });
    assert.equal(statusAfter.stdout, statusBefore.stdout);
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

