// Plan 04-06 Task 1 (FR-16, T-04-14): the run's G0 entry asks for the capabilities `run.unit` needs before any unit is invoked. A host that
// reports enforcement `enforced` but does not declare `contained-invocation` stops the run with a recorded G0 failure that names the
// capability and the reduced mode; nothing is invoked and nothing is simulated. In-process, with the onboarding fake host.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe('run G0 asks for the run.unit capabilities before any invocation (FR-16)', () => {
  it('an enforced host without contained-invocation blocks the run with a G0 capability failure, and nothing is invoked', async () => {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo);
    const brief = writeBrief(join(roots.base, 'briefs'));

    const host = new FakeAgentHost();
    const descriptor: CapabilityDescriptor = { port: 'agent-host', adapter: 'fake-no-contained', version: '0.0.0', capabilities: { headless: true }, attributes: { enforcement: 'enforced' }, offline: true };
    (host as { descriptor: CapabilityDescriptor }).descriptor = descriptor;

    const composed = createDeps(profileEnv(roots), { host });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const outcome = await runSupervisor(composed.value.deps, started.value.runId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'blocked_on_decision');
      assert.equal(outcome.value.reason, 'enforcement_failure');
      assert.equal(host.calls.length, 0, 'no invocation was started');

      const gates = ledgerRows<{ gate: string; passed: number; failures_json: string }>(roots, "SELECT gate, passed, failures_json FROM gate_results WHERE run_id = ? AND gate = 'G0'", started.value.runId);
      assert.equal(gates.length, 1);
      assert.equal(gates[0]?.passed, 0);
      const failures = JSON.parse(gates[0]?.failures_json ?? '[]') as Array<{ rule: string; detail: string }>;
      assert.deepEqual(failures.map((f) => f.rule), ['capability']);
      assert.match(failures[0]?.detail ?? '', /agent-host\.contained-invocation/);
      assert.match(failures[0]?.detail ?? '', /reduced mode: /);
    } finally {
      composed.value.close();
    }
  });
});
