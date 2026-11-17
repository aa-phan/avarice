// `doctor`: the read model behind `avarice doctor` (plan 04-25; OPS-1, OPS-6, D-20, S-1, S-4, S-38, S-49). It reports the profile, the runtime, the store, the host, GSD,
// graphify, the recorded adapters and the runs, and turns what is wrong into findings with a fix each. It is built to work when the rest of AVARICE does not: the
// store may be newer, older or missing, the GSD install incompatible, the host absent or refused. It therefore runs on its own read-only dependency set (no migration,
// no lease, no GSD requirement), every probe is bounded by the Diagnostics port, and it never resolves a credential: a configured reference is shown as the reference
// it is. Every string of the report passes through the process redactor before it leaves this module.
//
// The two things it does that are not reading are behind explicit flags: `--online` runs the vendor CLI's own authentication check (the only network step) and
// `--repair` deletes orphaned temporary artifact files older than one hour. Neither edits a run, a lease or a record.
import { gsdMinorOf, gsdVersionAdmitted } from '../domain/gsd-version.ts';
import { REQUIRED_HELP_FLAGS, RESTRICTED_HELP_FLAGS, VERIFIED_HOST_VERSIONS, admitHostVersion, helpListsFlag } from '../domain/host-admission.ts';
import { parseCredentialRef, printable, providersFor } from '../domain/credential-ref.ts';
import type { ProviderName } from '../domain/credential-ref.ts';
import type { ProfileClass } from '../domain/profile.ts';
import { LIMIT_DEFAULTS, parseLimitsSection } from '../domain/resource-bounds.ts';
import type { Diagnostics, GsdFacts } from '../ports/diagnostics.ts';
import { GSD_ADMITTED_RANGE } from '../ports/gsd-onboarding.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { Clock } from './deps.ts';
import { getStatus } from './status.ts';

export type DoctorLevel = 'error' | 'warning';

// One thing that is wrong. An `error` stops something AVARICE does (the exit code is 3); a `warning` is worth knowing. Every finding says what to do about it.
export interface DoctorFinding {
  level: DoctorLevel;
  area: string;
  message: string;
  fix: string;
}

export interface DoctorOptions {
  online?: boolean;
  repair?: boolean;
  extensions?: boolean;
}

// The profile as the composition resolved it, or why it could not be.
export interface DoctorProfile {
  profile: string;
  class: ProfileClass;
  configHome: string;
  dataRoot: string;
  workRoot: string;
  configPath: string;
  // The profile config's `credentials` section as written (raw): references are read from it, never resolved.
  credentials: unknown;
  // The profile config's `limits` section as written (raw), parsed here for the bounds the report shows and the finding it may raise (plan 04-30).
  limits?: unknown;
}

export interface DoctorDeps {
  env: NodeJS.ProcessEnv;
  profile: { ok: true; value: DoctorProfile } | { ok: false; message: string };
  // The `claude` the composition would run (AVARICE_CLAUDE_BIN, else the first on PATH), and the hook entry script the contained host names.
  claudeBin: string | undefined;
  hookEntry: string;
  // The Claude configuration directory a run would use, and the directories `--extensions` compares (that one, and the default one when it is another).
  claudeConfigDir: string;
  extensionDirs: readonly string[];
  // The schema version this build writes (the newest migration it ships).
  expectedSchema: number;
  diagnostics: Diagnostics;
  // A ledger over the store opened read-only, or undefined when the store cannot be read as this build's schema. Called at most once.
  readLedger(): Ledger | undefined;
  clock: Clock;
  redact(text: string): string;
}

export interface DoctorStore {
  path: string | null;
  state: 'absent' | 'ok' | 'older' | 'newer' | 'foreign' | 'unreadable' | 'unchecked';
  schema: number | null;
  expectedSchema: number;
  journalMode: string | null;
  integrity: string | null;
  sizeBytes: number | null;
  lastBackup: string | null;
  profileId: string | null;
}

export type HostAdmissionLabel = 'verified' | 'admitted (unverified patch)' | 'refused' | 'absent';

