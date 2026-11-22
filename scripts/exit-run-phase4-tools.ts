// Tools of the AC-14 brownfield benchmark (plan 04-35; ONB-6, ONB-11, ONB-15; D-03, D-04, D-05), driven in order by scripts/exit-run-phase4.sh. Five
// repositories the owner approved (test/benchmark/phase4/ac14-repositories.json) are onboarded live with the knowledge pass, each from a checkout whose bytes and
// refs are digested before and after. Spend is the owner's: nothing here starts a model except `run-one`, and `run-one` refuses until the owner has recorded an
// authorization from their own terminal.
//
//   dry-run [--per-repo USD] [--profile extended|local] [--list F] [--evidence F]
//       Reads the approved list (exit 1 for a draft), clones each public repository at its pin into the benchmark clone root (network read only; an existing
//       clone is verified, never changed), digests every checkout and its refs, reads GSD artifacts at HEAD, finds the active records the owner's profiles
//       already hold (an active record means the path is a refresh), and prints per repository the source, pin, expected path, profile, digests and cap, and the
//       projected total against the Phase 4 ledger. Writes the `dryRun` block of the evidence file. Exit 1 when the list is unapproved, a clone is not at its
//       pin and clean, the host is not installed or the projection passes the ceiling. Spends nothing and starts no model.
//   authorize --cap USD --profile extended|local [--per-repo USD] [--per-invocation USD] [--replace] [--list F] [--evidence F]
//       The owner's authorization: refuses (exit 2) unless stdin and stdout are both an interactive terminal, shows the dry run, asks the owner to type
//       `authorize`, and records `ownerConfirmedAt`, the caps, the profile for the four new repositories and the list digest in the evidence file.
//   run-one ID [--ruling-ref TEXT] [--list F] [--evidence F]
//       One live onboarding of one approved repository under the recorded authorization. Records the before and after digests, the record's state, the mapping
//       outcome, the indexes, the knowledge counts and cache hits, the refresh mode, the cost and any containment finding. Exit 0 only for an active record with
//       equal digests; exit 75 for the stop-loss (two attempts in an epoch, or a failure the owner has not ruled on per D-04) or a spend that would pass a cap.
//       An active repository is run again only with `--ruling-ref` and only when its knowledge index was absent (the owner's ruling to measure the knowledge pass).
//   classify --id ID --class product-defect|harness-defect --summary TEXT --by claude|owner [--ref TEXT] [--evidence F]
//       Records Claude's proposed D-04 classification of a stopped attempt, and the owner's ruling on it.
//   verify [--list F] [--evidence F]       Exit 0 only for 5 of 5 active, equal digests, 0 containment failures, on the approved list.
//   finish [--list F] [--evidence F]       Runs verify and records the close of the benchmark (the spend under this plan and the pass).
//   ids [--list F]                         Prints the approved ids in order (for the run script).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { collectRepoFacts } from '../src/adapters/git/repo-facts.ts';
import { runGit, safeGitEnv } from '../src/adapters/git/safe-git.ts';
import { configRoot, resolveConfigHome } from '../src/adapters/fs/profile-paths.ts';
import { readProfileConfig } from '../src/adapters/fs/profile-config.ts';
import { VERIFIED_HOST_VERSIONS } from '../src/domain/host-admission.ts';
import { classifyExistingMap, existingMapOutcome, userOwnedPaths } from '../src/domain/preflight.ts';
import { phase4Ceiling, phase4LedgerPath, phase4Spent, recordPhase4Spend, redactHome, spentByPlan } from '../test/helpers/live-harness.ts';
import { checkoutDigest } from './checkout-digest.ts';

type Json = Record<string, unknown>;

export const PLAN = '04-35';
const REPO_ROOT = resolve(import.meta.dirname, '..');
export const LIST_REL = 'test/benchmark/phase4/ac14-repositories.json';
export const EVIDENCE_REL = '.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-35-evidence-ac14.json';
// The five repositories of the pass bar (D-05): fewer is a failed list, more is an unapproved one.
export const EXPECTED_COUNT = 5;
// The host the benchmark runs on: the version plan 04-34 admitted, named by the installed file so the dry run reads it without running it.
export const HOST_VERSION = '2.1.326';
// Roughly 8 USD over five repositories (D-03: the ceiling is 40 USD for the phase).
export const DEFAULT_PER_REPO_CAP_USD = 1.6;
export const PORTFOLIO_ID = 'aa-phan-portfolio-v2';
const PERSONAL_LOCAL = 'personal-local';
const PERSONAL_EXTENDED = 'personal-extended';
const STOP_LOSS_ATTEMPTS = 2;

export type ProfileChoice = 'extended' | 'local';

const out = (text: string): void => void process.stdout.write(text);
const errOut = (text: string): void => void process.stderr.write(`${text}\n`);
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const round = (value: number, places = 6): number => Number(value.toFixed(places));
const SHA40 = /^[0-9a-f]{40}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function flags(argv: readonly string[]): { named: Record<string, string>; bools: Set<string>; positionals: string[] } {
  const named: Record<string, string> = {};
  const bools = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (!word.startsWith('--')) {
      positionals.push(word);
      continue;
    }
    const key = word.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      named[key] = next;
      i += 1;
    } else bools.add(key);
  }
  return { named, bools, positionals };
}

// ---------------------------------------------------------------------------------------------------------------
// The approved list
// ---------------------------------------------------------------------------------------------------------------

export interface Repository {
  id: string;
  stack: string;
  source: string;
  sourceKind: 'owner-path' | 'public-url';
  pin: string;
  hasPlanning: boolean;
  hasCodebaseMap?: boolean;
  notes?: string;
}

export interface ApprovedList {
  approvedBy: string;
  approvedAt: string;
  passBar: string;
  repositories: Repository[];
  sha256: string;
}

