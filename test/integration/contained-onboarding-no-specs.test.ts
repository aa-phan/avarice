// A contained onboarding is unchanged by the staged GSD specs of a restricted one (plan 04-34, owner ruling (a)): the contained host reaches GSD's own files through
// its read roots, so it stages nothing, its prompt carries no staged-spec text, and no `.claude` directory appears in the staging copy at any launch. Real gsd-core,
// a scratch repository, the fake host.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
import type { Result } from '../../src/domain/result.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

class SpyHost extends FakeAgentHost {
  readonly seen: Array<{ purpose: string; prompt: string; stagedAtLaunch: boolean; dotClaudeAtLaunch: boolean }> = [];

  override async invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    this.seen.push({
      purpose: req.purpose,
      prompt: req.prompt,
      stagedAtLaunch: existsSync(join(req.cwd, '.claude', 'gsd-core')),
      dotClaudeAtLaunch: existsSync(join(req.cwd, '.claude')),
    });
    return super.invoke(req, signal);
  }
}

describe('a contained onboarding stages no GSD specs', () => {
  it('reaches active with the map prompt unchanged, no .claude/gsd-core at any launch, and the checkout byte-identical', async () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: { 'README.md': '# scratch\n', 'src/index.ts': 'export const answer = 42;\n' } });
    cleanup.push(roots.base, repo.base);
    const before = checkoutSnapshot(repo.path);
    const host = new SpyHost();
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const composed = createDeps(env, { host });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
      assert.ok(started.ok, JSON.stringify(started));
      const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'active', outcome.value.message ?? '');
      const maps = host.seen.filter((call) => call.purpose === 'map');
      assert.ok(maps.length >= 1, 'a map invocation ran');
      for (const call of maps) {
        assert.ok(call.prompt.startsWith('/gsd-map-codebase'), call.prompt);
        assert.ok(!call.prompt.includes('.claude/gsd-core'), `the contained prompt names no staged spec: ${call.prompt}`);
        assert.equal(call.stagedAtLaunch, false, 'no staged specs at launch');
        assert.equal(call.dotClaudeAtLaunch, false, 'no .claude directory at launch');
      }
      assert.deepEqual(checkoutSnapshot(repo.path), before);
    } finally {
      composed.value.close();
    }
  });
});