export interface DoctorHost {
  claudeBin: string | null;
  // The version `claude --version` printed, `unknown` when it printed nothing readable, null when claude is absent or did not answer.
  claudeVersion: string | null;
  admission: HostAdmissionLabel;
  // The refusal rule of the launch preflight that applies (`host-minor-unverified`, `host-flag-missing:<flag>`, ...), or null.
  refusal: string | null;
  // Whether the restricted launch (`--restricted`) is available on this host: it lists every flag the restricted line uses.
  restricted: boolean;
  enforcement: 'enforced' | 'restricted' | 'none';
  sandbox: 'ok' | 'unavailable' | 'not probed';
  hookEntry: 'readable' | 'unreadable';
  // The attended PreToolUse hook entry `install-host` writes into the Claude configuration directory (S-4): privileged approvals in the owner's own sessions.
  attended: 'none' | 'enforced (privileged approvals only)';
  configDir: string;
}

export interface DoctorGsd {
  state: 'ok' | 'incompatible' | 'absent';
  version: string | null;
  location: string | null;
  admitted: string;
  detail: string | null;
}

export interface DoctorGraphify {
  state: 'present' | 'absent';
  version: string | null;
  path: string | null;
}

export interface DoctorInterrupted {
  kind: 'run' | 'onboarding';
  id: string;
  title: string | null;
  state: string;
  resume: string;
}

export interface DoctorRuns {
  // False when the store was not read as this build's schema (absent, newer, older, unreadable).
  read: boolean;
  total: number;
  byState: Record<string, number>;
  interrupted: DoctorInterrupted[];
}

// The events table against its bound (plan 04-30; OPS-5): the rows it holds, the bound `limits.maxEventRows` sets, and the debug events refused since the table reached it.
// `read` is false when the store was not read as this build's schema; the numbers are then 0 and the bound is the configured one.
export interface DoctorEvents {
  read: boolean;
  rows: number;
  bound: number;
  droppedDebug: number;
}

// An active project record, with the revision and the GSD version it is tied to and whether the installed GSD can still be used with it (S-38). Derived, never stored.
export interface DoctorRecord {
  projectId: string;
  repoPath: string;
  version: number;
  onboardedRevision: string;
  gsdVersion: string;
  compatibility: 'compatible' | 'incompatible';
  reason: string | null;
}

export interface DoctorOnline {
  checks: Array<{ name: string; reference: string; status: string }>;
  note: string | null;
}

export interface DoctorExtensions {
  activeConfigDir: string;
  configDirs: Array<{ path: string; active: boolean; exists: boolean; attendedHookEntries: number; skills: string[] }>;
}

export interface DoctorReport {
  profile: {
    name: string | null;
    class: ProfileClass | null;
    roots: { configHome: string; dataRoot: string; workRoot: string } | null;
    local: boolean | null;
    credentials: Array<{ name: string; reference: string }>;
  };
  runtime: {
    node: { version: string; engines: string | null; ok: boolean };
    sqlite: { version: string | null; ok: boolean };
  };
  store: DoctorStore;
  host: DoctorHost;
  gsd: DoctorGsd;
  graphify: DoctorGraphify;
  adapters: Array<{ name: string; port: string; adapter: string }>;
  runs: DoctorRuns;
  records: DoctorRecord[];
  events: DoctorEvents;
  findings: DoctorFinding[];
  // Present only when the flag asked for it.
  online?: DoctorOnline;
  repair?: { removed: number; kept: number };
  extensions?: DoctorExtensions;
}

export const REPAIR_MIN_AGE_MS = 3_600_000;

const SECTION_FIX_PROFILE = 'fix the profile config (its path is in the message), or remove the key';

// ---- derived rules -------------------------------------------------------------------------------------------------------------------------------------------------

// Whether a stored project record can be used with the located gsd-core (S-38). Doctor is read-only, so incompatibility is derived and never written: a record is
// incompatible when no admitted gsd-core is located, when the located one is outside the adapter's range, or when its minor differs from the minor the record was built
// under. `start` applies the same rule before it writes anything. `found` is what the locator said about a gsd-core it did not admit, for the message.
export function recordCompatibility(
  record: { gsdVersion: string },
  located: { version: string } | undefined,
  found?: string,
): 'compatible' | { incompatible: string; fix: string } {
  const recordedMinor = gsdMinorOf(record.gsdVersion);
  const line = recordedMinor === undefined ? GSD_ADMITTED_RANGE : `${recordedMinor}.x`;
  const fix = `reinstall GSD ${line} or re-onboard after the adapter supports the new version`;
  const under = `the record was built under GSD ${record.gsdVersion}`;
  if (located === undefined) {
    return { incompatible: `${under}, and no admitted gsd-core is installed${found !== undefined && found !== '' ? ` (${found})` : ''}`, fix };
  }
  if (!gsdVersionAdmitted(located.version)) {
    return { incompatible: `${under}, and the installed gsd-core ${located.version} is outside the adapter's range ${GSD_ADMITTED_RANGE}`, fix };
  }
  const locatedMinor = gsdMinorOf(located.version);
  if (recordedMinor !== undefined && locatedMinor !== undefined && recordedMinor !== locatedMinor) {
    return { incompatible: `${under}, and the installed gsd-core ${located.version} is another minor`, fix };
  }
  return 'compatible';
}

