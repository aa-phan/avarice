// Plan 04-31 (FR-3, FR-22, D-06, D-07, D-08): the groundwork of the AC-8 evaluation. This file holds the knowledge pass switch (`adapters.knowledgePass`, the
// key the D-08 rule sets) and the evaluation harness tests (dry run, leakage guards, verdict arithmetic). Nothing here calls a model: the host is a fake and the
// repositories are scratch repositories.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configPathFor } from '../../src/adapters/fs/profile-config.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeKnowledgeHost } from '../helpers/fake-knowledge-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import { KNOWLEDGE_REPO_FILES } from '../fixtures/knowledge.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-${prefix}-`)));
  cleanup.push(dir);
  return dir;
}

function rows<T>(roots: CliRoots, sql: string): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function envFor(roots: CliRoots): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(temp('fake-graphify'), 'ok'),
  };
}

// The `adapters` section of the profile config as the harness writes it for an arm (written before the first composition).
function writeAdapters(roots: CliRoots, adapters: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema: 1, adapters }));
}

// Onboards a scratch repository with the given `adapters` section and says how the knowledge step ended and how many knowledge invocations the host saw.
async function onboardWith(adapters: Record<string, unknown> | undefined): Promise<{ knowledgeStep: { index: string; status: string } | undefined; knowledgeCalls: number; state: string }> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: KNOWLEDGE_REPO_FILES });
  cleanup.push(roots.base, repo.base);
  if (adapters !== undefined) writeAdapters(roots, adapters);
  const host = new FakeKnowledgeHost(new FakeAgentHost());
  const composed = createDeps(envFor(roots), { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, 'the run itself does not fail');
    const stored = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE step = 'index:knowledge' AND status = 'completed'");
    const step = stored[0] === undefined ? undefined : (JSON.parse(stored[0].result_json) as { index: string; status: string });
    return { knowledgeStep: step, knowledgeCalls: host.calls.length, state: outcome.value.state };
  } finally {
    composed.value.close();
  }
}

describe('adapters.knowledgePass (D-08)', () => {
  it('records the knowledge step as disabled and runs no knowledge invocation when the key is false', async () => {
    const off = await onboardWith({ knowledgePass: false });
    assert.equal(off.state, 'active', 'a profile with the pass off still onboards');
    assert.equal(off.knowledgeCalls, 0);
    assert.deepEqual(off.knowledgeStep, { index: 'knowledge', status: 'disabled' });
  });

  it('runs the knowledge step as before when the key is true, or when the key or the whole section is absent', async () => {
    for (const adapters of [{ knowledgePass: true }, {}, undefined]) {
      const on = await onboardWith(adapters);
      assert.equal(on.state, 'active', JSON.stringify(adapters));
      assert.equal(on.knowledgeCalls, 1, `one knowledge invocation for ${JSON.stringify(adapters)}`);
      assert.equal(on.knowledgeStep?.status, 'present', JSON.stringify(adapters));
    }
  });

  it('refuses a value that is not a boolean at composition, naming adapters.knowledgePass, for a command that writes and for one that does not', () => {
    for (const value of ['false', 0, 1, null, [], {}]) {
      const roots = makeRoots();
      cleanup.push(roots.base);
      writeAdapters(roots, { knowledgePass: value });
      for (const options of [{}, { readOnly: true, gsd: true }]) {
        const composed = createDeps(envFor(roots), {}, options);
        if (composed.ok) {
          composed.value.close();
          assert.fail(`composition accepted ${JSON.stringify(value)}`);
        } else {
          assert.match(composed.message, /adapters\.knowledgePass/, composed.message);
        }
      }
    }
  });
});
