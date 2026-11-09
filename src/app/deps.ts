// Application dependencies (SKELETON.md "Application").
import type { IdPrefix } from '../domain/ids.ts';
import type { ProfileNotify } from '../domain/notify-policy.ts';
import type { Result } from '../domain/result.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { ArtifactStore } from '../ports/artifact-store.ts';
import type { CommandExecutor } from '../ports/command-executor.ts';
import type { ContextSource } from '../ports/context-source.ts';
import type { GraphTool } from '../ports/graph-tool.ts';
import type { EgressProxy } from '../ports/egress-proxy.ts';
import type { GsdOnboarding } from '../ports/gsd-onboarding.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { Notifier } from '../ports/notifier.ts';
import type { RunSource } from '../ports/run-source.ts';
import type { RunWorkspace } from '../ports/run-workspace.ts';
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

// What the notification service needs beyond the ledger and the clock (plan 03-16). Everything that touches the outside is injected: the
// notifier (a port), the profile's notify settings (read from the owner's config file), the wait between delivery attempts and the
// local minute of the day, so a test drives the backoff and the quiet hours with no real time passing.
export interface NotifyDeps {
  notifier: Notifier;
  settings(): Result<ProfileNotify>;
  sleep(ms: number): Promise<void>;
  minuteOfDay(nowMs: number): number;
}

export interface AppDeps {
  ledger: Ledger;
  // The agent host. Production composition supplies the contained ClaudeHostAdapter when an admitted claude, the
  // sandbox and the hook entry are present, and the fail-closed UnavailableAgentHost otherwise (plan 01-15); tests
  // inject a fake through main() overrides.
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
  // The index-first context sources (plan 01-17), present exactly when `gsd` is: both read through GSD's own readers.
  context?: { intel?: ContextSource; graph?: ContextSource };
  // The run ports (Phase 2). Optional so a hand-built AppDeps of an onboarding test need not supply them; a composed AppDeps
  // always has all three. `runSource` reads conventions and drift from repository objects (D-04, D-16), `runWorkspace` is the
  // run's clone and hand-off (D-01..D-03), `egress` is the allowlisting proxy of a supervisor step that needs the network (D-11).
  runSource?: RunSource;
  runWorkspace?: RunWorkspace;
  egress?: EgressProxy;
  // Local notification (plan 03-16, D-21, D-22). Present on a composed AppDeps that is not read-only; a hand-built one need not supply it,
  // and a service that finds it absent notifies no one.
  notify?: NotifyDeps;
  clock: Clock;
  ids: IdSource;
  profile: ProfilePaths;
  // The user's home directory as composition resolved it ($HOME, else the OS answer): the credential directories an
  // invocation may not read are named from it. Absent only in a hand-built AppDeps.
  home?: string;
}
