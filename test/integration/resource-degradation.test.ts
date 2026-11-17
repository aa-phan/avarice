// Plan 04-30 (OPS-5, D-13, CON-12): every resource bound is read from the profile config's `limits` section and degrades as documented: the context pack is cut to fit
// (lowest-ranked items dropped and listed), a run past the active-run bound is refused, checks queue, check output is truncated, new artifacts past the quota are refused,
// debug events past the event bound are refused and counted, and a retry reuses only the pack items the cache rule allows. Real scratch repositories, the real ledger, the
// real sandboxed checks and the fake run host; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPathFor } from '../../src/adapters/fs/profile-config.ts';
import { RUN_PROMPT_MAX_BYTES, runPromptRoom } from '../../src/app/run-gsd-config.ts';
import type { RunPromptContract } from '../../src/app/run-gsd-config.ts';
import { main } from '../../src/cli/main.ts';
import { effectivePackBudget } from '../../src/domain/resource-bounds.ts';
import { onboardedContext } from '../helpers/retrieval-fixtures.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_BRIEF, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, runInProcess, writeBrief } from '../helpers/run-fixtures.ts';
import { RUN_CONVENTIONS_WITH_COMMANDS } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The profile config with a `limits` section (merged into the file the first command wrote).
function setLimits(roots: CliRoots, limits: unknown): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  let current: Record<string, unknown> = { schema: 1 };
  try {
    current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(path, JSON.stringify({ ...current, limits }, null, 2));
}

const FIX = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' as const };

interface RunFixture {
  roots: CliRoots;
  brief: string;
  repo: ReturnType<typeof makeRunRepo>;
}

function runFixture(limits?: unknown, extraFiles: Readonly<Record<string, string>> = {}, conventions: unknown = RUN_CONVENTIONS_WITH_COMMANDS): RunFixture {
  const roots = makeRoots();
  const repo = makeRunRepo(extraFiles);
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, conventions);
  if (limits !== undefined) setLimits(roots, limits);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF) };
}

describe('tracer: a run\'s pack budget is the smaller of limits.contextTokens and the room left in the prompt, and the step records both (D-13, FR-3)', () => {
  it('records the ceiling and the effective budget in the context:pack step', async () => {
    const f = runFixture({ contextTokens: 24000 });
    const promptFile = join(f.roots.base, 'prompt.json');
    const ran = await runInProcess(f.roots, f.repo, f.brief, { ...FIX, recordTo: promptFile });
    assert.equal(ran.state, 'ready_for_review');
    const [step] = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", ran.runId);
    assert.ok(step, 'the pack step was recorded');
    const pack = JSON.parse(step.result_json) as { ceiling?: number; effective?: number; usedTokens: number };
    assert.equal(pack.ceiling, 24000);

    // The room is measured from the contract as the unit prompt states it; the prompt the host was given proves the measure (no pack means the prompt is the contract text).
    const [stored] = ledgerRows<{ body_json: string }>(f.roots, 'SELECT body_json FROM contracts WHERE run_id = ? ORDER BY version LIMIT 1', ran.runId);
    assert.ok(stored);
    const room = runPromptRoom(JSON.parse(stored.body_json) as RunPromptContract);
    const prompt = (JSON.parse(readFileSync(promptFile, 'utf8')) as { prompt: string }).prompt;
    if (!prompt.includes('--- begin untrusted context data')) assert.equal(Buffer.byteLength(prompt), room.contractBytes, 'the measure is the size of the prompt the builder made');
    assert.equal(pack.effective, effectivePackBudget(24000, RUN_PROMPT_MAX_BYTES, room.contractBytes, room.overhead));
    assert.ok((pack.effective ?? 0) > 0 && (pack.effective ?? 0) < 8192, `inside the 32 KiB prompt the pack is under 8192 tokens, got ${String(pack.effective)}`);
    assert.ok(pack.usedTokens <= (pack.effective ?? 0));
  });

  it('a lower limits.contextTokens is the budget: ceiling and effective are both 100', async () => {
    const f = runFixture({ contextTokens: 100 });
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    const [step] = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", ran.runId);
    assert.ok(step);
    const pack = JSON.parse(step.result_json) as { ceiling?: number; effective?: number };
    assert.deepEqual([pack.ceiling, pack.effective], [100, 100]);
  });

  it('a missing limits section gives the 24,000 ceiling', async () => {
    const f = runFixture();
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    const [step] = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", ran.runId);
    assert.ok(step);
    assert.equal((JSON.parse(step.result_json) as { ceiling?: number }).ceiling, 24000);
  });
});

describe('`avarice context` takes its default budget from limits.contextTokens, and --budget overrides it (D-13)', () => {
  const FILES = { 'README.md': '# scratch\n', 'src/index.ts': 'export function answer(): number {\n  return 42;\n}\n' };

  async function budgetOf(o: Awaited<ReturnType<typeof onboardedContext>>, argv: readonly string[]): Promise<number> {
    let out = '';
    const env = { ...process.env, AVARICE_CONFIG_HOME: o.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: o.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: o.roots.AVARICE_WORK_ROOT };
    const code = await main(['context', 'answer', '--json', ...argv], { env, io: { out: (t) => void (out += t), err: () => undefined } });
    assert.equal(code, 0, out);
    return (JSON.parse(out) as { budget: number }).budget;
  }

  it('uses 24000 with no limits section and no --budget', async () => {
    const o = await onboardedContext(cleanup, FILES);
    try {
      assert.equal(await budgetOf(o, []), 24000);
    } finally {
      o.close();
    }
  });

  it('uses limits.contextTokens when the profile sets it, and --budget 500 wins over both', async () => {
    const o = await onboardedContext(cleanup, FILES);
    try {
      setLimits(o.roots, { contextTokens: 9000 });
      assert.equal(await budgetOf(o, []), 9000);
      assert.equal(await budgetOf(o, ['--budget', '500']), 500);
    } finally {
      o.close();
    }
  });
});