// `>=major.minor.patch`, the only rule shape the engines field of this package uses; any other shape is not judged.
export function nodeSatisfies(version: string, rule: string | undefined): boolean {
  const wanted = rule === undefined ? undefined : /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(rule.trim());
  const have = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (wanted === null || wanted === undefined || have === null) return true;
  for (let i = 1; i <= 3; i += 1) {
    const difference = Number(have[i]) - Number(wanted[i]);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

const VERSION_OUTPUT = /^\s*(\d+\.\d+\.\d+)\b/;

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

function mapStrings<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, redact)) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, redact);
    return out as T;
  }
  return value;
}

// ---- sections -------------------------------------------------------------------------------------------------------------------------------------------------------

// A string that has the shape of a reference (`scheme:name`) is shown as written; anything else is shown as "not a credential reference", so a secret typed where a
// reference belongs is never echoed back.
const REFERENCE_SHAPE = /^[A-Za-z][A-Za-z0-9+.-]{0,15}:[A-Za-z0-9._-]{1,128}$/;

interface ReferenceRow {
  name: string;
  reference: string;
  provider: ProviderName | undefined;
}

function referencesOf(profile: DoctorProfile, findings: DoctorFinding[]): ReferenceRow[] {
  const raw = profile.credentials;
  if (raw === undefined) return [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    findings.push({ level: 'error', area: 'profile', message: `profile config credentials: expected an object of credential references (${profile.configPath})`, fix: SECTION_FIX_PROFILE });
    return [];
  }
  const rows: ReferenceRow[] = [];
  const allowed = providersFor(profile.profile);
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (name === 'helpers') continue;
    const shownName = printable(name, 40);
    if (typeof value !== 'string') {
      findings.push({ level: 'error', area: 'profile', message: `credentials.${shownName}: expected a credential reference string`, fix: 'use keychain:<service>, cmd:<helper name> or delegated:<cli>' });
      rows.push({ name: shownName, reference: '(not a credential reference)', provider: undefined });
      continue;
    }
    const shown = REFERENCE_SHAPE.test(value) ? value : '(not a credential reference)';
    const parsed = parseCredentialRef(value);
    if (!parsed.ok) {
      findings.push({
        level: 'error',
        area: 'profile',
        message: `credentials.${shownName}: the reference ${shown} is refused${value.toLowerCase().startsWith('env:') ? ' (an environment variable is not a credential source, S-49)' : ''}`,
        fix: 'use delegated:, keychain: or cmd: references (delegated: only under personal-extended)',
      });
      rows.push({ name: shownName, reference: shown, provider: undefined });
      continue;
    }
    if (!allowed.includes(parsed.value.provider)) {
      findings.push({
        level: 'warning',
        area: 'profile',
        message: `credentials.${shownName}: ${parsed.value.provider}: references are not resolved under ${profile.profile}`,
        fix: `use one of ${allowed.map((p) => `${p}:`).join(', ')}, or run under a profile that allows ${parsed.value.provider}:`,
      });
    }
    rows.push({ name: shownName, reference: shown, provider: parsed.value.provider });
  }
  return rows;
}

// The host section with its keys in the order the report documents, whichever branch built it.
function inOrder(h: DoctorHost): DoctorHost {
  return {
    claudeBin: h.claudeBin,
    claudeVersion: h.claudeVersion,
    admission: h.admission,
    refusal: h.refusal,
    restricted: h.restricted,
    enforcement: h.enforcement,
    sandbox: h.sandbox,
    hookEntry: h.hookEntry,
    attended: h.attended,
    configDir: h.configDir,
  };
}

