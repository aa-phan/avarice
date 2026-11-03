// Hook latency benchmark (T-4): runs the real hook entry 30 times against a temp ledger with a Read input and
// prints the p50 and p95 wall time per run. Exits 1 when p95 is 150 ms or more.
//   node scripts/hook-bench.ts                       uses `node`
//   AVARICE_NODE22=/path/to/node node scripts/hook-bench.ts   uses that binary (the admitted Node 22.22.3)
// Everything lives under a temp directory that is removed afterwards.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDb } from '../src/adapters/sqlite/db.ts';
import { migrate } from '../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../src/adapters/sqlite/migrations/0001-initial.ts';
import { DENIED_COMMAND_PREFIXES, GSD_READ_VERBS, READ_ONLY_COMMANDS } from '../src/domain/invocation-scope.ts';
import type { HookPolicy } from '../src/domain/hook-decision.ts';

const RUNS = 30;
const LIMIT_MS = 150;
const node = process.env['AVARICE_NODE22'] ?? 'node';
const entry = resolve(dirname(new URL(import.meta.url).pathname), '..', 'src', 'hook', 'pre-tool-use.ts');

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-hook-bench-')));
try {
  const staging = join(dir, 'staging');
  mkdirSync(join(staging, '.planning', 'codebase'), { recursive: true });
  const ledgerPath = join(dir, 'state.db');
  const opened = openDb(ledgerPath);
  if (!opened.ok) throw new Error('cannot open the bench ledger');
  const migrated = migrate(opened.value, [MIGRATION_0001]);
  if (!migrated.ok) throw new Error('cannot migrate the bench ledger');
  opened.value.prepare("INSERT INTO budgets (run_id, name, limit_value, used, reserved, exactness, contract_version) VALUES ('run_bench', 'toolCalls', 1000000, 0, 0, 'exact', 1)").run();
  opened.value.close();

  const policy: HookPolicy = {
    schema: 1,
    onboardingId: 'onb_bench',
    runId: 'run_bench',
    invocationId: 'inv_bench',
    purpose: 'map',
    ledgerPath,
    stagingPath: staging,
    writeRoots: [join(staging, '.planning', 'codebase')],
    denyRead: [join(dir, 'repo')],
    allowRead: [],
    denyReadGlobs: ['**/.env'],
    commands: { strategy: 'blanket-bash-hook-identity', readOnly: [...READ_ONLY_COMMANDS], gsdReadVerbs: [...GSD_READ_VERBS.map], deniedPrefixes: [...DENIED_COMMAND_PREFIXES] },
    subagentTypes: ['gsd-codebase-mapper'],
    subagentsConcurrent: 4,
  };
  const policyPath = join(dir, 'hook-policy.json');
  writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
  const input = JSON.stringify({ cwd: staging, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: join(staging, 'src', 'a.ts') } });

  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = process.hrtime.bigint();
    const result = spawnSync(node, ['--disable-warning=ExperimentalWarning', entry, '--event', 'pre', '--policy', policyPath], { input, env, encoding: 'utf8' });
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (result.status !== 0) throw new Error(`the hook exited ${String(result.status)}: ${result.stderr}`);
  }
  times.sort((a, b) => a - b);
  const pick = (q: number): number => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)] as number;
  const p50 = pick(0.5);
  const p95 = pick(0.95);
  const version = spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim();
  console.log(`hook bench (${version}, ${RUNS} runs): p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (limit ${LIMIT_MS} ms)`);
  process.exitCode = p95 >= LIMIT_MS ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
