// Hook latency benchmark (T-4): runs the real hook entry 30 times against a temp ledger with a Read input and
// prints the p50 and p95 wall time per run. Exits 1 when p95 is 150 ms or more.
//   node scripts/hook-bench.ts                       uses `node`
//   AVARICE_NODE22=/path/to/node node scripts/hook-bench.ts   uses that binary (the admitted Node 22.22.3)
//   node scripts/hook-bench.ts --policy run          the run purpose, with read recording and loop limits on: each of the 30 rounds runs a
//                                                    PostToolUse of a Read (records the file digest) and a PreToolUse of an Edit (checks it),
//                                                    and the p95 of each, and of the two together, must stay under the limit (plan 02-11)
// Everything lives under a temp directory that is removed afterwards.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDb } from '../src/adapters/sqlite/db.ts';
import { migrate } from '../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../src/adapters/sqlite/migrations/0002-run.ts';
import { DENIED_COMMAND_PREFIXES, GSD_READ_VERBS, READ_ONLY_COMMANDS } from '../src/domain/invocation-scope.ts';
import type { HookPolicy } from '../src/domain/hook-decision.ts';

const RUNS = 30;
const LIMIT_MS = 150;
const node = process.env['AVARICE_NODE22'] ?? 'node';
const entry = resolve(dirname(new URL(import.meta.url).pathname), '..', 'src', 'hook', 'pre-tool-use.ts');

function modeOf(argv: readonly string[]): 'default' | 'run' {
  const at = argv.indexOf('--policy');
  if (at === -1) return 'default';
  const value = argv[at + 1];
  if (value === 'run') return 'run';
  throw new Error(`--policy must be run, got ${String(value)}`);
}
const mode = modeOf(process.argv.slice(2));

const pickOf = (times: number[], q: number): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] as number;
};

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-hook-bench-')));
try {
  const staging = join(dir, 'staging');
  mkdirSync(join(staging, '.planning', 'codebase'), { recursive: true });
  const ledgerPath = join(dir, 'state.db');
  const opened = openDb(ledgerPath);
  if (!opened.ok) throw new Error('cannot open the bench ledger');
  const migrated = migrate(opened.value, mode === 'run' ? [MIGRATION_0001, MIGRATION_0002] : [MIGRATION_0001]);
  if (!migrated.ok) throw new Error('cannot migrate the bench ledger');
  opened.value.prepare("INSERT INTO budgets (run_id, name, limit_value, used, reserved, exactness, contract_version) VALUES ('run_bench', 'toolCalls', 1000000, 0, 0, 'exact', 1)").run();
  opened.value.close();

  const base: HookPolicy = {
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
  const policy: HookPolicy =
    mode === 'run'
      ? { ...base, purpose: 'run', writeRoots: [], writeGlobs: ['src/**'], protectedGlobs: ['package.json'], readBeforeEdit: true, loopLimits: { consecutiveDenials: 3, consecutiveSearches: 25 } }
      : base;
  const policyPath = join(dir, 'hook-policy.json');
  writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
  const target = join(staging, 'src', 'a.ts');
  mkdirSync(join(staging, 'src'), { recursive: true });
  writeFileSync(target, 'export const a = 1;\n'.repeat(2000));
  const readInput = JSON.stringify({ cwd: staging, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: target } });
  const postRead = JSON.stringify({ cwd: staging, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: target } });
  const preEdit = JSON.stringify({ cwd: staging, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: target, old_string: 'a', new_string: 'b' } });

  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const timed = (event: 'pre' | 'post', input: string, expectStdout: boolean): number => {
    const started = process.hrtime.bigint();
    const result = spawnSync(node, ['--disable-warning=ExperimentalWarning', entry, '--event', event, '--policy', policyPath], { input, env, encoding: 'utf8' });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (result.status !== 0) throw new Error(`the hook exited ${String(result.status)}: ${result.stderr}`);
    // A run-mode Edit must be allowed (silent): a printed deny would mean the bench is timing a refusal.
    if (!expectStdout && result.stdout !== '') throw new Error(`the hook printed ${result.stdout.trim()}`);
    return ms;
  };

  const version = spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim();
  if (mode === 'default') {
    const times: number[] = [];
    for (let i = 0; i < RUNS; i += 1) times.push(timed('pre', readInput, true));
    const p50 = pickOf(times, 0.5);
    const p95 = pickOf(times, 0.95);
    console.log(`hook bench (${version}, ${RUNS} runs): p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (limit ${LIMIT_MS} ms)`);
    process.exitCode = p95 >= LIMIT_MS ? 1 : 0;
  } else {
    const reads: number[] = [];
    const edits: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      reads.push(timed('post', postRead, false));
      edits.push(timed('pre', preEdit, false));
    }
    const all = [...reads, ...edits];
    const line = (name: string, times: number[]): string => `${name} p50 ${pickOf(times, 0.5).toFixed(1)} ms, p95 ${pickOf(times, 0.95).toFixed(1)} ms`;
    console.log(`hook bench run policy (${version}, ${RUNS} rounds, read recording and loop limits on): ${line('post Read', reads)}; ${line('pre Edit', edits)}; p95 ${pickOf(all, 0.95).toFixed(1)} ms (limit ${LIMIT_MS} ms)`);
    process.exitCode = Math.max(pickOf(reads, 0.95), pickOf(edits, 0.95)) >= LIMIT_MS ? 1 : 0;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