function hostSection(deps: DoctorDeps, findings: DoctorFinding[]): DoctorHost {
  const d = deps.diagnostics;
  const attendedSettings = d.hookSettings(deps.claudeConfigDir);
  const attended: DoctorHost['attended'] = attendedSettings.attendedEntries > 0 ? 'enforced (privileged approvals only)' : 'none';
  const hookEntry: DoctorHost['hookEntry'] = d.readable(deps.hookEntry) ? 'readable' : 'unreadable';
  const base = { claudeBin: deps.claudeBin ?? null, hookEntry, attended, configDir: deps.claudeConfigDir };
  const verifiedList = VERIFIED_HOST_VERSIONS.join(', ');

  const facts = deps.claudeBin === undefined ? ({ state: 'absent' } as const) : d.claude(deps.claudeBin);
  if (facts.state === 'absent') {
    findings.push({
      level: 'warning',
      area: 'host',
      message: 'claude was not found; onboarding and runs need it',
      fix: 'install Claude Code, or set AVARICE_CLAUDE_BIN to its executable',
    });
    return inOrder({ ...base, claudeVersion: null, admission: 'absent', refusal: null, restricted: false, enforcement: 'none', sandbox: 'not probed' });
  }
  if (facts.state === 'failed') {
    findings.push({
      level: 'warning',
      area: 'host',
      message: `claude --version did not answer (${facts.cause}); the host is refused`,
      fix: 'check that the claude executable runs, or set AVARICE_CLAUDE_BIN to one that does',
    });
    return inOrder({ ...base, claudeVersion: null, admission: 'refused', refusal: 'host-unavailable', restricted: false, enforcement: 'none', sandbox: 'not probed' });
  }

  let help: string | undefined;
  let helpRead = false;
  const helpText = (): string | undefined => {
    if (!helpRead) {
      helpRead = true;
      help = deps.claudeBin === undefined ? undefined : d.claudeHelp(deps.claudeBin);
    }
    return help;
  };
  const reported = VERSION_OUTPUT.exec(facts.versionOutput)?.[1];
  let admission: HostAdmissionLabel;
  let refusal: string | null = null;
  if (reported === undefined) {
    // An empty or unparseable answer is never an admitted version (OPS-6).
    admission = 'refused';
    refusal = 'host-version-unreadable';
  } else {
    const verdict = admitHostVersion(reported);
    if ('refused' in verdict) {
      admission = 'refused';
      refusal = verdict.refused;
    } else if (verdict.admission === 'verified') {
      admission = 'verified';
    } else {
      // An unverified patch is admitted only while the host still lists every flag the launch line uses.
      const text = helpText();
      const missing = text === undefined ? undefined : REQUIRED_HELP_FLAGS.find((flag) => !helpListsFlag(text, flag));
      if (text === undefined) {
        admission = 'refused';
        refusal = 'host-unavailable';
      } else if (missing !== undefined) {
        admission = 'refused';
        refusal = `host-flag-missing:${missing}`;
      } else {
        admission = 'admitted (unverified patch)';
      }
    }
  }

  const admitted = admission === 'verified' || admission === 'admitted (unverified patch)';
  let sandbox: DoctorHost['sandbox'] = 'not probed';
  let enforced = false;
  if (admitted) {
    sandbox = d.sandbox() ? 'ok' : 'unavailable';
    enforced = sandbox === 'ok' && hookEntry === 'readable';
  }
  let restricted = false;
  if (!enforced) {
    const text = helpText();
    restricted = text !== undefined && RESTRICTED_HELP_FLAGS.every((flag) => helpListsFlag(text, flag));
  }
  const enforcement: DoctorHost['enforcement'] = enforced ? 'enforced' : restricted ? 'restricted' : 'none';

  if (!admitted) {
    const why = reported === undefined ? 'claude --version printed no readable version' : `claude ${reported} is refused (${refusal ?? 'not admitted'})`;
    findings.push({
      level: 'warning',
      area: 'host',
      message: `${why}; unattended runs and contained onboarding need an admitted host`,
      fix: restricted
        ? `rerun with --restricted for analysis and planning only, or install a verified Claude Code (${verifiedList})`
        : `install a verified Claude Code (${verifiedList}), or a patch of the 2.1 line that lists every flag the launch line uses`,
    });
  } else if (sandbox === 'unavailable') {
    findings.push({
      level: 'warning',
      area: 'host',
      message: 'the OS sandbox did not apply a profile; unattended runs and contained onboarding are refused',
      fix: restricted ? 'run where /usr/bin/sandbox-exec can apply a profile, or rerun with --restricted for analysis and planning only' : 'run where /usr/bin/sandbox-exec can apply a profile',
    });
  } else if (hookEntry === 'unreadable') {
    findings.push({
      level: 'warning',
      area: 'host',
      message: `the hook entry ${deps.hookEntry} cannot be read; unattended runs and contained onboarding are refused`,
      fix: 'reinstall AVARICE, or set AVARICE_HOOK_ENTRY to the hook entry script',
    });
  }
  if (attendedSettings.state === 'unreadable') {
    findings.push({
      level: 'warning',
      area: 'host',
      message: `${attendedSettings.path} cannot be read as settings JSON, so the attended hook is reported as none`,
      fix: 'repair the file, then run avarice install-host',
    });
  }
  return inOrder({ ...base, claudeVersion: reported ?? 'unknown', admission, refusal, restricted, enforcement, sandbox });
}