// The list as the owner approved it. A draft (both approval fields null), a half-written approval, an id that is not one safe path segment (it names the clone
// directory), a pin that is not a 40-hex commit and a duplicate id are refused here, before anything is cloned or digested.
export function loadList(path: string): { ok: true; list: ApprovedList } | { ok: false; problems: string[] } {
  let text: string;
  let parsed: unknown;
  try {
    text = readFileSync(path, 'utf8');
    parsed = JSON.parse(text);
  } catch (cause) {
    return { ok: false, problems: [`the approved list ${path} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`] };
  }
  const problems: string[] = [];
  if (!isObject(parsed)) return { ok: false, problems: ['the approved list is not a JSON object'] };
  const { approvedBy, approvedAt } = parsed;
  if (approvedBy === null && approvedAt === null) problems.push('the list is a draft: the owner has not approved it (approvedBy and approvedAt are null)');
  else if (typeof approvedBy !== 'string' || approvedBy.trim() === '' || typeof approvedAt !== 'string' || !RFC3339.test(approvedAt)) problems.push('the list approval is incomplete: approvedBy must name the owner and approvedAt must be an RFC 3339 time');
  const repositories = parsed['repositories'];
  if (!Array.isArray(repositories) || repositories.length === 0) problems.push('the list names no repositories');
  else {
    const seen = new Set<string>();
    repositories.forEach((raw, index) => {
      if (!isObject(raw)) return void problems.push(`repository ${index + 1} is not an object`);
      const id = raw['id'];
      if (typeof id !== 'string' || !SAFE_ID.test(id)) return void problems.push(`repository ${index + 1} has an id that is not one safe path segment`);
      if (seen.has(id)) problems.push(`${id}: listed twice`);
      seen.add(id);
      if (typeof raw['pin'] !== 'string' || !SHA40.test(raw['pin'])) problems.push(`${id}: the pin is not a 40-hex commit`);
      const kind = raw['sourceKind'];
      const source = raw['source'];
      if (kind !== 'owner-path' && kind !== 'public-url') problems.push(`${id}: sourceKind must be owner-path or public-url`);
      else if (typeof source !== 'string' || (kind === 'owner-path' ? !(source.startsWith('~/') || source.startsWith('/')) : !source.startsWith('https://'))) problems.push(`${id}: the source does not fit its kind (${String(kind)})`);
    });
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    list: { approvedBy: approvedBy as string, approvedAt: approvedAt as string, passBar: String(parsed['passBar'] ?? ''), repositories: repositories as Repository[], sha256: sha256(text) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Spend and profile
// ---------------------------------------------------------------------------------------------------------------

export function projectionOf(input: { spentUsd: number; ceilingUsd: number; perRepoCapUsd: number; count: number }): { totalUsd: number; fits: boolean; headroomUsd: number } {
  const totalUsd = round(input.perRepoCapUsd * input.count);
  return { totalUsd, fits: input.spentUsd + totalUsd <= input.ceilingUsd + 1e-9, headroomUsd: round(input.ceilingUsd - input.spentUsd) };
}

// The portfolio is active and bound to personal-local (plan 04-08), so its onboarding is a refresh there whatever the owner chooses for the four new ones.
export function profileOf(id: string, choice: ProfileChoice | string): string {
  return id === PORTFOLIO_ID ? PERSONAL_LOCAL : choice === 'extended' ? PERSONAL_EXTENDED : PERSONAL_LOCAL;
}

// ---------------------------------------------------------------------------------------------------------------
// The state of a checkout: what "no byte of the checkout or refs changed" compares
// ---------------------------------------------------------------------------------------------------------------

export const STATE_DIGESTS = ['head', 'statusDigest', 'filesDigest', 'refsDigest', 'worktreesDigest', 'indexDigest', 'gitMetaDigest', 'ignoredDigest'] as const;

export interface RepoState {
  head: string;
  branch: string;
  headRef: string;
  statusDigest: string;
  filesDigest: string;
  refsDigest: string;
  worktreesDigest: string;
  indexDigest: string;
  gitMetaDigest: string;
  ignoredDigest: string;
  counts: { tracked: number; untracked: number; statusEntries: number; refs: number };
}

function gitText(repo: string, args: readonly string[], acceptExit: readonly number[] = []): string {
  const ran = runGit(args, { cwd: repo, timeoutMs: 120_000, acceptExit });
  if (!ran.ok) throw new Error(`git ${args[0] ?? ''} failed in ${repo}: ${JSON.stringify(ran.error)}`);
  return ran.value.stdout;
}

// The checkout digest of scripts/checkout-digest.ts (tracked and untracked file bytes, status, refs, worktrees) plus what that leaves out: the index entries, the
// symbolic HEAD, the repository configuration and hooks (a changed config or hook is a change to the checkout), and the names of the ignored files. The ignored
// files' bytes are not read: a build directory such as node_modules can be large, and the sandbox denies the host any write there; their names are.
export function captureState(repo: string): RepoState {
  const digest = checkoutDigest(repo);
  const common = gitText(repo, ['rev-parse', '--git-common-dir']).trim();
  const commonDir = common.startsWith('/') ? common : join(repo, common);
  const meta = createHash('sha256');
  for (const rel of ['config', 'info/exclude', 'info/attributes']) {
    meta.update(`${rel}\0`).update(existsSync(join(commonDir, rel)) ? readFileSync(join(commonDir, rel)) : 'absent').update('\0');
  }
  const hooks = join(commonDir, 'hooks');
  for (const name of existsSync(hooks) ? readdirSync(hooks).sort() : []) meta.update(`hooks/${name}\0`).update(readFileSync(join(hooks, name))).update('\0');
  return {
    head: digest.head,
    branch: digest.branch,
    headRef: gitText(repo, ['symbolic-ref', '-q', 'HEAD'], [1]).trim(),
    statusDigest: digest.statusDigest,
    filesDigest: digest.filesDigest,
    refsDigest: digest.refsDigest,
    worktreesDigest: digest.worktreesDigest,
    indexDigest: sha256(gitText(repo, ['ls-files', '--stage', '-z'])),
    gitMetaDigest: meta.digest('hex'),
    ignoredDigest: sha256(gitText(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])),
    counts: { tracked: digest.counts.tracked, untracked: digest.counts.untracked, statusEntries: digest.counts.statusEntries, refs: digest.counts.refs },
  };
}

export function stateDifferences(a: object, b: object): string[] {
  return [...STATE_DIGESTS, 'headRef', 'branch'].filter((key) => (a as Json)[key] !== (b as Json)[key]);
}

export const sameState = (a: object, b: object): boolean => stateDifferences(a, b).length === 0;

// ---------------------------------------------------------------------------------------------------------------
// Where the repositories are and what the owner's profiles already hold
// ---------------------------------------------------------------------------------------------------------------

export interface ActiveRecord {
  profile: string;
  version: number;
  mappingMode: string;
  completeness: string;
  onboardedRevision: string;
}

const ownerHome = (env: NodeJS.ProcessEnv = process.env): string => env['AVARICE_OWNER_HOME'] ?? env['HOME'] ?? homedir();
export const cloneRootOf = (home: string, env: NodeJS.ProcessEnv = process.env): string => env['AVARICE_AC14_ROOT'] ?? join(home, '.local', 'share', 'avarice-work', 'ac14-benchmark');
const expandHome = (path: string, home: string): string => (path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path);

export function pathOf(repository: Repository, home: string, cloneRoot: string): string {
  return repository.sourceKind === 'owner-path' ? expandHome(repository.source, home) : join(cloneRoot, repository.id);
}

// The data root of a profile as the profile's own config names it (read only: nothing is created).
export function dataRootOf(profile: string, env: NodeJS.ProcessEnv = process.env, home = ownerHome(env)): string | undefined {
  const read = readProfileConfig(resolveConfigHome(env), profile);
  if (!read.ok) return undefined;
  const configured = configRoot(read.value.dataRoot, home, 'dataRoot');
  if (!configured.ok) return undefined;
  return configured.value ?? join(home, '.local', 'share', 'avarice', profile);
}

function readLedger<T>(dataRoot: string, sql: string, ...params: Array<string | number>): T[] {
  const file = join(dataRoot, 'state.db');
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((row) => ({ ...row }) as T);
  } finally {
    db.close();
  }
}

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// The active record a repository already has in one of the owner's personal profiles (read only), or undefined.
export function activeRecordIn(repoPath: string, env: NodeJS.ProcessEnv = process.env): ActiveRecord | undefined {
  for (const profile of [PERSONAL_LOCAL, PERSONAL_EXTENDED]) {
    const root = dataRootOf(profile, env);
    if (root === undefined) continue;
    try {
      const [row] = readLedger<{ version: number; mapping_mode: string | null; completeness: string | null; onboarded_revision: string }>(
        root,
        "SELECT r.version, r.mapping_mode, r.completeness, r.onboarded_revision FROM projects p JOIN project_records r ON r.project_id = p.project_id WHERE p.repo_path IN (?, ?) AND r.state = 'active' ORDER BY r.version DESC LIMIT 1",
        repoPath,
        realOf(repoPath),
      );
      if (row !== undefined) return { profile, version: row.version, mappingMode: row.mapping_mode ?? 'unknown', completeness: row.completeness ?? 'unknown', onboardedRevision: row.onboarded_revision };
    } catch {
      // an unreadable ledger is no evidence of a record
    }
  }
  return undefined;
}

// A public repository at its pin, cloned with the safe git environment (no hooks, no fsmonitor, no prompt). The clone is the repository under test: nothing
// modifies it afterwards. A partial clone this function made is removed; an existing directory is never passed here.
export function cloneRepository(url: string, dest: string, pin: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const env = safeGitEnv();
  const cloned = spawnSync('git', ['clone', '--quiet', '--no-checkout', url, dest], { env, encoding: 'utf8', timeout: 15 * 60_000 });
  const checkedOut = cloned.status === 0 ? spawnSync('git', ['checkout', '--quiet', '--detach', pin], { cwd: dest, env, encoding: 'utf8', timeout: 5 * 60_000 }) : cloned;
  if (checkedOut.status !== 0) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`cannot clone ${url} at ${pin.slice(0, 7)}: ${(checkedOut.stderr ?? '').trim().split('\n')[0] ?? 'git failed'}`);
  }
}

