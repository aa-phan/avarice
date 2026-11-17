// The Diagnostics port (plan 04-25; OPS-1, OPS-6, D-20): what `avarice doctor` may look at and the one thing it may do (`removeOrphanTemps`, behind `--repair`).
// Every probe is bounded: it returns within its own timeout whatever the thing it asks does, and a probe that cannot answer says so in its result instead of throwing.
// Probes read; none of them opens a store for writing, migrates, takes a lease, resolves a credential or starts a model. The facts are raw: the judgement (admission,
// enforcement, compatibility, findings) belongs to the application read model in src/app/doctor.ts.
import type { Result } from '../domain/result.ts';

export interface NodeFacts {
  version: string;
  // The `engines.node` rule of AVARICE's package.json, when it could be read.
  engines: string | undefined;
}

export interface StoreFacts {
  // `absent`: no store file yet. `unreadable`: the file exists and could not be opened read-only (the cause is in `detail`).
  state: 'absent' | 'readable' | 'unreadable';
  detail?: string;
  // The highest migration version the store records, or undefined when it records none.
  schemaVersion?: number;
  // The profile the store was created for (`meta.profile_id`).
  profileId?: string;
  journalMode?: string;
  // `ok`, or the first message of the SQLite check.
  integrity?: string;
  sizeBytes?: number;
  // The adapter descriptors the store recorded (name, port, adapter), never their bodies.
  adapters: ReadonlyArray<{ name: string; port: string; adapter: string }>;
  // The modification time of the newest pre-migration backup beside the store.
  lastBackupMs?: number;
  // The rows of the events table and the debug events refused because it was at its bound (`meta.events_dropped_debug`; plan 04-30). Absent when the table cannot be read.
  events?: { rows: number; droppedDebug: number };
}

// What running `<bin> --version` did. `absent`: the file does not exist or is not executable. `failed`: it started and did not answer in time or exited non-zero.
export type ClaudeFacts =
  | { state: 'absent' }
  | { state: 'failed'; cause: string }
  | { state: 'ran'; versionOutput: string };

export type GsdFacts =
  | { state: 'absent'; searched: string[] }
  | { state: 'unreadable'; dir: string; detail: string }
  | { state: 'found'; dir: string; packageName: string; version: string };

export type GraphifyFacts =
  | { state: 'absent' }
  | { state: 'found'; path: string; version: string | undefined; detail?: string };

// The settings file of a Claude configuration directory, read for the attended hook entry AVARICE installs (`install-host`). `attendedEntries` counts the entries of
// `hooks.PreToolUse` whose command carries the attended marker.
export interface HookSettingsFacts {
  path: string;
  state: 'absent' | 'unreadable' | 'read';
  attendedEntries: number;
}

export interface ConfigDirFacts {
  path: string;
  exists: boolean;
  attendedEntries: number;
  // Names of the `avarice-*` skill directories under `skills/`.
  skills: string[];
  // The 1-based lines of its CLAUDE.md that mention `git push` or opening a pull request without a word of approval on the same line. Never the text of the line.
  instructionLines: number[];
}

export type CliStatus = { state: 'ok' } | { state: 'failed'; exitCode: number | null } | { state: 'timed_out' } | { state: 'absent' };

export interface Diagnostics {
  node(): NodeFacts;
  // The bundled SQLite version, or the reason it could not be read.
  sqliteVersion(): Result<string>;
  // Opens `path` read-only, never migrating, and reads what the store says about itself.
  store(path: string): StoreFacts;
  // `<bin> --version`, bounded.
  claude(bin: string): ClaudeFacts;
  // `<bin> --help` text, or undefined when it could not be read in time.
  claudeHelp(bin: string): string | undefined;
  // The gsd-core the environment names, with its reported identity, whatever its version.
  gsd(env: NodeJS.ProcessEnv): GsdFacts;
  graphify(env: NodeJS.ProcessEnv): GraphifyFacts;
  // Whether the OS sandbox applies a profile.
  sandbox(): boolean;
  readable(path: string): boolean;
  hookSettings(configDir: string): HookSettingsFacts;
  configDir(path: string): ConfigDirFacts;
  // `<cli> auth status`, found through the delegated credential provider's own PATH search and bounded. Only its outcome is returned: none of its output.
  delegatedAuth(cli: string, env: NodeJS.ProcessEnv): Promise<CliStatus>;
  // Deletes the temporary artifact files (`.tmp-*` under `artifacts/*/`) last modified `olderThanMs` or more before `nowMs`; keeps the others and every other file.
  removeOrphanTemps(dataRoot: string, nowMs: number, olderThanMs: number): { removed: number; kept: number };
}
