// Application dependencies (SKELETON.md "Application").
import type { IdPrefix } from '../domain/ids.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { ArtifactStore } from '../ports/artifact-store.ts';
import type { CommandExecutor } from '../ports/command-executor.ts';
import type { GraphTool } from '../ports/graph-tool.ts';
import type { GsdOnboarding } from '../ports/gsd-onboarding.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { StagingWorkspace } from '../ports/staging-workspace.ts';

export interface Clock {
  nowMs(): number;
}

export interface IdSource {
  next(prefix: IdPrefix): string;
}

export interface ProfilePaths {
  profile: string;
  configHome: string;
  dataRoot: string;
  workRoot: string;
}

export interface GsdProblem {
  found: string;
  admitted: string;
}

export interface AppDeps {
  ledger: Ledger;
  // The agent host. Production composition supplies the fail-closed UnavailableAgentHost until the
  // contained Claude Code adapter (plan 01-15) is admitted; tests inject a fake through main() overrides.
  host: AgentHost;
  staging: StagingWorkspace;
  artifacts: ArtifactStore;
  // Runs every command AVARICE itself starts against staging (gsd-tools verbs, graphify) inside an OS sandbox
  // with the network denied; refuses to run when the sandbox is unavailable.
  executor: CommandExecutor;
  // The code-graph tool (graphify), run through `executor`. Present even when graphify is not installed;
  // `graph.locate()` then reports `unavailable` (graphify-missing).
  graph: GraphTool;
  // The GSD adapter, present only when discovery found an admitted gsd-core (@opengsd/gsd-core 1.17.x).
  gsd?: GsdOnboarding;
  // Why `gsd` is absent: what discovery found and what is admitted. Onboarding stops `incompatible` with it.
  gsdProblem?: GsdProblem;
  clock: Clock;
  ids: IdSource;
  profile: ProfilePaths;
}