function gsdSection(facts: GsdFacts, findings: DoctorFinding[]): DoctorGsd {
  if (facts.state === 'absent') {
    findings.push({
      level: 'warning',
      area: 'gsd',
      message: `no gsd-core was found${facts.searched.length > 0 ? ` (looked in ${facts.searched.join(', ')})` : ''}; onboarding and runs need it`,
      fix: `install @opengsd/gsd-core ${GSD_ADMITTED_RANGE}, or set GSD_HOME to its directory`,
    });
    return { state: 'absent', version: null, location: null, admitted: GSD_ADMITTED_RANGE, detail: null };
  }
  if (facts.state === 'unreadable') {
    findings.push({
      level: 'error',
      area: 'gsd',
      message: `a gsd-core was found but did not report its identity: ${facts.detail}`,
      fix: `reinstall @opengsd/gsd-core ${GSD_ADMITTED_RANGE}`,
    });
    return { state: 'incompatible', version: null, location: facts.dir, admitted: GSD_ADMITTED_RANGE, detail: facts.detail };
  }
  const ok = facts.packageName === '@opengsd/gsd-core' && gsdVersionAdmitted(facts.version);
  if (!ok) {
    findings.push({
      level: 'error',
      area: 'gsd',
      message: `found ${facts.packageName} ${facts.version} at ${facts.dir}; the adapter admits @opengsd/gsd-core ${GSD_ADMITTED_RANGE}`,
      fix: `install @opengsd/gsd-core ${GSD_ADMITTED_RANGE}, or wait for an AVARICE release that admits ${facts.version}`,
    });
  }
  return { state: ok ? 'ok' : 'incompatible', version: facts.version, location: facts.dir, admitted: GSD_ADMITTED_RANGE, detail: ok ? null : `${facts.packageName} ${facts.version}` };
}

interface StoreOutcome {
  section: DoctorStore;
  adapters: Array<{ name: string; port: string; adapter: string }>;
  readable: boolean;
  // What the store holds of the events table, when it was read.
  events?: { rows: number; droppedDebug: number };
}

