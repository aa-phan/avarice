// Application dependencies (SKELETON.md "Application").
import type { IdPrefix } from '../domain/ids.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { ArtifactStore } from '../ports/artifact-store.ts';
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

export interface AppDeps {
  ledger: Ledger;
  // The agent host. Production composition supplies the fail-closed UnavailableAgentHost until the
  // contained Claude Code adapter (plan 01-15) is admitted; tests inject a fake through main() overrides.
  host: AgentHost;
  staging: StagingWorkspace;
  artifacts: ArtifactStore;
  clock: Clock;
  ids: IdSource;
  profile: ProfilePaths;
}
