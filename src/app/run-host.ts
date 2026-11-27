// Which host a run is carried out by (plan 04-23; CON-4, D-12, T-04-64). A run's mode is part of its stored contract, so every process that continues it (the
// supervisor `start` spawned, `supervise` by hand, `resume`, `cancel`) reads the same answer: a restricted run is only ever handed to the restricted host, and a
// contained run only to the contained one. Nothing here falls back from one to the other: a restricted run on a deployment with no restricted host has no host.
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { runModeOf } from '../domain/run-contract.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { AppDeps } from './deps.ts';

export function hostOfRun(deps: AppDeps, runId: string): Result<AgentHost | undefined> {
  const stored = deps.ledger.getRunContract(runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${runId} has no stored contract` });
  return ok(runModeOf(stored.value.body as RunContract) === 'restricted' ? deps.restrictedHost : deps.host);
}