function hostOf(home: string): { version: string; claudeBin: string; present: boolean; verified: boolean } {
  const claudeBin = join(home, '.local', 'share', 'claude', 'versions', HOST_VERSION);
  return { version: HOST_VERSION, claudeBin, present: existsSync(claudeBin), verified: VERIFIED_HOST_VERSIONS.includes(HOST_VERSION) };
}

// ---------------------------------------------------------------------------------------------------------------
// The dry run
// ---------------------------------------------------------------------------------------------------------------

export interface DryRunOptions {
  listPath: string;
  home: string;
  cloneRoot: string;
  perRepoCapUsd: number;
  expectedCount: number;
  profileChoice?: ProfileChoice;
  activeRecordOf: (repoPath: string) => ActiveRecord | undefined;
  clone: (url: string, dest: string, pin: string) => void;
}

export interface RepoReport {
  id: string;
  stack: string;
  source: string;
  sourceKind: string;
  pin: string;
  path: string;
  head: string;
  headIsPin: boolean;
  expectedPath: 'refresh' | 'onboard';
  activeRecord?: ActiveRecord;
  profile: string;
  hasPlanningAtHead: boolean;
  planningFiles: number;
  // `userOwnedPaths` counts the files a user-edited map keeps as the owner's (edited after their stamp, or changed under `.planning/` in the checkout).
  existingMap?: { class: string; outcome: string; mapFiles: number; userOwnedPaths: number };
  capUsd: number;
  state: RepoState;
}

export interface DryRunReport {
  schema: 1;
  plan: string;
  at: string;
  list?: { file: string; sha256: string; approvedBy: string; approvedAt: string };
  problems: string[];
  warnings: string[];
  repositories: RepoReport[];
  spend: { ledger: string; spentUsd: number; ceilingUsd: number; perRepoCapUsd: number; projectedUsd: number; afterProjectionUsd: number; fits: boolean };
  host: { version: string; claudeBin: string; present: boolean; verified: boolean };
}