function storeSection(deps: DoctorDeps, findings: DoctorFinding[]): StoreOutcome {
  const empty = (state: DoctorStore['state']): DoctorStore => ({ path: null, state, schema: null, expectedSchema: deps.expectedSchema, journalMode: null, integrity: null, sizeBytes: null, lastBackup: null, profileId: null });
  if (!deps.profile.ok) return { section: empty('unchecked'), adapters: [], readable: false };
  const path = `${deps.profile.value.dataRoot}/state.db`;
  const facts = deps.diagnostics.store(path);
  const section: DoctorStore = {
    ...empty('ok'),
    path,
    schema: facts.schemaVersion ?? null,
    journalMode: facts.journalMode ?? null,
    integrity: facts.integrity ?? null,
    sizeBytes: facts.sizeBytes ?? null,
    lastBackup: facts.lastBackupMs === undefined ? null : isoOf(facts.lastBackupMs),
    profileId: facts.profileId ?? null,
  };
  if (facts.state === 'absent') {
    section.state = 'absent';
    return { section, adapters: [], readable: false };
  }
  if (facts.state === 'unreadable') {
    section.state = 'unreadable';
    findings.push({
      level: 'error',
      area: 'store',
      message: `the store ${path} cannot be opened read-only: ${facts.detail ?? 'unreadable'}`,
      fix: 'restore the store from a backup (backups/ beside it), or point AVARICE_DATA_ROOT at a store you own',
    });
    return { section, adapters: [], readable: false };
  }
  const adapters = [...facts.adapters];
  if (facts.profileId !== undefined && deps.profile.ok && facts.profileId !== deps.profile.value.profile) {
    section.state = 'foreign';
    findings.push({
      level: 'error',
      area: 'store',
      message: `the store belongs to profile ${printable(facts.profileId, 64)}, not ${deps.profile.value.profile}`,
      fix: `run under that profile (--profile ${printable(facts.profileId, 64)}), or point the roots at a store of ${deps.profile.value.profile}`,
    });
    return { section, adapters, readable: false };
  }
  const schema = facts.schemaVersion;
  if (schema !== undefined && schema > deps.expectedSchema) {
    section.state = 'newer';
    findings.push({
      level: 'error',
      area: 'store',
      message: `the store is schema ${schema} and was written by a newer AVARICE (this build writes schema ${deps.expectedSchema}); it was opened read-only and nothing was changed`,
      fix: 'run the AVARICE that wrote it, or restore a backup taken before the upgrade',
    });
    return { section, adapters, readable: false };
  }
  if (schema === undefined || schema < deps.expectedSchema) {
    section.state = 'older';
    findings.push({
      level: 'warning',
      area: 'store',
      message: schema === undefined ? 'the store records no migration' : `the store is schema ${schema}; this build writes schema ${deps.expectedSchema}`,
      fix: 'the next command that writes migrates it, after taking a backup',
    });
    return { section, adapters, readable: false };
  }
  if (facts.integrity !== undefined && facts.integrity !== 'ok') {
    findings.push({ level: 'error', area: 'store', message: `the store failed its integrity check: ${facts.integrity}`, fix: 'restore the store from a backup (backups/ beside it)' });
  }
  if (facts.journalMode !== undefined && facts.journalMode !== 'wal') {
    findings.push({ level: 'warning', area: 'store', message: `the store's journal mode is ${facts.journalMode}, not wal`, fix: 'move the data root to local storage; the next command that writes switches it to wal' });
  }
  return { section, adapters, readable: true, ...(facts.events !== undefined ? { events: facts.events } : {}) };
}

function runsAndRecords(deps: DoctorDeps, located: { version: string } | undefined, found: string | undefined, readable: boolean, findings: DoctorFinding[]): { runs: DoctorRuns; records: DoctorRecord[] } {
  const none = { runs: { read: false, total: 0, byState: {}, interrupted: [] }, records: [] };
  if (!readable) return none;
  const ledger = deps.readLedger();
  if (ledger === undefined) return none;
  const status = getStatus(ledger, deps.clock.nowMs());
  if (!status.ok) {
    findings.push({ level: 'error', area: 'runs', message: `the runs could not be read: ${status.error.kind}`, fix: 'run avarice status for the cause, or restore the store from a backup' });
    return none;
  }
  const runs: DoctorRuns = { read: true, total: 0, byState: {}, interrupted: [] };
  const records: DoctorRecord[] = [];
  for (const project of status.value) {
    for (const run of project.runs ?? []) {
      runs.total += 1;
      runs.byState[run.state] = (runs.byState[run.state] ?? 0) + 1;
      if (run.interrupted !== undefined) runs.interrupted.push({ kind: 'run', id: run.runId, title: run.title, state: run.state, resume: run.interrupted.resumeCommand });
    }
    if (project.interrupted !== undefined && project.onboardingId !== null) {
      runs.interrupted.push({ kind: 'onboarding', id: project.onboardingId, title: null, state: project.interrupted.state, resume: project.interrupted.resumeCommand });
    }
    if (project.recordVersion === null) continue;
    const active = ledger.getActiveRecord(project.projectId);
    if (!active.ok || active.value === null) continue;
    const verdict = recordCompatibility({ gsdVersion: active.value.gsdVersion }, located, found);
    records.push({
      projectId: project.projectId,
      repoPath: project.repoPath,
      version: active.value.version,
      onboardedRevision: active.value.onboardedRevision,
      gsdVersion: active.value.gsdVersion,
      compatibility: verdict === 'compatible' ? 'compatible' : 'incompatible',
      reason: verdict === 'compatible' ? null : verdict.incompatible,
    });
    if (verdict !== 'compatible') {
      findings.push({
        level: 'error',
        area: 'records',
        message: `the active record of ${project.projectId} (version ${active.value.version}, revision ${active.value.onboardedRevision}) is incompatible: ${verdict.incompatible}; its evidence stays tied to that revision and GSD version`,
        fix: verdict.fix,
      });
    }
  }
  return { runs, records };
}

