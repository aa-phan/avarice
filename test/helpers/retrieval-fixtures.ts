// What the retrieval tests of plan 04-28 share: a real run (an onboarded scratch repository, `startRun` in this process, the production composition) whose contract and
// budget rows are stored, and the budget rows of that run as the ledger holds them. No model is called.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import { FakeAgentHost } from './fake-agent-host.ts';
import { writeFakeGraphify } from './fake-graphify.ts';
import { FakeIntelHost } from './fake-intel-host.ts';
import { makeRoots } from './run-cli.ts';
import type { CliRoots } from './run-cli.ts';
import { RUN_BRIEF, RUN_CONVENTIONS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from './run-fixtures.ts';
import { makeScratchRepo } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';

export interface OnboardedContext {
  deps: AppDeps;
  close: () => void;
  repo: ScratchRepo;
  roots: CliRoots;
}

// A scratch repository with `files`, onboarded to active in this process with the fake hosts, and the read-only composition that reads its indexes (the one `avarice
// context` runs on). `cleanup` collects the directories the caller removes at the end.
export async function onboardedContext(cleanup: string[], files: Record<string, string>): Promise<OnboardedContext> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files });
  const bins = mkdtempSync(join(tmpdir(), 'avarice-retrieval-'));
  cleanup.push(roots.base, repo.base, bins);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(bins, 'ok'),
  };
  const onboarding = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}) });
  assert.ok(onboarding.ok, 'composition');
  try {
    const started = startOnboarding(onboarding.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(onboarding.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok && outcome.value.state === 'active', 'the repository is onboarded');
  } finally {
    onboarding.value.close();
  }
  const composed = createDeps(env, {}, { readOnly: true, gsd: true });
  assert.ok(composed.ok);
  return { deps: composed.value.deps, close: composed.value.close, repo, roots };
}

export interface StartedRun {
  roots: CliRoots;
  repo: ScratchRepo;
  deps: AppDeps;
  close: () => void;
  runId: string;
  contract: RunContract;
}

// A run stored from RUN_BRIEF (one work item, so toolCalls 400), optionally with extra brief frontmatter lines and `--budget` overrides. `cleanup` collects the
// directories the caller removes at the end.
export function startedRun(cleanup: string[], frontmatter: readonly string[] = [], budgetOverrides: Readonly<Record<string, number>> = {}): StartedRun {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS);
  const text = frontmatter.length === 0 ? RUN_BRIEF : RUN_BRIEF.replace('title: Collapse repeated dashes in slugs\n', `title: Collapse repeated dashes in slugs\n${frontmatter.join('\n')}\n`);
  const brief = writeBrief(join(roots.base, 'briefs'), text);
  const composed = createDeps(profileEnv(roots), {}, { gsd: true });
  assert.ok(composed.ok, 'composition');
  const result = startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides });
  assert.ok(result.ok, JSON.stringify(result));
  return { roots, repo, deps: composed.value.deps, close: composed.value.close, runId: result.value.runId, contract: result.value.contract };
}

export interface BudgetDb {
  name: string;
  limit_value: number;
  used: number;
  reserved: number;
}

// The run's budget rows by name, read straight from the store.
export const budgetsOf = (s: Pick<StartedRun, 'roots' | 'runId'>): Record<string, BudgetDb> =>
  Object.fromEntries(ledgerRows<BudgetDb>(s.roots, 'SELECT name, limit_value, used, reserved FROM budgets WHERE run_id = ? ORDER BY name', s.runId).map((r) => [r.name, r]));