export function buildDryRun(options: DryRunOptions): DryRunReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const spentUsd = phase4Spent();
  const ceilingUsd = phase4Ceiling();
  const projection = projectionOf({ spentUsd, ceilingUsd, perRepoCapUsd: options.perRepoCapUsd, count: options.expectedCount });
  const report: DryRunReport = {
    schema: 1,
    plan: PLAN,
    at: new Date().toISOString(),
    problems,
    warnings,
    repositories: [],
    spend: {
      ledger: relative(REPO_ROOT, phase4LedgerPath()),
      spentUsd: round(spentUsd),
      ceilingUsd,
      perRepoCapUsd: options.perRepoCapUsd,
      projectedUsd: projection.totalUsd,
      afterProjectionUsd: round(spentUsd + projection.totalUsd),
      fits: projection.fits,
    },
    host: hostOf(options.home),
  };
  const loaded = loadList(options.listPath);
  if (!loaded.ok) {
    problems.push(...loaded.problems);
    return report;
  }
  const { list } = loaded;
  report.list = { file: relative(REPO_ROOT, options.listPath), sha256: list.sha256, approvedBy: list.approvedBy, approvedAt: list.approvedAt };
  if (list.repositories.length !== options.expectedCount) problems.push(`the approved list holds ${list.repositories.length} repositories, expected ${options.expectedCount}`);
  if (!projection.fits) problems.push(`the projected ${projection.totalUsd.toFixed(2)} USD (${options.perRepoCapUsd.toFixed(2)} per repository) on the ${spentUsd.toFixed(4)} USD already spent would pass the ${ceilingUsd.toFixed(2)} USD Phase 4 ceiling (D-03)`);
  if (!report.host.present) problems.push(`the pinned host is not installed: ${report.host.claudeBin}`);
  if (!report.host.verified) problems.push(`Claude Code ${HOST_VERSION} is not in VERIFIED_HOST_VERSIONS`);

  for (const repository of list.repositories) {
    const path = pathOf(repository, options.home, options.cloneRoot);
    const label = repository.id;
    try {
      if (repository.sourceKind === 'public-url' && !existsSync(path)) options.clone(repository.source, path, repository.pin);
      if (!existsSync(path)) {
        problems.push(`${label}: ${path} does not exist`);
        continue;
      }
      const state = captureState(path);
      const head = state.head;
      if (repository.sourceKind === 'public-url') {
        if (head !== repository.pin) problems.push(`${label}: the clone is at ${head.slice(0, 7)}, not its pin ${repository.pin.slice(0, 7)}; the tools never move a clone`);
        if (state.counts.statusEntries !== 0 || state.counts.untracked !== 0) problems.push(`${label}: the clone is not clean (${state.counts.statusEntries} status entries); the tools never clean a clone`);
      } else if (head !== repository.pin) warnings.push(`${label}: HEAD ${head.slice(0, 7)} is not the listed pin ${repository.pin.slice(0, 7)}; the onboarding maps HEAD`);
      if (repository.sourceKind === 'owner-path' && state.counts.statusEntries > 0) warnings.push(`${label}: the checkout has ${state.counts.statusEntries} uncommitted entries; they are digested before and after, and the onboarding reads committed content`);

      let planningFiles = 0;
      let existingMap: RepoReport['existingMap'];
      const facts = collectRepoFacts(path);
      if (facts.ok) {
        planningFiles = facts.value.planningFiles.length;
        const cls = classifyExistingMap(facts.value);
        existingMap = {
          class: cls,
          outcome: cls === 'stamped-complete' ? 'adopt, refresh or full-in-staging (GSD drift pass in staging decides)' : existingMapOutcome(cls, null),
          mapFiles: facts.value.codebaseMapFiles.length,
          userOwnedPaths: userOwnedPaths(facts.value, cls).length,
        };
      } else warnings.push(`${label}: the repository facts could not be read (${JSON.stringify(facts.error).slice(0, 160)})`);

      const activeRecord = options.activeRecordOf(path);
      report.repositories.push({
        id: repository.id,
        stack: repository.stack,
        source: repository.source,
        sourceKind: repository.sourceKind,
        pin: repository.pin,
        path,
        head,
        headIsPin: head === repository.pin,
        expectedPath: activeRecord !== undefined ? 'refresh' : 'onboard',
        ...(activeRecord !== undefined ? { activeRecord } : {}),
        profile: profileOf(repository.id, options.profileChoice ?? 'extended'),
        hasPlanningAtHead: planningFiles > 0,
        planningFiles,
        ...(existingMap !== undefined ? { existingMap } : {}),
        capUsd: options.perRepoCapUsd,
        state,
      });
    } catch (cause) {
      problems.push(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  // The dry run reads and clones; it changes nothing. Digest every checkout again and compare.
  for (const r of report.repositories) {
    const again = captureState(r.path);
    const changed = stateDifferences(r.state, again);
    if (changed.length > 0) problems.push(`${r.id}: ${changed.join(', ')} changed during the dry run`);
  }
  return report;
}

function printDryRun(report: DryRunReport): void {
  out(`AC-14 dry run (plan ${PLAN}); spends nothing, starts no model\n`);
  if (report.list !== undefined) out(`approved list ${report.list.file} sha256 ${report.list.sha256.slice(0, 8)}... approved by ${report.list.approvedBy} at ${report.list.approvedAt}\n`);
  out(`host: Claude Code ${report.host.version} at ${redactHome(report.host.claudeBin)} (installed ${report.host.present ? 'yes' : 'NO'}, verified ${report.host.verified ? 'yes' : 'NO'})\n\n`);
  report.repositories.forEach((r, index) => {
    out(`${index + 1}. ${r.id} (${r.stack})\n`);
    out(`   source ${r.source} (${r.sourceKind}); pin ${r.pin.slice(0, 7)}, HEAD ${r.head.slice(0, 7)} (${r.headIsPin ? 'equal' : 'DIFFERENT'})\n`);
    out(`   path ${redactHome(r.path)}\n`);
    out(`   expected path: ${r.expectedPath}${r.activeRecord !== undefined ? ` (active record v${r.activeRecord.version} in ${r.activeRecord.profile}: ${r.activeRecord.mappingMode}, ${r.activeRecord.completeness}, at ${r.activeRecord.onboardedRevision.replace(/^git:/, '').slice(0, 7)})` : ''}; profile ${r.profile}\n`);
    out(`   existing GSD artifacts: ${r.planningFiles} tracked under .planning; map class ${r.existingMap?.class ?? 'unknown'} (${r.existingMap?.mapFiles ?? 0} map files, ${r.existingMap?.userOwnedPaths ?? 0} kept as the owner's); outcome ${r.existingMap?.outcome ?? 'unknown'}\n`);
    out(`   checkout digest ${r.state.filesDigest.slice(0, 16)}  refs digest ${r.state.refsDigest.slice(0, 16)}  (tracked ${r.state.counts.tracked}, untracked ${r.state.counts.untracked}, status entries ${r.state.counts.statusEntries}, refs ${r.state.counts.refs})\n`);
    out(`   per-repository cap ${r.capUsd.toFixed(2)} USD\n`);
  });
  const s = report.spend;
  out(`\nPhase 4 spend so far ${s.spentUsd.toFixed(4)} USD (${s.ledger}); ceiling ${s.ceilingUsd.toFixed(2)} USD; projected ${s.projectedUsd.toFixed(2)} USD at ${s.perRepoCapUsd.toFixed(2)} per repository; total after ${s.afterProjectionUsd.toFixed(4)} USD: ${s.fits ? 'fits' : 'does NOT fit'}\n`);
  for (const w of report.warnings) out(`warning: ${redactHome(w)}\n`);
  for (const p of report.problems) out(`PROBLEM: ${redactHome(p)}\n`);
  out(`ac14-dry-run: ${report.repositories.length} repositories, ${report.problems.length} problem(s), ${report.warnings.length} warning(s); spent 0 USD\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// The evidence file
// ---------------------------------------------------------------------------------------------------------------

export function readJson(path: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const asObjects = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

// The evidence file with `patch` applied to its top-level keys; every other key is kept as it was read. Home directories are written as `~`.
export function updateEvidence(path: string, patch: (existing: Json) => Json): void {
  const existing = readJson(path) ?? { schema: 1, plan: PLAN, decision: 'D-03, D-04, D-05', entries: [] };
  const next = { ...patch(existing), updatedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${redactHome(JSON.stringify(next, null, 2))}\n`);
}

// The writer refuses an entry that has no before digests or no after digests: an entry that cannot show the checkout unchanged shows nothing.
export function entryRefusal(entry: Record<string, unknown>): string | undefined {
  if (typeof entry['id'] !== 'string' || entry['id'] === '') return 'an entry needs the repository id';
  for (const side of ['before', 'after']) {
    const digests = entry[side];
    if (!isObject(digests)) return `entry ${entry['id']} has no ${side} digests`;
    const missing = STATE_DIGESTS.filter((key) => typeof digests[key] !== 'string' || digests[key] === '');
    if (missing.length > 0) return `entry ${entry['id']} ${side} digests are missing ${missing.join(', ')}`;
  }
  return undefined;
}

export function writeEntry(path: string, entry: Record<string, unknown>): { ok: true } | { ok: false; reason: string } {
  const refusal = entryRefusal(entry);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  updateEvidence(path, (existing) => {
    const entries = asObjects(existing['entries']);
    const index = entries.findIndex((e) => e['id'] === entry['id'] && e['attempt'] === entry['attempt']);
    return { ...existing, entries: index === -1 ? [...entries, entry] : entries.map((e, i) => (i === index ? entry : e)) };
  });
  return { ok: true };
}

// One entry judged against the pass bar of AC-14: active, every before digest equal to its after digest, 0 containment failures; and what ONB-6, ONB-11 and
// ONB-15 ask to be recorded for the entry's path.
export function judgeEntry(entry: Record<string, unknown>): string[] {
  const id = String(entry['id']);
  const problems: string[] = [];
  if (entry['state'] !== 'active') problems.push(`${id}: the onboarding ended ${String(entry['state'])}, not active`);
  const before = isObject(entry['before']) ? entry['before'] : {};
  const after = isObject(entry['after']) ? entry['after'] : {};
  for (const key of STATE_DIGESTS) if (before[key] !== after[key] || typeof before[key] !== 'string') problems.push(`${id}: ${key} differs between before and after`);
  const failures = entry['containmentFailures'];
  if (typeof failures !== 'number') problems.push(`${id}: containmentFailures is not recorded`);
  else if (failures !== 0) problems.push(`${id}: ${failures} containment failure(s)`);
  if (id === PORTFOLIO_ID && entry['expectedPath'] !== 'refresh') problems.push(`${id}: its onboarding was not a refresh of its active record (ONB-11)`);
  if (entry['expectedPath'] === 'refresh') {
    const refresh = entry['refresh'];
    if (!isObject(refresh) || typeof refresh['mode'] !== 'string') problems.push(`${id}: the refresh mode planRefresh chose is not recorded`);
    if (!('knowledgeCacheHits' in entry)) problems.push(`${id}: the knowledge cache hits are not recorded`);
  }
  // The pass bar is an active record WITH the knowledge pass (plan truth; owner ruling 3): an active record whose knowledge index is absent fails.
  if (asObjects(entry['indexesAbsent']).some((a) => a['index'] === 'knowledge')) problems.push(`${id}: the knowledge index is absent from the active record, so it is not active with the knowledge pass`);
  const existing = entry['existingMap'];
  if (isObject(existing) && existing['class'] !== 'none' && typeof existing['outcome'] !== 'string') problems.push(`${id}: the outcome for the existing GSD map is not recorded`);
  return problems;
}

// The latest attempt of each approved repository.
export function latestEntries(evidence: Record<string, unknown>): Json[] {
  const latest = new Map<string, Json>();
  for (const entry of asObjects(evidence['entries'])) {
    const id = String(entry['id']);
    const held = latest.get(id);
    if (held === undefined || Number(entry['attempt'] ?? 0) >= Number(held['attempt'] ?? 0)) latest.set(id, entry);
  }
  return [...latest.values()];
}

export function verifyEvidence(evidence: Record<string, unknown>, list: { repositories: Array<{ id: string; hasCodebaseMap?: boolean }> }): { ok: boolean; problems: string[]; active: number } {
  const problems: string[] = [];
  const latest = latestEntries(evidence);
  const approved = new Set(list.repositories.map((r) => r.id));
  for (const entry of latest) if (!approved.has(String(entry['id']))) problems.push(`${String(entry['id'])}: not on the approved list`);
  let active = 0;
  for (const repository of list.repositories) {
    const entry = latest.find((e) => e['id'] === repository.id);
    if (entry === undefined) {
      problems.push(`${repository.id}: no onboarding is recorded`);
      continue;
    }
    const judged = judgeEntry(entry);
    problems.push(...judged);
    if (entry['state'] === 'active') active += 1;
    if (repository.hasCodebaseMap === true) {
      const existing = entry['existingMap'];
      if (!isObject(existing) || existing['class'] === 'none') problems.push(`${repository.id}: the list says it carries a GSD codebase map, but its entry records none`);
    }
  }
  return { ok: problems.length === 0, problems, active };
}

// ---------------------------------------------------------------------------------------------------------------
// The owner's authorization
// ---------------------------------------------------------------------------------------------------------------

export function authorizeRefusal(io: { stdinTty: boolean; stdoutTty: boolean }): string | undefined {
  return io.stdinTty && io.stdoutTty ? undefined : 'authorize needs an interactive terminal on both stdin and stdout; the owner runs it in their own terminal, never through an agent or a pipe';
}

export interface AuthorizationState {
  listSha256: string;
  spentUsd: number;
  ceilingUsd: number;
  spentByPlanUsd: number;
}

// Whether the recorded authorization still permits one more repository: it was confirmed from a terminal, it names the approved list as it is now, and one more
// per-repository cap fits the group cap the owner gave and the Phase 4 ceiling.
export function authorizationProblems(auth: unknown, state: AuthorizationState): string[] {
  if (!isObject(auth)) return ['no authorization is recorded; the owner runs authorize in their own terminal'];
  const problems: string[] = [];
  if (typeof auth['ownerConfirmedAt'] !== 'string' || !RFC3339.test(auth['ownerConfirmedAt'])) problems.push('the authorization has no ownerConfirmedAt');
  if (auth['terminal'] !== true) problems.push('the authorization was not recorded from an interactive terminal');
  if (auth['listSha256'] !== state.listSha256) problems.push('the authorization names another version of the approved list');
  const perRepo = auth['perRepoCapUsd'];
  const group = auth['groupCapUsd'];
  if (typeof perRepo !== 'number' || !(perRepo > 0) || typeof group !== 'number' || !(group > 0)) return [...problems, 'the authorization names no per-repository cap and group cap'];
  if (state.spentUsd + perRepo > state.ceilingUsd + 1e-9) problems.push(`one more repository at ${perRepo.toFixed(2)} USD would pass the ${state.ceilingUsd.toFixed(2)} USD Phase 4 ceiling (spent ${state.spentUsd.toFixed(4)})`);
  if (state.spentByPlanUsd + perRepo > group + 1e-9) problems.push(`one more repository at ${perRepo.toFixed(2)} USD would pass the owner's ${group.toFixed(2)} USD group cap (spent under ${PLAN} ${state.spentByPlanUsd.toFixed(4)})`);
  return problems;
}

export interface AuthorizeIo {
  stdinTty: boolean;
  stdoutTty: boolean;
  ask: (question: string) => Promise<string>;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export function realAuthorizeIo(): AuthorizeIo {
  return {
    stdinTty: process.stdin.isTTY === true,
    stdoutTty: process.stdout.isTTY === true,
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    now: () => new Date(),
    env: process.env,
  };
}

const money = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export async function authorizeCommand(argv: readonly string[], io: AuthorizeIo): Promise<number> {
  const refusal = authorizeRefusal(io);
  if (refusal !== undefined) {
    errOut(`ac14-authorize: refused: ${refusal}`);
    return 2;
  }
  const { named, bools } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`ac14-authorize: ${text}`);
    return 2;
  };
  const group = money(named['cap']);
  if (group === undefined) return refuse('usage: authorize --cap USD --profile extended|local [--per-repo USD] [--per-invocation USD] [--replace]');
  const choice = named['profile'];
  if (choice !== 'extended' && choice !== 'local') return refuse('--profile must be extended (a dedicated personal-extended benchmark profile) or local (personal-local)');
  const listPath = resolve(named['list'] ?? join(REPO_ROOT, LIST_REL));
  const evidencePath = resolve(named['evidence'] ?? join(REPO_ROOT, EVIDENCE_REL));
  const loaded = loadList(listPath);
  if (!loaded.ok) return refuse(loaded.problems.join('; '));
  const { list } = loaded;
  const count = list.repositories.length;
  const perRepo = money(named['per-repo']) ?? Math.floor((group / count) * 100 + 1e-9) / 100;
  const perInvocation = money(named['per-invocation']) ?? Math.floor((perRepo / 2) * 100 + 1e-9) / 100;
  if (perRepo * count > group + 1e-9) return refuse(`${count} repositories at ${perRepo.toFixed(2)} USD is ${(perRepo * count).toFixed(2)} USD, over the group cap ${group.toFixed(2)} USD`);
  if (perInvocation > perRepo) return refuse('the per-invocation cap cannot exceed the per-repository cap');
  const spent = phase4Spent();
  const ceiling = phase4Ceiling();
  if (spent + group > ceiling + 1e-9) return refuse(`the group cap ${group.toFixed(2)} USD on the ${spent.toFixed(4)} USD already spent would pass the ${ceiling.toFixed(2)} USD Phase 4 ceiling`);
  const evidence = readJson(evidencePath);
  const dry = isObject(evidence?.['dryRun']) ? evidence['dryRun'] : undefined;
  const dryList = isObject(dry?.['list']) ? dry['list'] : undefined;
  if (dry === undefined || dryList?.['sha256'] !== list.sha256) return refuse('no dry run of this approved list is recorded; run `dry-run` first');
  if (Array.isArray(dry['problems']) && dry['problems'].length > 0) return refuse('the recorded dry run lists problems; fix them and run `dry-run` again');
  if (isObject(evidence?.['authorization']) && !bools.has('replace')) return refuse('an authorization is already recorded; pass --replace to record a new one');
  const host = isObject(dry['host']) ? dry['host'] : {};

  const profiles = Object.fromEntries(list.repositories.map((r) => [r.id, profileOf(r.id, choice)]));
  out(`You are about to authorize live spend (D-03). Nothing has run yet.\n`);
  for (const r of asObjects(dry['repositories'])) out(`  ${String(r['id']).padEnd(24)} ${String(r['expectedPath']).padEnd(8)} ${String(profiles[String(r['id'])]).padEnd(18)} ${perRepo.toFixed(2)} USD\n`);
  out(`group cap ${group.toFixed(2)} USD; per repository ${perRepo.toFixed(2)} USD; per invocation ${perInvocation.toFixed(2)} USD; host ${String(host['version'])}\n`);
  out(`Phase 4 spent ${spent.toFixed(4)} USD of ${ceiling.toFixed(2)}; after the group cap ${(spent + group).toFixed(4)} USD\n`);
  const answer = (await io.ask('Type "authorize" to record this authorization, anything else to stop: ')).trim();
  if (answer !== 'authorize') {
    out('not authorized; nothing was recorded\n');
    return 1;
  }
  const record: Json = {
    ownerConfirmedAt: io.now().toISOString(),
    confirmedBy: userInfo().username,
    terminal: true,
    decision: 'D-03, D-05',
    listSha256: list.sha256,
    groupCapUsd: group,
    perRepoCapUsd: perRepo,
    perInvocationCapUsd: perInvocation,
    profileChoice: choice,
    profiles,
    spentAtAuthorizationUsd: round(spent),
    ceilingUsd: ceiling,
    host: { claudeVersion: String(host['version'] ?? HOST_VERSION), claudeBin: String(host['claudeBin'] ?? '') },
  };
  updateEvidence(evidencePath, (existing) => ({ ...existing, authorization: record }));
  out(`recorded in ${relative(REPO_ROOT, evidencePath)}: ownerConfirmedAt ${String(record['ownerConfirmedAt'])}\n`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// One live onboarding
// ---------------------------------------------------------------------------------------------------------------

function maxEventSeq(dataRoot: string): number {
  try {
    return readLedger<{ seq: number | null }>(dataRoot, 'SELECT MAX(seq) AS seq FROM events')[0]?.seq ?? 0;
  } catch {
    return 0;
  }
}

const clip = (text: string, max = 3000): string => (text.length > max ? `${text.slice(0, max)}...` : text);
const parseObject = (text: string | null | undefined): Json => {
  try {
    const value: unknown = JSON.parse(text ?? '{}');
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
};

// The cost of the invocations an onboarding finished: what the budgets charged (`costChargedUsd`, larger than the host's own figure for a killed invocation) where an
// invocation has it, the host-reported `costUsd` otherwise. An invocation with neither is not counted and marks the sum as assumed (WR-31).
export function finishedCosts(finished: readonly Record<string, unknown>[]): { costUsd: number; costAssumed: boolean } {
  let total = 0;
  let known = 0;
  for (const f of finished) {
    const charged = typeof f['costChargedUsd'] === 'number' ? f['costChargedUsd'] : typeof f['costUsd'] === 'number' ? f['costUsd'] : undefined;
    if (charged === undefined) continue;
    known += 1;
    total += charged;
  }
  return { costUsd: round(total), costAssumed: finished.length > 0 && known < finished.length };
}

// What `run-one` records in the Phase 4 spend ledger (WR-31): the per-repository cap whenever the spend cannot be known (the ledger read failed, the profile root was
// unreadable, the process was killed by the timeout, or the host was not confirmed started while the CLI exited non-zero), and the larger of the cap and the reported sum when
// some invocations reported no cost. Never less than the reported sum.
export function runOneSpendUsd(input: { ledgerError: string | undefined; root: string | undefined; runStatus: number | null; hostStarted: boolean; costAssumed: boolean; reportedUsd: number; capUsd: number }): number {
  const unknown = input.ledgerError !== undefined || input.root === undefined || input.runStatus === null || (!input.hostStarted && input.runStatus !== 0);
  if (unknown || input.costAssumed) return Math.max(input.capUsd, input.reportedUsd);
  return input.reportedUsd;
}

// What the owner's ledger holds about the onboarding that ran: the record, the mapping outcome, the indexes, the knowledge pass and the cost.
function ledgerFacts(dataRoot: string, repoPath: string, startedAt: string, seqBefore: number): Json {
  const [onboarding] = readLedger<{ onboarding_id: string; state: string; project_id: string; preflight_json: string }>(
    dataRoot,
    'SELECT onboarding_id, state, project_id, preflight_json FROM onboardings WHERE project_id IN (SELECT project_id FROM projects WHERE repo_path IN (?, ?)) AND created_at >= ? ORDER BY created_at DESC LIMIT 1',
    repoPath,
    realOf(repoPath),
    startedAt,
  );
  const events = readLedger<{ type: string; data_json: string }>(dataRoot, "SELECT type, data_json FROM events WHERE seq > ? AND type IN ('invocation.finished', 'containment.finding')", seqBefore);
  const finished = events.filter((e) => e.type === 'invocation.finished').map((e) => parseObject(e.data_json));
  const findings = events.filter((e) => e.type === 'containment.finding').map((e) => clip(String(parseObject(e.data_json)['reason'] ?? e.data_json), 300));
  const facts: Json = {
    hostStarted: finished.length > 0,
    invocations: finished.length,
    ...finishedCosts(finished),
    containmentFindings: findings,
  };
  if (onboarding === undefined) return { ...facts, state: 'none' };
  const steps = readLedger<{ step: string; attempt: number; status: string; result_json: string }>(dataRoot, 'SELECT step, attempt, status, result_json FROM onboarding_steps WHERE onboarding_id = ? ORDER BY started_at', onboarding.onboarding_id);
  const plan = parseObject(steps.filter((s) => s.step === 'mapping:plan').pop()?.result_json);
  const [record] = readLedger<{ version: number; body_json: string; mapping_mode: string | null; completeness: string | null; onboarded_revision: string }>(
    dataRoot,
    "SELECT version, body_json, mapping_mode, completeness, onboarded_revision FROM project_records WHERE project_id = ? AND state = 'active' ORDER BY version DESC LIMIT 1",
    onboarding.project_id,
  );
  const body = parseObject(record?.body_json);
  const indexes = isObject(body['indexes']) ? body['indexes'] : {};
  const graph = isObject(indexes['graph']) ? indexes['graph'] : undefined;
  const knowledge = isObject(graph?.['knowledge']) ? graph['knowledge'] : undefined;
  const knowledgeRefresh = isObject(knowledge?.['refresh']) ? knowledge['refresh'] : undefined;
  const preflight = parseObject(onboarding.preflight_json);
  const failedStep = steps.filter((s) => s.status !== 'completed').pop();
  return {
    ...facts,
    onboardingId: onboarding.onboarding_id,
    state: onboarding.state,
    record: record === undefined ? null : { version: record.version, mappingMode: record.mapping_mode, completeness: record.completeness, onboardedRevision: record.onboarded_revision, restricted: body['restricted'] === true },
    mapping: { mode: plan['mode'], outcome: plan['outcome'], reason: plan['reason'], requested: plan['requested'], drift: plan['drift'], existingMapAnswer: plan['existingMapAnswer'] },
    refresh: isObject(plan['refresh']) ? plan['refresh'] : null,
    refreshOf: isObject(preflight['refreshOf']) ? preflight['refreshOf'] : null,
    existingState: isObject(preflight['existingState']) ? preflight['existingState'] : null,
    indexesPresent: ['graph', 'intel'].filter((name) => isObject(indexes[name])),
    indexesAbsent: Array.isArray(indexes['absent']) ? indexes['absent'] : [],
    graphNodes: graph?.['nodes'] ?? null,
    knowledge: knowledge ?? null,
    knowledgeRefresh: knowledgeRefresh ?? null,
    knowledgeCacheHits: typeof knowledgeRefresh?.['cacheHits'] === 'number' ? knowledgeRefresh['cacheHits'] : null,
    steps: steps.map((s) => ({ step: s.step, attempt: s.attempt, status: s.status })),
    lastNotCompleted: failedStep === undefined ? null : { step: failedStep.step, attempt: failedStep.attempt, status: failedStep.status, result: clip(failedStep.result_json, 1200) },
  };
}

// An active attempt is not run again, except as the owner ruled (ruling 1 of plan 04-35: "re-run the portfolio to measure the knowledge pass"): with a ruling
// reference, and only when the active attempt left the knowledge index absent, since that is the pass the re-run measures. Undefined means the run may go on.
export function activeRerunRefusal(last: Record<string, unknown>, rulingRef: string | undefined): string | undefined {
  const active = 'already has an active record in this benchmark';
  if (rulingRef === undefined || rulingRef.trim() === '') return active;
  const absent = asObjects(last['indexesAbsent']).some((a) => a['index'] === 'knowledge');
  return absent ? undefined : `${active} and its knowledge pass is present: there is nothing to measure again`;
}

// The stop-loss counts the attempts that stopped. An active attempt is not a stop: a repository that ended active with its knowledge pass absent is run again only
// through `activeRerunRefusal` (a ruling reference naming the owner's ruling), so the owner's authorization of a further attempt (ruling 3 of plan 04-35, the portfolio's
// third) is not blocked by the two attempts it already has, and an active repository with its knowledge present is never run again.
export function stopLossRefusal(prior: readonly Record<string, unknown>[]): string | undefined {
  const stopped = prior.filter((entry) => entry['state'] !== 'active').length;
  return stopped >= STOP_LOSS_ATTEMPTS ? `has stopped ${stopped} times; stop and ask the owner (D-04)` : undefined;
}

export async function runOne(argv: readonly string[]): Promise<number> {
  const { named, positionals } = flags(argv);
  const id = positionals[0];
  const refuse = (text: string, code = 2): number => {
    errOut(`ac14-run-one: ${text}`);
    return code;
  };
  if (id === undefined) return refuse('usage: run-one ID [--ruling-ref TEXT]');
  for (const key of ['AVARICE_DATA_ROOT', 'AVARICE_WORK_ROOT', 'AVARICE_CONFIG_HOME']) {
    if (process.env[key] !== undefined && process.env[key] !== '') return refuse(`${key} is set: the benchmark runs in the owner's own profile roots, so unset it`);
  }
  const listPath = resolve(named['list'] ?? join(REPO_ROOT, LIST_REL));
  const evidencePath = resolve(named['evidence'] ?? join(REPO_ROOT, EVIDENCE_REL));
  const loaded = loadList(listPath);
  if (!loaded.ok) return refuse(loaded.problems.join('; '));
  const repository = loaded.list.repositories.find((r) => r.id === id);
  if (repository === undefined) return refuse(`${id} is not on the approved list; nothing was started`);
  const evidence = readJson(evidencePath) ?? {};
  const auth = evidence['authorization'];
  const problems = authorizationProblems(auth, { listSha256: loaded.list.sha256, spentUsd: phase4Spent(), ceilingUsd: phase4Ceiling(), spentByPlanUsd: spentByPlan(PLAN) });
  if (problems.length > 0) return refuse(`${problems.join('; ')}; nothing was started`, problems.some((p) => /ceiling|group cap/.test(p)) ? 75 : 2);
  const authorization = auth as Json;
  const perRepo = authorization['perRepoCapUsd'] as number;
  const perInvocation = authorization['perInvocationCapUsd'] as number;
  const profile = String((authorization['profiles'] as Json | undefined)?.[id] ?? '');
  if (profile === '') return refuse(`the authorization names no profile for ${id}`);
  const host = (authorization['host'] ?? {}) as Json;
  // The authorization records the host path home-redacted (~/...); the spawn needs the real path.
  const claudeBin = expandHome(String(host['claudeBin'] ?? ''), ownerHome());
  if (claudeBin === '' || !existsSync(claudeBin)) return refuse(`the authorized host ${redactHome(claudeBin)} is not installed`);

  // The stop-loss and D-04: two attempts per epoch at most, and a retry only after the owner has ruled on the stop.
  const prior = asObjects(evidence['entries']).filter((e) => e['id'] === id);
  const last = prior[prior.length - 1];
  const rerun = last !== undefined && last['state'] === 'active' ? activeRerunRefusal(last, named['ruling-ref']) : undefined;
  if (rerun !== undefined) return refuse(`${id} ${rerun}`);
  const stopLoss = stopLossRefusal(prior);
  if (stopLoss !== undefined) return refuse(`${id} ${stopLoss}`, 75);
  if (last !== undefined && named['ruling-ref'] === undefined) return refuse(`${id} stopped on its last attempt; the owner rules on the classification first (D-04), then pass --ruling-ref TEXT naming the ruling`, 75);

  const home = ownerHome();
  const repoPath = pathOf(repository, home, cloneRootOf(home));
  if (!existsSync(repoPath)) return refuse(`${repoPath} does not exist; run dry-run first`);
  const dataRoot = dataRootOf(profile, process.env, home);
  const before = captureState(repoPath);
  const dryRepo = asObjects(isObject(evidence['dryRun']) ? evidence['dryRun']['repositories'] : undefined).find((r) => r['id'] === id);
  const changedSinceDryRun = isObject(dryRepo?.['state']) ? stateDifferences(dryRepo['state'], before) : ['no dry run state'];
  if (repository.sourceKind === 'public-url' && before.head !== repository.pin) return refuse(`${id}: the clone is at ${before.head.slice(0, 7)}, not its pin; nothing was started`);
  const seqBefore = dataRoot === undefined ? 0 : maxEventSeq(dataRoot);
  const startedAt = new Date().toISOString();
  out(`ac14-run-one: ${id} (${profile}), cap ${perRepo.toFixed(2)} USD, host ${String(host['claudeVersion'])}; starting at ${startedAt}\n`);

  const env: NodeJS.ProcessEnv = { ...process.env, AVARICE_CLAUDE_BIN: claudeBin, AVARICE_PHASE4_PLAN: PLAN };
  delete env['AVARICE_LIVE_ADMIT_CLAUDE_VERSION'];
  const args = [
    '--disable-warning=ExperimentalWarning',
    join(REPO_ROOT, 'bin', 'avarice.ts'),
    'onboard',
    '--policy',
    'onboarding',
    '--profile',
    profile,
    '--budget',
    `costUsdPerInvocation=${perInvocation}`,
    '--budget',
    `costUsdPerRun=${perRepo}`,
    repoPath,
  ];
  const ran = spawnSync(process.execPath, args, { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60 * 60_000, maxBuffer: 1 << 26 });
  const after = captureState(repoPath);

  const root = dataRootOf(profile, process.env, home);
  let facts: Json = { state: 'none', hostStarted: false, costUsd: 0, costAssumed: false, containmentFindings: [] };
  let ledgerError: string | undefined;
  try {
    if (root !== undefined) facts = ledgerFacts(root, repoPath, startedAt, seqBefore);
  } catch (cause) {
    ledgerError = cause instanceof Error ? cause.message : String(cause);
  }
  const differences = stateDifferences(before, after);
  const findings = facts['containmentFindings'] as string[];
  const containmentFailures = findings.length + (differences.length > 0 ? 1 : 0);
  // A spend that cannot be known is recorded at the cap, as every live harness of this project does (WR-31).
  const costUsd = runOneSpendUsd({
    ledgerError,
    root,
    runStatus: ran.status,
    hostStarted: facts['hostStarted'] === true,
    costAssumed: facts['costAssumed'] === true,
    reportedUsd: typeof facts['costUsd'] === 'number' ? facts['costUsd'] : 0,
    capUsd: perRepo,
  });
  if (costUsd > 0) recordPhase4Spend({ plan: PLAN, case: `ac14-${id}`, costUsd, claudeVersion: String(host['claudeVersion'] ?? HOST_VERSION) });
  const existingState = isObject(facts['existingState']) ? facts['existingState'] : undefined;
  const dryMap = dryRepo?.['existingMap'];
  const mapping = isObject(facts['mapping']) ? facts['mapping'] : undefined;
  const entry: Json = {
    ...facts,
    id,
    attempt: prior.length + 1,
    ...(named['ruling-ref'] !== undefined ? { rulingRef: named['ruling-ref'] } : {}),
    startedAt,
    finishedAt: new Date().toISOString(),
    profile,
    expectedPath: facts['refreshOf'] !== null && facts['refreshOf'] !== undefined ? 'refresh' : 'onboard',
    exitCode: ran.status,
    capUsd: perRepo,
    costUsd: round(costUsd),
    containmentFailures,
    containmentFindings: findings,
    changedSinceDryRun,
    before,
    after,
    differences,
    existingMap: {
      class: String(existingState?.['class'] ?? (isObject(dryMap) ? dryMap['class'] : 'unknown')),
      outcome: String(mapping?.['outcome'] ?? existingState?.['outcome'] ?? 'unknown'),
    },
    stdoutTail: clip(ran.stdout ?? '', 1500).slice(-1500),
    stderrTail: (ran.stderr ?? '').slice(-1500),
    ...(ledgerError !== undefined ? { ledgerError } : {}),
    classification: { proposed: null, confirmed: null },
  };
  const written = writeEntry(evidencePath, entry);
  if (!written.ok) return refuse(`the evidence entry was refused: ${written.reason}`, 1);
  const judged = judgeEntry(entry);
  out(`ac14-run-one: ${id}: state ${String(entry['state'])}, cost ${costUsd.toFixed(4)} USD, containment failures ${containmentFailures}, digests ${differences.length === 0 ? 'equal' : `CHANGED (${differences.join(', ')})`}; Phase 4 spend now ${phase4Spent().toFixed(4)} USD\n`);
  for (const p of judged) out(`PROBLEM: ${p}\n`);
  if (judged.length > 0) out(`ac14-run-one: halted on ${id}. Record the evidence and propose a D-04 classification with \`classify\`; do not retry until the owner rules.\n`);
  return judged.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// classify, verify, finish, ids
// ---------------------------------------------------------------------------------------------------------------

export function classifyCommand(argv: readonly string[]): number {
  const { named } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`ac14-classify: ${text}`);
    return 2;
  };
  const id = named['id'];
  const cls = named['class'];
  const by = named['by'];
  const summary = named['summary'];
  if (id === undefined || (cls !== 'product-defect' && cls !== 'harness-defect') || (by !== 'claude' && by !== 'owner') || summary === undefined || summary.trim() === '') return refuse('usage: classify --id ID --class product-defect|harness-defect --summary TEXT --by claude|owner [--ref TEXT]');
  if (by === 'owner' && (named['ref'] ?? '').trim() === '') return refuse('the owner ruling needs --ref naming the reply that gave it');
  const path = resolve(named['evidence'] ?? join(REPO_ROOT, EVIDENCE_REL));
  const evidence = readJson(path);
  const entries = asObjects(evidence?.['entries']);
  const index = entries.map((e, i) => (e['id'] === id ? i : -1)).filter((i) => i !== -1).pop();
  if (evidence === undefined || index === undefined) return refuse(`no entry for ${id}`);
  const entry = entries[index] as Json;
  if (entry['state'] === 'active') return refuse(`${id} is active: there is no stop to classify`);
  const held = isObject(entry['classification']) ? entry['classification'] : { proposed: null, confirmed: null };
  if (by === 'owner' && held['proposed'] === null) return refuse('the owner confirms a proposal: there is none yet');
  if (by === 'claude' && held['confirmed'] !== null) return refuse('the owner has already ruled on this stop');
  const record = { class: cls, summary: summary.trim(), by, at: new Date().toISOString(), ...(named['ref'] !== undefined ? { ref: named['ref'] } : {}) };
  updateEvidence(path, (existing) => ({ ...existing, entries: asObjects(existing['entries']).map((e, i) => (i === index ? { ...e, classification: { ...held, [by === 'claude' ? 'proposed' : 'confirmed']: record } } : e)) }));
  out(`classification ${by === 'claude' ? 'proposed' : 'confirmed'} for ${id}: ${cls}\n`);
  return 0;
}

function verifyCommand(argv: readonly string[], closing: boolean): number {
  const { named } = flags(argv);
  const listPath = resolve(named['list'] ?? join(REPO_ROOT, LIST_REL));
  const evidencePath = resolve(named['evidence'] ?? join(REPO_ROOT, EVIDENCE_REL));
  const loaded = loadList(listPath);
  if (!loaded.ok) {
    for (const p of loaded.problems) out(`PROBLEM: ${p}\n`);
    return 1;
  }
  const evidence = readJson(evidencePath);
  if (evidence === undefined) {
    out(`PROBLEM: ${relative(REPO_ROOT, evidencePath)} holds no evidence\n`);
    return 1;
  }
  const verdict = verifyEvidence(evidence, loaded.list);
  const spent = spentByPlan(PLAN);
  const authorization = isObject(evidence['authorization']) ? evidence['authorization'] : undefined;
  const group = authorization?.['groupCapUsd'];
  const problems = [...verdict.problems];
  if (typeof group !== 'number') problems.push('no authorization with a group cap is recorded');
  else if (spent > group + 1e-9) problems.push(`the spend under ${PLAN} ${spent.toFixed(4)} USD passed the owner's ${group.toFixed(2)} USD group cap`);
  if (phase4Spent() > phase4Ceiling() + 1e-9) problems.push('the Phase 4 spend passed the ceiling');
  for (const entry of latestEntries(evidence)) out(`${String(entry['id']).padEnd(24)} ${String(entry['state']).padEnd(10)} ${String(entry['expectedPath'] ?? '?').padEnd(8)} cost ${Number(entry['costUsd'] ?? 0).toFixed(4)}  containment failures ${String(entry['containmentFailures'])}\n`);
  out(`${verdict.active} of ${loaded.list.repositories.length} active; spend under ${PLAN} ${spent.toFixed(4)} USD; Phase 4 total ${phase4Spent().toFixed(4)} USD\n`);
  for (const p of problems) out(`PROBLEM: ${p}\n`);
  if (problems.length === 0 && closing) {
    updateEvidence(evidencePath, (existing) => ({ ...existing, finish: { at: new Date().toISOString(), active: verdict.active, repositories: loaded.list.repositories.length, spendUnderPlanUsd: round(spent), phase4SpentUsd: round(phase4Spent()), containmentFailures: 0, passed: true } }));
    out('finish recorded: AC-14 passed\n');
  }
  return problems.length === 0 ? 0 : 1;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'dry-run') {
    const { named } = flags(rest);
    const home = ownerHome();
    const cap = named['per-repo'] === undefined ? DEFAULT_PER_REPO_CAP_USD : money(named['per-repo']);
    const choice = named['profile'] ?? 'extended';
    if (cap === undefined || (choice !== 'extended' && choice !== 'local')) {
      errOut('usage: dry-run [--per-repo USD] [--profile extended|local] [--list F] [--evidence F]');
      return 2;
    }
    const report = buildDryRun({
      listPath: resolve(named['list'] ?? join(REPO_ROOT, LIST_REL)),
      home,
      cloneRoot: cloneRootOf(home),
      perRepoCapUsd: cap,
      expectedCount: EXPECTED_COUNT,
      profileChoice: choice,
      activeRecordOf: (path) => activeRecordIn(path),
      clone: cloneRepository,
    });
    printDryRun(report);
    const evidencePath = resolve(named['evidence'] ?? join(REPO_ROOT, EVIDENCE_REL));
    updateEvidence(evidencePath, (existing) => ({ ...existing, ...(report.list !== undefined ? { list: report.list } : {}), dryRun: report }));
    out(`evidence ${relative(REPO_ROOT, evidencePath)}\n`);
    return report.problems.length === 0 ? 0 : 1;
  }
  if (command === 'authorize') return authorizeCommand(rest, realAuthorizeIo());
  if (command === 'run-one') return runOne(rest);
  if (command === 'classify') return classifyCommand(rest);
  if (command === 'verify') return verifyCommand(rest, false);
  if (command === 'finish') return verifyCommand(rest, true);
  if (command === 'ids') {
    const loaded = loadList(resolve(flags(rest).named['list'] ?? join(REPO_ROOT, LIST_REL)));
    if (!loaded.ok) {
      errOut(loaded.problems.join('; '));
      return 1;
    }
    out(`${loaded.list.repositories.map((r) => r.id).join('\n')}\n`);
    return 0;
  }
  errOut('usage: exit-run-phase4-tools.ts (dry-run | authorize | run-one | classify | verify | finish | ids) ...');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