async function onlineSection(deps: DoctorDeps, profile: DoctorProfile | undefined, refs: readonly ReferenceRow[], findings: DoctorFinding[]): Promise<DoctorOnline> {
  const delegated = refs.filter((r) => r.provider === 'delegated');
  if (profile === undefined || delegated.length === 0) return { checks: [], note: 'no delegated credential reference is configured, so there is nothing to check online' };
  const allowed = providersFor(profile.profile).includes('delegated');
  const checks: DoctorOnline['checks'] = [];
  for (const ref of delegated) {
    const cli = ref.reference.slice('delegated:'.length);
    if (!allowed) {
      checks.push({ name: ref.name, reference: ref.reference, status: `not checked: delegated: references are not resolved under ${profile.profile}` });
      continue;
    }
    const result = await deps.diagnostics.delegatedAuth(cli, deps.env);
    let status: string;
    if (result.state === 'ok') status = 'ok';
    else if (result.state === 'timed_out') status = 'timed out';
    else if (result.state === 'absent') status = `${cli} was not found on PATH`;
    else status = `${cli} auth status failed (exit ${result.exitCode === null ? 'signal' : String(result.exitCode)})`;
    checks.push({ name: ref.name, reference: ref.reference, status });
    if (result.state !== 'ok') {
      findings.push({
        level: 'warning',
        area: 'online',
        message: `${ref.reference}: ${status}`,
        fix: result.state === 'absent' ? `install ${cli} and put it on PATH` : `run ${cli} auth login, then rerun avarice doctor --online`,
      });
    }
  }
  return { checks, note: null };
}

function extensionsSection(deps: DoctorDeps, findings: DoctorFinding[]): DoctorExtensions {
  const dirs = deps.extensionDirs.map((path) => deps.diagnostics.configDir(path));
  const existing = dirs.filter((d) => d.exists);
  const withHook = existing.filter((d) => d.attendedEntries > 0);
  if (withHook.length > 1) {
    findings.push({
      level: 'warning',
      area: 'extensions',
      message: `the AVARICE attended hook is registered in more than one Claude configuration directory: ${withHook.map((d) => d.path).join(', ')}`,
      fix: `keep the entry in ${deps.claudeConfigDir} (the directory in use) and remove it from the others`,
    });
  }
  for (const d of existing) {
    if (d.attendedEntries > 1) {
      findings.push({ level: 'warning', area: 'extensions', message: `${d.path}/settings.json holds ${d.attendedEntries} AVARICE attended hook entries`, fix: 'run avarice install-host, which keeps one' });
    }
  }
  const seen = new Map<string, string[]>();
  for (const d of existing) for (const skill of d.skills) seen.set(skill, [...(seen.get(skill) ?? []), d.path]);
  for (const [skill, where] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
    if (where.length > 1) {
      findings.push({ level: 'warning', area: 'extensions', message: `the skill ${skill} is installed in more than one Claude configuration directory: ${where.join(', ')}`, fix: `keep it in ${deps.claudeConfigDir} and remove the other copies` });
    }
  }
  for (const d of existing) {
    for (const line of d.instructionLines) {
      findings.push({
        level: 'warning',
        area: 'extensions',
        message: `${d.path}/CLAUDE.md line ${line} mentions git push or opening a pull request without approval`,
        fix: 'say that a push or a pull request needs the owner\'s approval, so a session that reads it does not do either on its own',
      });
    }
  }
  return {
    activeConfigDir: deps.claudeConfigDir,
    configDirs: dirs.map((d) => ({ path: d.path, active: d.path === deps.claudeConfigDir, exists: d.exists, attendedHookEntries: d.attendedEntries, skills: d.skills })),
  };
}

