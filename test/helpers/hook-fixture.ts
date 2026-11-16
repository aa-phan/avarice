// Fixtures for the hook suites: a temp data directory with a migrated ledger, budget rows, a staging tree and a
// hook-policy.json, plus helpers that run the real hook entry (src/hook/pre-tool-use.ts) as a child process.
// Nothing here touches the user's profile; every path is under os.tmpdir().
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { sha256Hex } from '../../src/domain/digest.ts';
import type { HookPolicy } from '../../src/domain/hook-decision.ts';
import { DENIED_COMMAND_PREFIXES, GSD_READ_VERBS, READ_ONLY_COMMANDS } from '../../src/domain/invocation-scope.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../../src/adapters/sqlite/migrations/0003-decisions.ts';
import { REPO_ROOT } from './run-cli.ts';

export const HOOK_ENTRY = join(REPO_ROOT, 'src', 'hook', 'pre-tool-use.ts');
export const PREAMBLE = '_GSD_SHIM_NAME="gsd-tools.cjs"; gsd_run() { "$GSD_TOOLS" "$@"; }; true';

export interface HookFixture {
  dir: string;
  ledgerPath: string;
  staging: string;
  writeRoot: string;
  repo: string;
  policyPath: string;
  policy: HookPolicy;
}

export interface FixtureOptions {
  limits?: Readonly<Record<string, number>>;
  policy?: Partial<HookPolicy>;
  commands?: Partial<HookPolicy['commands']>;
  // Skip creating budget rows (a ledger that was never given any).
  noBudgets?: boolean;
}

export function makeHookFixture(options: FixtureOptions = {}): HookFixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-hook-')));
  const data = join(dir, 'data');
  const staging = join(dir, 'work', 'staging');
  const writeRoot = join(staging, '.planning', 'codebase');
  const repo = join(dir, 'repo');
  for (const path of [data, writeRoot, join(staging, 'src'), repo]) mkdirSync(path, { recursive: true });
  const ledgerPath = join(data, 'state.db');

  const opened = openDb(ledgerPath);
  if (!opened.ok) throw new Error('cannot open the fixture ledger');
  const migrated = migrate(opened.value, [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003]);
  if (!migrated.ok) throw new Error('cannot migrate the fixture ledger');
  if (options.noBudgets !== true) {
    const limits = { toolCalls: 300, subagentsTotal: 4, invocations: 4, ...options.limits };
    const insert = opened.value.prepare("INSERT INTO budgets (run_id, name, limit_value, used, reserved, exactness, contract_version) VALUES ('run_1', ?, ?, 0, 0, 'exact', 1)");
    for (const [name, limit] of Object.entries(limits)) insert.run(name, limit);
  }
  opened.value.close();

  const policy: HookPolicy = {
    schema: 1,
    onboardingId: 'onb_1',
    runId: 'run_1',
    invocationId: 'inv_1',
    purpose: 'map',
    ledgerPath,
    stagingPath: staging,
    writeRoots: [writeRoot],
    denyRead: [repo, data],
    allowRead: [join(repo, '.git')],
    denyReadGlobs: ['**/.env', '**/*.pem'],
    commands: {
      strategy: 'blanket-bash-hook-identity',
      readOnly: [...READ_ONLY_COMMANDS],
      gsdReadVerbs: [...GSD_READ_VERBS.map],
      deniedPrefixes: [...DENIED_COMMAND_PREFIXES],
      preambleSha256: sha256Hex(PREAMBLE),
      preambleLength: new TextEncoder().encode(PREAMBLE).length,
      ...options.commands,
    },
    subagentTypes: ['gsd-codebase-mapper'],
    subagentsConcurrent: 4,
    ...options.policy,
  };
  const policyPath = join(dir, 'hook-policy.json');
  writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
  return { dir, ledgerPath, staging, writeRoot, repo, policyPath, policy };
}

export interface HookResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface HookInput {
  tool_name?: string;
  tool_input?: unknown;
  cwd?: string;
  agent_id?: string;
  [key: string]: unknown;
}

function hookArgs(event: string, policyPath: string | null): string[] {
  return ['--disable-warning=ExperimentalWarning', HOOK_ENTRY, '--event', event, ...(policyPath === null ? [] : ['--policy', policyPath])];
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  return env;
}

export function runHook(fx: HookFixture, event: 'pre' | 'post' | 'config-change' | string, input: HookInput | string, policyPath: string | null = fx.policyPath): HookResult {
  const payload = typeof input === 'string' ? input : JSON.stringify({ cwd: fx.staging, hook_event_name: event, ...input });
  const result = spawnSync(process.execPath, hookArgs(event, policyPath), { input: payload, encoding: 'utf8', env: cleanEnv(), timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function runHookAsync(fx: HookFixture, event: string, input: HookInput): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, hookArgs(event, fx.policyPath), { env: cleanEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ cwd: fx.staging, hook_event_name: event, ...input }));
  });
}

export interface EventRowShape {
  seq: number;
  ts: string;
  type: string;
  run_id: string | null;
  invocation_id: string | null;
  data_json: string;
  prev_hash: string;
  row_hash: string;
}

export function withDb<T>(ledgerPath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(ledgerPath, { readOnly: true, timeout: 5000 });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function eventRows(fx: HookFixture, type?: string): EventRowShape[] {
  return withDb(fx.ledgerPath, (db) => {
    const all = db.prepare('SELECT * FROM events ORDER BY seq').all() as unknown as EventRowShape[];
    return type === undefined ? all : all.filter((r) => r.type === type);
  });
}

export function budgetUsed(fx: HookFixture, name: string): number {
  return withDb(fx.ledgerPath, (db) => Number((db.prepare('SELECT used FROM budgets WHERE run_id = ? AND name = ?').get('run_1', name) as { used: number }).used));
}

// Recomputes every row_hash from the algorithm in SKELETON.md: sha256(prev_hash \n ts \n type \n run_id-or-empty \n data_json).
export function chainIsIntact(ledgerPath: string): boolean {
  return withDb(ledgerPath, (db) => {
    let prev = '0'.repeat(64);
    for (const row of db.prepare('SELECT * FROM events ORDER BY seq').all() as unknown as EventRowShape[]) {
      if (row.prev_hash !== prev) return false;
      if (sha256Hex([row.prev_hash, row.ts, row.type, row.run_id ?? '', row.data_json].join('\n')) !== row.row_hash) return false;
      prev = row.row_hash;
    }
    return true;
  });
}