// The events table against `limits.maxEventRows`. A limits section that cannot be used is an error finding: `start` refuses it, and the bounds it was meant to set are the defaults
// until it is fixed.
function eventsSection(deps: DoctorDeps, store: StoreOutcome, findings: DoctorFinding[]): DoctorEvents {
  const parsed = parseLimitsSection(deps.profile.ok ? deps.profile.value.limits : undefined);
  if (!parsed.ok) {
    const where = deps.profile.ok ? ` (${deps.profile.value.configPath})` : '';
    findings.push({
      level: 'error',
      area: 'limits',
      message: `profile config ${parsed.error.kind === 'invalid' ? `${parsed.error.field}: ${parsed.error.reason}` : 'limits cannot be read'}${where}`,
      fix: SECTION_FIX_PROFILE,
    });
  }
  const bound = parsed.ok ? parsed.value.maxEventRows : LIMIT_DEFAULTS.maxEventRows;
  if (!store.readable || store.events === undefined) return { read: false, rows: 0, bound, droppedDebug: 0 };
  if (store.events.droppedDebug > 0) {
    findings.push({
      level: 'warning',
      area: 'events',
      message: `${store.events.droppedDebug} debug event${store.events.droppedDebug === 1 ? ' was' : 's were'} refused because the events table reached its bound of ${bound} rows (${store.events.rows} rows now)`,
      fix: 'raise limits.maxEventRows in the profile config if the table should keep growing; events at info and above are never refused',
    });
  }
  return { read: true, rows: store.events.rows, bound, droppedDebug: store.events.droppedDebug };
}

// ---- the report ------------------------------------------------------------------------------------------------------------------------------------------------------

export async function runDoctor(deps: DoctorDeps, options: DoctorOptions = {}): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const d = deps.diagnostics;
  const profile = deps.profile.ok ? deps.profile.value : undefined;
  if (!deps.profile.ok) {
    findings.push({ level: 'error', area: 'profile', message: `the profile could not be prepared: ${deps.profile.message}`, fix: SECTION_FIX_PROFILE });
  }
  const references = profile === undefined ? [] : referencesOf(profile, findings);

  const node = d.node();
  const nodeOk = nodeSatisfies(node.version, node.engines);
  if (!nodeOk) {
    findings.push({ level: 'error', area: 'runtime', message: `node ${node.version} does not satisfy the engines rule ${node.engines ?? ''}`, fix: 'install Node 22.22.3 or newer' });
  }
  const sqlite = d.sqliteVersion();
  if (!sqlite.ok) {
    findings.push({ level: 'error', area: 'runtime', message: 'the bundled SQLite version could not be read', fix: 'install Node 22.22.3 or newer' });
  }

  const store = storeSection(deps, findings);
  const host = hostSection(deps, findings);
  const gsdFacts = d.gsd(deps.env);
  const gsd = gsdSection(gsdFacts, findings);
  const located = gsdFacts.state === 'found' ? { version: gsdFacts.version } : undefined;
  const found = gsdFacts.state === 'found' ? `found ${gsdFacts.packageName} ${gsdFacts.version} at ${gsdFacts.dir}` : gsdFacts.state === 'unreadable' ? gsdFacts.detail : undefined;
  const graphifyFacts = d.graphify(deps.env);
  const graphify: DoctorGraphify = graphifyFacts.state === 'absent' ? { state: 'absent', version: null, path: null } : { state: 'present', version: graphifyFacts.version ?? null, path: graphifyFacts.path };
  const { runs, records } = runsAndRecords(deps, located, found, store.readable, findings);

  const report: DoctorReport = {
    profile: {
      name: profile?.profile ?? null,
      class: profile?.class ?? null,
      roots: profile === undefined ? null : { configHome: profile.configHome, dataRoot: profile.dataRoot, workRoot: profile.workRoot },
      // resolveProfile refuses a data root on a network or non-local mount, so a resolved profile's data root is local.
      local: profile === undefined ? null : true,
      credentials: references.map((r) => ({ name: r.name, reference: r.reference })),
    },
    runtime: { node: { version: node.version, engines: node.engines ?? null, ok: nodeOk }, sqlite: { version: sqlite.ok ? sqlite.value : null, ok: sqlite.ok } },
    store: store.section,
    host,
    gsd,
    graphify,
    adapters: store.adapters,
    runs,
    records,
    events: eventsSection(deps, store, findings),
    findings,
  };
  if (options.online === true) report.online = await onlineSection(deps, profile, references, findings);
  if (options.repair === true && profile !== undefined) report.repair = d.removeOrphanTemps(profile.dataRoot, deps.clock.nowMs(), REPAIR_MIN_AGE_MS);
  if (options.extensions === true) report.extensions = extensionsSection(deps, findings);
  return mapStrings(report, deps.redact);
}
