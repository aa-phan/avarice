// Helpers of scripts/exit-run-phase3.sh (plan 03-28; D-01 to D-05, D-12). Nothing here starts a model, installs anything or writes to the
// owner's portfolio: it is read through git objects (`git show`, `git ls-tree`, `git rev-list`) and its checkout is digested before and after.
//
//   dry-run --source REPO --config F --brief F [--brief F ...] --out F [--pin SHA]
//       Proves the three exit briefs against the portfolio at the pin without a scratch clone, an install or a host: the preflight (the
//       conventions committed in the portfolio, read from git objects, equal the draft; the staleness rules), every brief parsed and compiled
//       with the real parser and compiler against the COMMITTED conventions (G0, the write set inside the conventions, every criterion in one
//       item), the planted decision criterion and the independent item of each brief, the Phase 3 spend so far, the headroom to the ceiling,
//       and the largest per-run cap that fits one run per brief. Writes the evidence JSON to --out; exit 0 only when it lists no problem.
//   preflight --repo REPO --config F [--pin SHA]
//       Read-only: `conventions: ok|FAIL` and `staleness: ok|FAIL` lines exactly as the Phase 2 tools print them; exit 1 on a FAIL.
//
// Plan 03-41 adds, for the repeated exit: the plan the spend and evidence are recorded under comes from AVARICE_PHASE3_PLAN (default 03-29), the evidence
// names the authorization file it was given as the pin's source, a rewrite keeps the evidence file's extra top-level keys (a `supersedes` block), `authorize`
// refuses while the run the evidence supersedes is not failed, cancelled or closed in the owner's ledger, and the dry run counts, per item, the options of
// another item found in its prompt Behavior (`promptScope`; above 0 is a problem).
//
// Plan 03-49 adds `brief-check --source REPO --brief F [--brief F ...] --out F [--pin SHA]` (the write-set check of each brief at the pin) and `relax`.
//
// Plan 03-52 adds the D-31 gate and D-28's fresh-approval rule (read-only subcommands; nothing starts a model):
//   brief-check --all ...
//       The same report with the check uncapped (every finding, `truncated` empty, `uncapped: true`, each brief's protected globs): what a classification file starts from.
//   brief-gate --classification F [--source REPO] [--pin SHA]
//       Runs the write-set check again at the pin, uncapped, and judges the reviewed classification file against it: exit 0 only when every fresh finding of every brief
//       is classified `kept` or `changed` at its own path and line and no `changed` finding is in a protected file or outside the conventions' write set (D-31). Exit 1
//       with one `brief-gate: FAIL` line per problem.
//   write-authorization --classification F --brief B --run R --expects E ... --cap USD --ceiling USD --claude-bin P --claude-version V --decision-ref TEXT
//                       --owner-confirmed-at ISO --out F [--source REPO] [--pin SHA]
//       Writes the owner's fresh approval (D-28) only when that gate passes, the cap is at most 4.50 USD (D-33) and the ceiling at most 25 USD (D-05); otherwise exit 2.
//   From then on only such an approval authorizes a start: `field`, `authorize` and `evidence` refuse every other selection and every authorization without
//   `exitRules: D-26..D-35` (the files of plans 03-28 to 03-49 authorize nothing; they stay on disk as history). `authorize` runs the gate again for the brief it starts.
//   The `relax` subcommand and the relaxed finish judge stay for the history of plan 03-49, but `relax` refuses an evidence file marked `exitRules: D-26..D-35` and the
//   evidence stage judges a relax record in an entry as a problem.
//
// Plan 03-53 adds the bookkeeping of D-26, D-27, D-29 and D-33. An exit run is identified in the evidence by its ROLE (`run1`, `run2`, `run3`, from the authorization's
// `briefs[].run`) and an ATTEMPT number, not by its brief digest: the start stage writes `run`, `attempt` (1 plus the earlier entries of the role) and `expects` into
// each entry, so a redrafted brief (a new digest) continues the same run's count.
//   classify --evidence F --run-id R --propose --class product-defect|brief-harness-defect --stopped-by TEXT --at PATH:LINE [--at ...] --docs-system conformant|nonconformant
//            --docs-ref docs/system/X --summary TEXT --by claude
//   classify --evidence F --run-id R --confirm --by owner --ref TEXT [--class C]
//       Claude's classification of a stopped attempt (D-26) and the owner's ruling on it (D-27, written only from the owner's own checkpoint reply), each into the
//       one entry as `classification.proposed` and `classification.confirmed`. Exit 2 and the file untouched on a passed entry, an unknown run, a malformed field,
//       a wrong `--by`, a confirmation with no proposal, or an entry the owner already ruled on.
//   startRefusal (inside `authorize`) refuses a start, starting nothing, when: the run already passed in the current epoch; a run earlier in the authorization's order
//       (D-33: 2, 3, 1) has no recorded outcome, a pass or the owner's confirmed classification; an earlier attempt of the run has no owner-confirmed classification;
//       or an earlier attempt's live run is not failed, cancelled or closed in the owner's ledger (D-34, read-only). A confirmed product defect starts a new EPOCH at its
//       confirmation: an attempt started before it no longer counts as a pass or toward the order, so all three runs must pass again (D-26). The stop-loss (D-29) is
//       exit 75 for a run with two failed attempts within its current stop-loss epoch, whatever their classification. That epoch begins at the run's latest owner-confirmed
//       reset (below), or at the run's first attempt when there is none (D-36 to D-39).
//
// Plan 03-66 adds the reset that begins a new stop-loss epoch for one run (D-36 to D-39), into the evidence file's top-level `resets` list:
//   reset --propose --by claude --evidence F --authorization-file A --run R --parity P [--pin SHA] --defect RUN_ID --test PATH --red FILE --green FILE [...] --summary TEXT
//   reset --confirm --by owner --evidence F --run R --ref TEXT
//       Three proofs (D-37): (1) one red-to-green scenario per owner-confirmed product-defect attempt the reset covers, a tracked test under test/ with a red and a green evidence
//       file (command, exitCode, output); (2) a parity report written by `parity` (03-65) at the pin, with parity true, no problem and no mismatch, checked after every covered ruling and
//       covering the run's brief; (3) the owner's confirmation. `--propose` checks the first two and records every proof file with its sha256 (exit 2, the file untouched, on any
//       failure, on a latest failed attempt that is not an owner-confirmed product defect, and on a red proof an earlier confirmed reset already cites). `--confirm` re-hashes the
//       proof files and writes the `confirmed` record: only the owner's own checkpoint reply writes it, and a proposal alone lifts nothing. A reset changes neither `epochOf` nor the
//       verdict (D-26), and the D-05 guard and the 25 USD ceiling still apply after it (D-38).
//
// Plan 03-54 teaches the evidence stage what each run expects, and adds run 3's silence step. The authorization's `expects` (copied into each entry by the start stage)
// decides how the finish judges an amendment: only `amend-stale` (run 2) is amended, once, to contract version 2 by the owner with a reason and a files.write diff, with the
// original pause decision stale (its answer kept) and its successor the one answered decision; any other expectation with a contract above version 1 is a problem, and a
// relax record is never accepted (D-28). At both stages the run's status must list, as not run, exactly the checks its own contract does not run (D-35); the expected list is
// recorded as `checksNotRunExpected`.
//   silence --run-id R --authorization-file F --out EVIDENCE [--wait-max-minutes N]
//       Run 3: waits (3 s polls, at most 10 minutes) until the run's blocking banner rows are final and the batch window plus 15 s has passed since the block, runs
//       `avarice digest` once, and writes a `silence` block into the entry: the rows, whether the decision is open with null answer columns, the inbox's notification state,
//       the status state and the problems judgeSilence finds. Exit 0 only with none. It reads the owner's ledger read-only and answers, amends, resumes and cancels nothing:
//       a failed banner, a failed digest and the passing of time are no answer (AUT-4). Exit 2, writing nothing, for an entry that is not run 3's or has no start-stage record.
//   verdict --evidence F --authorization-file A
//       Writes `verdict`, `verdictRuns` (role, runId, attempt), `correctStops` and `verdictAt` as top-level keys, keeping every other key. `exit: 3/3 ready_for_review` only
//       when every run of the authorization's order has a passed entry in the current epoch that meets its role's expectation (run 2 ended on contract version 2 with a
//       stale decision; run 3 recorded a silence block with no problem) with equal checkout digests and only its own run branch added; otherwise `exit: <n>/3 ready_for_review`
//       and exit 1. A correct stop (an owner-confirmed brief/harness defect that Claude's proposal found docs/system conformant) is listed as evidence and never counts (D-28).
//   supplement --evidence F --from OTHER --run-id R --note TEXT
//       Copies a superseded run's facts from OTHER into F's top-level `supplementary` list, marked `countsToward3of3: false` (D-34). Exit 2, the file byte-identical, for a run
//       that is an entry of F, a run OTHER does not hold, a second supplement of the same run, an empty note or a file that is not an evidence file.
//
// Plan 03-65 adds the pre-spend parity guard (scripts/exit-parity.ts; it starts no model host, installs nothing and never writes to the owner's checkout):
//   parity --source REPO --config F --brief B [--brief B ...] --out F [--pin SHA] [--node-modules-from DIR] [--gsd-core-bin DIR] [--with-pre-fix]
//          [--anchor-evidence F --anchor-run-id R] [--keep]
//       Runs every required and target check the unit is told to run, in fresh temporary clones of the pin, once exactly as the unit would run it (the contract's listed command,
//       judged by the real hook, under the host's environment) and once as the supervisor runs it, and writes a JSON report whose `parity` is true only when every check is listed,
//       admitted by the hook and gives the same status in both forms. Exit 0 then, 1 on a mismatch or a problem, 2 (nothing written) on a refused input.
//
// Plan 03-29 adds the subcommands of the live exit (they never start a model; `avarice start` and the owner's `avarice decide` do):
//   field --authorization-file F --pick NAME
//       Prints one scalar of the owner's authorization (host.claudeBin, perRunCapUsd, ceilingUsd).
//   authorize --authorization-file F --brief B --repo REPO --config F --evidence F [--pin SHA]
//       Before a start: the owner's approval names this brief (parseBrief digest), the host is the pinned one and admitted, the D-31 gate passes, startRefusal
//       (plan 03-53, below) admits another attempt of the brief's run, the preflight is ok and the Phase 3 guard (D-05) says the recorded spend plus the per-run
//       cap fits the lower of the ceiling and the authorization's. Exit 0 ok, 75 when it would pass the ceiling or when the run has failed twice ("stop and ask
//       the owner"), 2 otherwise.
//   snapshot --repo REPO
//       The Phase 2 checkout snapshot (digest, index digest, symbolic HEAD, every ref) of the owner's checkout, read-only.
//   evidence --stage start|finish --run-id ID --brief B --repo REPO --out F ...
//       Reads the run from the owner's profile (read-only), appends the spend since the last record to the Phase 3 ledger under plan 03-29, and
//       writes the run's record into the exit evidence JSON. Stage `start` expects a stop on a pause-origin decision with the independent items
//       done; stage `finish` waits for the next stop state after the owner's answer and expects ready_for_review with the resumed session.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { phase3Ceiling, phase3LedgerPath, phase3Spent } from '../test/helpers/live-harness.ts';
import { checksNotRun } from '../src/app/checks.ts';
import { getInbox, getRunStatuses } from '../src/app/run-status.ts';
import { readProfileNotify } from '../src/adapters/fs/profile-config.ts';
import { NOTIFY_DEFAULTS } from '../src/domain/notify-policy.ts';
import { createDeps } from '../src/cli/composition.ts';
import { HOST_CONFIG_DIR_STEP } from '../src/cli/host-config-dir.ts';
import { isRunStopState, isRunTerminal } from '../src/domain/run-lifecycle.ts';
import type { RunState } from '../src/domain/run-lifecycle.ts';
import { itemBehavior, itemChoiceOptions, normalizeOption } from '../src/domain/item-scope.ts';
import type { ScopeContract } from '../src/domain/item-scope.ts';
import type { AppDeps } from '../src/app/deps.ts';
import type { Result } from '../src/domain/result.ts';
import type { RunRow } from '../src/ports/ledger.ts';
import { GitRunSource } from '../src/adapters/git/run-source.ts';
import { ADMITTED_CLAUDE_VERSIONS } from '../src/adapters/host-claude/launch-preflight.ts';
import { parseBrief } from '../src/domain/brief.ts';
import type { Brief } from '../src/domain/brief.ts';
import { parseConventions } from '../src/domain/conventions.ts';
import type { Conventions } from '../src/domain/conventions.ts';
import { matchesAny } from '../src/domain/glob.ts';
import { compileRunContract } from '../src/domain/run-contract.ts';
import type { RunContract } from '../src/domain/run-contract.ts';
import { parityCommand } from './exit-parity.ts';
import { compositeOf, preflight, snapshot } from './exit-run-phase2-tools.ts';

type Json = Record<string, unknown>;
const DEFAULT_PIN = '9f1cd8d';
const REPO_ROOT = resolve(import.meta.dirname, '..');
const PLAN = '03-28';

// The rules of the repeated exit (plan 03-52): an authorization names them, and only an authorization that does is a fresh approval (D-28). The per-run cap
// (D-33) and the ceiling (D-05) an authorization may name are at most these.
export const EXIT_RULES = 'D-26..D-35';
export const EXIT_RUN_CAP_USD = 4.5;
export const EXIT_CEILING_USD = 25;

const out = (text: string): void => void process.stdout.write(text);
const errOut = (text: string): void => void process.stderr.write(`${text}\n`);

// `named` holds the last value of each valued flag, `many` every value in order, and `bools` every flag that no value follows (plan 03-52: `brief-check --all`).
export function flags(argv: readonly string[]): { named: Record<string, string>; many: Record<string, string[]>; bools: Set<string> } {
  const named: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (!word.startsWith('--')) continue;
    const key = word.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      named[key] = next;
      (many[key] ??= []).push(next);
      i += 1;
    } else bools.add(key);
  }
  return { named, many, bools };
}

function describeError(error: { kind: string } & Record<string, unknown>): string {
  return `${error.kind}${typeof error['cause'] === 'string' ? `: ${error['cause']}` : typeof error['reason'] === 'string' ? `: ${error['reason']}` : ''}`;
}

// Read-only git. `--no-optional-locks` keeps `status` from refreshing the owner's index.
function readGit(repo: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    maxBuffer: 1 << 26,
  });
  return { status: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' };
}

function mustRead(repo: string, args: readonly string[]): string {
  const ran = readGit(repo, args);
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr.trim()}`);
  return ran.stdout;
}

// What "the owner's portfolio did not change" compares: HEAD, `git status`, every ref with its object, and the checkout digest of the
// Phase 2 snapshot (tracked and untracked file bytes, index entries, symbolic HEAD).
interface PortfolioState {
  head: string;
  status: string;
  refs: string;
  composite: string;
}

function portfolioState(repo: string): PortfolioState {
  const snap = snapshot(repo);
  return {
    head: mustRead(repo, ['rev-parse', 'HEAD']).trim(),
    status: mustRead(repo, ['status', '--porcelain=v2', '--untracked-files=all']),
    refs: mustRead(repo, ['for-each-ref', '--format=%(refname) %(objectname)']),
    composite: String(snap['composite']),
  };
}

const sameState = (a: PortfolioState, b: PortfolioState): boolean => a.head === b.head && a.status === b.status && a.refs === b.refs && a.composite === b.composite;
const summaryOf = (s: PortfolioState): Json => ({ head: s.head, composite: s.composite, refCount: s.refs.split('\n').filter((l) => l !== '').length, statusEntries: s.status.split('\n').filter((l) => l !== '').length });

// ---------------------------------------------------------------------------------------------------------------
// dry-run
// ---------------------------------------------------------------------------------------------------------------

interface ItemReport {
  id: string;
  title: string;
  size: string;
  model: string;
  modelSource: string;
  dependsOn: string[];
  acceptance: string[];
  files: string[];
  role: 'planted' | 'independent' | 'dependent' | 'other';
}

interface BriefReport {
  path: string;
  title: string;
  digest?: string;
  compiled: boolean;
  problem?: string;
  expectedDecisions?: number;
  decisionKeys?: string[];
  items?: ItemReport[];
  write?: string[];
  targetChecks?: string[];
  acceptance?: Array<{ id: string; item: string; verifiedBy: string[] }>;
  budgets?: Json;
  budgetsAtFittingCap?: Json;
  promptScope?: Record<string, { otherItemOptions: number }>;
  // Plan 03-49: the files outside the brief's Write list that hold something the brief changes or removes.
  writeSet?: { needles: WriteSetNeedle[]; findings: WriteSetFinding[]; lines: string[]; truncated: Record<string, number> };
}

function budgetsOf(c: RunContract): Json {
  return { wallClockMinutes: c.budgets.wallClockMinutes, invocations: c.budgets.invocations, toolCalls: c.budgets.toolCalls, costUsdPerInvocation: c.budgets.costUsd.perInvocation, costUsdPerRun: c.budgets.costUsd.perRun, adjustments: c.budgets.adjustments };
}

function dependsOnPath(items: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>, from: string, target: string, seen: Set<string> = new Set()): boolean {
  for (const dep of items.find((i) => i.id === from)?.dependsOn ?? []) {
    if (dep === target) return true;
    if (!seen.has(dep)) {
      seen.add(dep);
      if (dependsOnPath(items, dep, target, seen)) return true;
    }
  }
  return false;
}

// The host the exit would launch, read WITHOUT running any binary: the dry run launches no host, and `--version` is the host's own business at
// the launch preflight. Names under the versions directory are the versions the way `pick-claude` reads them.
function hostSelection(): Json {
  const home = homedir();
  const onPath: string[] = [];
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir !== '' && existsSync(join(dir, 'claude'))) onPath.push(join(dir, 'claude'));
  }
  const versionsDir = join(home, '.local', 'share', 'claude', 'versions');
  const names = existsSync(versionsDir) ? readdirSync(versionsDir).sort() : [];
  return {
    executed: false,
    admittedVersions: [...ADMITTED_CLAUDE_VERSIONS],
    claudeOnPath: onPath.map((p) => p.replace(home, '~')),
    versionsDirectory: versionsDir.replace(home, '~'),
    installedVersionNames: names,
    installedAndAdmittedByName: names.filter((n) => ADMITTED_CLAUDE_VERSIONS.includes(n)),
    installedButNotAdmittedByName: names.filter((n) => !ADMITTED_CLAUDE_VERSIONS.includes(n)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The write-set check of a brief (plan 03-49): the defect that stopped exit run 1. Item C removed COPY_FALLBACK, whose value is the sentence a protected e2e spec
// asserts; the spec was outside the Write list, so a correct unit could not satisfy its criterion inside the contract and parked on a second decision.
// The check reads the brief's Behavior for the code names it puts in backticks (and the strings it quotes), reads the string value each name holds in the source at
// the pin, and lists every tracked file outside the Write list that holds a name or a value. A finding is a problem when the file is protected or outside the
// conventions' write set (the run could never be given it); otherwise it is a warning. Git objects only: nothing in the working tree or the index is read or written.
// ---------------------------------------------------------------------------------------------------------------

export interface WriteSetNeedle {
  name: string;
  kind: 'identifier' | 'literal';
  // The string the identifier holds at the pin (searched as a literal when it is long enough to mean something), or undefined.
  value?: string;
  definedAt?: string;
}

export interface WriteSetFinding {
  path: string;
  line: number;
  needle: string;
  kind: 'identifier' | 'value' | 'literal';
  text: string;
  protected: boolean;
  insideConventions: boolean;
  problem: boolean;
}

export interface WriteSetInput {
  behavior: string;
  writeGlobs: readonly string[];
  itemFiles: readonly string[];
  protectedGlobs: readonly string[];
  conventionsWrite: readonly string[];
}

const MIN_VALUE_CHARS = 8;
const MAX_FINDINGS_PER_NEEDLE = 25;
// Prose and planning files are not read by any check, so a name in them breaks nothing.
const NOT_CODE = /(^\.planning\/)|(\.mdx?$)|(^|\/)package-lock\.json$|\.lock$/;
const CAMEL_OR_PASCAL = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z_$][A-Za-z0-9_$]*$/;
const SCREAMING = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

const isCodeName = (name: string): boolean => name.length >= 4 && (CAMEL_OR_PASCAL.test(name) || SCREAMING.test(name) || KEBAB.test(name));

// The names the Behavior puts in backticks (a call or a signature is read as its leading name) and the strings it quotes with double quotes.
export function behaviorNeedles(behavior: string): WriteSetNeedle[] {
  const needles: WriteSetNeedle[] = [];
  const seen = new Set<string>();
  const add = (needle: WriteSetNeedle): void => {
    const key = `${needle.kind}:${needle.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    needles.push(needle);
  };
  for (const match of behavior.matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] as string).trim();
    const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(token);
    const name = call !== null ? (call[1] as string) : /^[A-Za-z_$][\w$-]*$/.test(token) ? token : undefined;
    if (name !== undefined && isCodeName(name)) add({ name, kind: 'identifier' });
  }
  for (const match of behavior.matchAll(/"([^"\n]{6,80})"/g)) add({ name: match[1] as string, kind: 'literal' });
  return needles;
}

interface GrepHit {
  path: string;
  line: number;
  text: string;
}

// `git grep` over the objects of one revision: fixed string, binary files skipped. No hit is not an error (exit 1).
function grepObjects(repo: string, rev: string, needle: string, word: boolean): GrepHit[] {
  const ran = readGit(repo, ['grep', '-n', '-I', '-F', ...(word ? ['-w'] : []), '-e', needle, rev, '--']);
  if (ran.status !== 0 && ran.status !== 1) throw new Error(`git grep failed: ${ran.stderr.trim()}`);
  const prefix = `${rev}:`;
  const hits: GrepHit[] = [];
  for (const line of ran.stdout.split('\n')) {
    if (!line.startsWith(prefix)) continue;
    const parsed = /^(.+?):(\d+):(.*)$/.exec(line.slice(prefix.length));
    if (parsed !== null) hits.push({ path: parsed[1] as string, line: Number(parsed[2]), text: (parsed[3] as string).trim().slice(0, 200) });
  }
  return hits;
}

// The string an identifier is assigned in one line of source (`export const NAME = '...'`), or undefined.
function stringValueOf(name: string, text: string): string | undefined {
  const escaped = name.replace(/[$]/g, '\\$&');
  return new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b[^=]*=\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(text)?.[2];
}

// `options.limitPerNeedle` replaces the cap of 25 findings per needle; `Infinity` lists every finding and leaves `truncated` empty (plan 03-52: the classification
// of D-31 is complete only against an uncapped check).
export function writeSetCheck(repo: string, rev: string, input: WriteSetInput, options: { limitPerNeedle?: number } = {}): { needles: WriteSetNeedle[]; findings: WriteSetFinding[]; lines: string[]; truncated: Record<string, number> } {
  const limit = options.limitPerNeedle ?? MAX_FINDINGS_PER_NEEDLE;
  const needles = behaviorNeedles(input.behavior);
  const findings: WriteSetFinding[] = [];
  const truncated: Record<string, number> = {};
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const own = new Set(input.itemFiles);
  const report = (hit: GrepHit, needle: string, kind: WriteSetFinding['kind']): void => {
    if (matchesAny(hit.path, input.writeGlobs) || own.has(hit.path) || NOT_CODE.test(hit.path)) return;
    const key = `${hit.path}:${hit.line}:${needle}`;
    if (seen.has(key)) return;
    seen.add(key);
    const n = (counts.get(needle) ?? 0) + 1;
    counts.set(needle, n);
    if (n > limit) {
      truncated[needle] = n - limit;
      return;
    }
    const isProtected = matchesAny(hit.path, input.protectedGlobs);
    const inside = matchesAny(hit.path, input.conventionsWrite);
    findings.push({ path: hit.path, line: hit.line, needle, kind, text: hit.text, protected: isProtected, insideConventions: inside, problem: isProtected || !inside });
  };
  for (const needle of needles) {
    if (needle.kind === 'literal') {
      for (const hit of grepObjects(repo, rev, needle.name, false)) report(hit, needle.name, 'literal');
      continue;
    }
    for (const hit of grepObjects(repo, rev, needle.name, true)) {
      const value = needle.value === undefined ? stringValueOf(needle.name, hit.text) : undefined;
      if (value !== undefined) {
        needle.definedAt = `${hit.path}:${hit.line}`;
        if (value.length >= MIN_VALUE_CHARS) needle.value = value;
      }
      report(hit, needle.name, 'identifier');
    }
    if (needle.value !== undefined) for (const hit of grepObjects(repo, rev, needle.value, false)) report(hit, needle.name, 'value');
  }
  const lines = findings.map((f) => {
    const what = f.kind === 'identifier' ? f.needle : f.kind === 'value' ? `${f.needle}'s value "${needles.find((n) => n.name === f.needle)?.value ?? ''}"` : `"${f.needle}"`;
    return `${f.path}:${f.line} holds ${what} (writable: no, protected: ${f.protected ? 'yes' : 'no'})`;
  });
  return { needles, findings, lines, truncated };
}

function dryRun(argv: readonly string[]): number {
  const { named, many } = flags(argv);
  const source = resolve(named['source'] ?? join(homedir(), 'aa-phan-portfolio-v2'));
  const configPath = resolve(named['config'] ?? '');
  const briefPaths = (many['brief'] ?? []).map((p) => resolve(p));
  const outPath = named['out'];
  const pinRef = named['pin'] ?? DEFAULT_PIN;
  if (!existsSync(configPath) || briefPaths.length === 0 || outPath === undefined) {
    errOut('usage: dry-run --source REPO --config F --brief F [--brief F ...] --out F [--pin SHA]');
    return 2;
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  const startedAt = Date.now();
  // The record names the plan whose dry run it is: the `NN-NN-` prefix of the file it is written to (03-41-dry-run.json), else the first one's.
  const recordPlan = /^(\d{2}-\d{2})-/.exec(basename(outPath))?.[1] ?? PLAN;
  const report: Json = { schema: 1, plan: recordPlan, startedAt: new Date(startedAt).toISOString(), source: source.replace(homedir(), '~'), pin: pinRef, node: process.version, spentUsd: 0, installs: false, modelHostLaunched: false, readOnly: true };

  const before = portfolioState(source);
  try {
    // 1. the preflight, on the portfolio itself (read-only: git objects only).
    const pre = preflight(source, configPath, pinRef, Date.now());
    report['preflight'] = pre.lines;
    for (const line of pre.lines) out(`${line}\n`);
    if (!pre.ok) problems.push(`the preflight failed: ${pre.lines.filter((l) => l.includes('FAIL')).join(' / ')}`);

    const pin = mustRead(source, ['rev-parse', '--verify', `${pinRef}^{commit}`]).trim();
    report['pinSha'] = pin;
    const gitSource = new GitRunSource();
    const head = gitSource.head(source);
    if (!head.ok) throw new Error(`cannot read the HEAD of ${source}: ${describeError(head.error)}`);
    const found = gitSource.conventionsAt(source, pin, head.value);
    if (!found.ok) throw new Error(`no committed conventions: ${describeError(found.error)}`);
    const committed = parseConventions(found.value.text);
    if (!committed.ok) throw new Error(`the committed conventions do not parse: ${describeError(committed.error)}`);
    const conventions: Conventions = committed.value;
    report['conventionsRevision'] = found.value.revision;
    report['conventionsRead'] = 'git objects of the portfolio (the revision that holds .avarice/config.json), not the working tree';

    // The files of the pin's tree: the index facts a real start hands the compiler for item derivation.
    const files = mustRead(source, ['ls-tree', '-r', '--name-only', pin]).split('\n').filter((l) => l !== '');
    const facts = { files, symbolsByFile: {} };

    // 2. the spend arithmetic, before the briefs so the compile at the fitting cap can use it.
    const runs = briefPaths.length;
    const spent = phase3Spent();
    const ceiling = phase3Ceiling();
    const headroom = ceiling - spent;
    const fitExact = headroom / runs;
    const fitCap = Math.floor(fitExact * 100 + 1e-9) / 100;
    const fullCap = 10;
    const spend = {
      ledger: relative(REPO_ROOT, phase3LedgerPath()),
      spentUsd: Number(spent.toFixed(4)),
      ceilingUsd: ceiling,
      headroomUsd: Number(headroom.toFixed(4)),
      runs,
      routineCapUsdPerRun: fullCap,
      fullCapsTotalUsd: fullCap * runs,
      fullCapsFit: spent + fullCap * runs <= ceiling + 1e-9,
      largestPerRunCapThatFitsExactUsd: Number(fitExact.toFixed(6)),
      largestPerRunCapThatFitsUsd: fitCap,
      totalAtThatCapUsd: Number((fitCap * runs).toFixed(4)),
      flag: `--budget costUsdPerRun=${fitCap}`,
      // The sequential guard (a run starts only when the recorded spend plus its cap fits): at the full cap, run n starts only if the spend before it is at most this.
      fullCapGuard: { eachRunStartsOnlyIfSpendBeforeItIsAtMostUsd: Number((ceiling - fullCap).toFixed(4)), runsOneAndTwoMayCostAtMostInTotalUsd: Number((ceiling - fullCap - spent).toFixed(4)) },
    };
    report['spend'] = spend;
    if (!(headroom > 0) || fitCap < 2) warnings.push(`the fitting per-run cap ${fitCap} USD is below the 2.00 USD per-invocation cap: one invocation could end a run`);
    if (!spend.fullCapsFit) warnings.push(`three routine caps of ${fullCap.toFixed(2)} USD (${(fullCap * runs).toFixed(2)}) do not fit the headroom ${headroom.toFixed(4)} USD: the owner chooses a lower cap or a decision about the ceiling`);

    // 3. every brief: parse, compile with the committed conventions, planted decision and independent item.
    const briefReports: BriefReport[] = [];
    let n = 0;
    for (const path of briefPaths) {
      n += 1;
      const text = readFileSync(path, 'utf8');
      const rel = relative(REPO_ROOT, path);
      const parsed = parseBrief(text, { kind: 'file', id: path.split('/').pop() as string });
      const entry: BriefReport = { path: rel, title: parsed.ok ? parsed.value.title : '(does not parse)', compiled: false };
      briefReports.push(entry);
      if (!parsed.ok) {
        entry.problem = `does not parse: ${describeError(parsed.error)}`;
        problems.push(`${rel}: ${entry.problem}`);
        continue;
      }
      const brief: Brief = parsed.value;
      entry.digest = brief.digest;
      const common = { projectId: 'portfolio', baseRevision: pin, conventionsRevision: found.value.revision, brief, conventions, nowIso: new Date().toISOString(), policy: 'routine', indexFacts: facts };
      const compiled = compileRunContract({ ...common, runId: `run_Phase3DryRun${n}` });
      if (!compiled.ok) {
        const e = compiled.error as unknown as { kind: string; field?: string; reason?: string };
        entry.problem = `${e.kind}${e.field !== undefined ? ` ${e.field}` : ''}${e.reason !== undefined ? `: ${e.reason}` : ''}`;
        problems.push(`${rel}: does not compile against the committed conventions: ${entry.problem}`);
        continue;
      }
      const lowered = compileRunContract({ ...common, runId: `run_Phase3DryRunCap${n}`, budgetOverrides: { costUsdPerRun: fitCap } });
      if (!lowered.ok) problems.push(`${rel}: does not compile with --budget costUsdPerRun=${fitCap}: ${JSON.stringify(lowered.error)}`);
      const c = compiled.value.contract;
      entry.compiled = true;
      entry.expectedDecisions = c.intent.expectedDecisions ?? 0;
      entry.write = c.files.write;
      entry.targetChecks = c.verification.targetChecks;
      entry.budgets = budgetsOf(c);
      if (lowered.ok) entry.budgetsAtFittingCap = budgetsOf(lowered.value.contract);

      const decisionRefs = c.intent.acceptance.flatMap((a) => a.verifiedBy.filter((r) => r.startsWith('decision:')).map((r) => ({ criterion: a.id, key: r.slice('decision:'.length) })));
      entry.decisionKeys = decisionRefs.map((d) => d.key);
      const items = c.intent.workItems;
      const planted = items.find((i) => decisionRefs.some((d) => i.acceptance.includes(d.criterion)));
      entry.acceptance = c.intent.acceptance.map((a) => ({ id: a.id, item: items.find((i) => i.acceptance.includes(a.id))?.id ?? '?', verifiedBy: a.verifiedBy }));
      entry.items = items.map((i) => ({
        id: i.id,
        title: i.task,
        size: i.size,
        model: i.model,
        modelSource: i.modelSource,
        dependsOn: i.dependsOn,
        acceptance: i.acceptance,
        files: i.spec.files,
        role: planted === undefined ? 'other' : i.id === planted.id ? 'planted' : dependsOnPath(items, i.id, planted.id) ? 'dependent' : 'independent',
      }));

      // Plan 03-41: no item's prompt carries another item's owner-choice options (the unit must not be shown a choice that is not its own).
      entry.promptScope = promptScopeOf(c);
      for (const [itemId, scope] of Object.entries(entry.promptScope)) {
        if (scope.otherItemOptions > 0) problems.push(`${rel}: item ${itemId}'s prompt Behavior carries ${scope.otherItemOptions} owner-choice option(s) of another item`);
      }

      // Plan 03-49: a file outside the Write list that holds a name or value the brief changes or removes, which the run could not be given (run 1's e2e spec).
      const checked = writeSetCheck(source, pin, {
        behavior: c.intent.behavior,
        writeGlobs: c.files.write,
        itemFiles: c.intent.workItems.flatMap((i) => i.spec.files),
        protectedGlobs: c.files.protected,
        conventionsWrite: conventions.paths.write,
      });
      entry.writeSet = checked;
      for (const finding of checked.findings) {
        const line = checked.lines[checked.findings.indexOf(finding)] as string;
        if (finding.problem) problems.push(`${rel}: write-set check: ${line}`);
        else warnings.push(`${rel}: write-set check: ${line}`);
      }

      if (decisionRefs.length !== 1) problems.push(`${rel}: ${decisionRefs.length} decision: criteria (D-02 wants exactly one planted choice)`);
      if (entry.expectedDecisions !== 1) problems.push(`${rel}: expectedDecisions is ${entry.expectedDecisions}, not 1`);
      const independent = entry.items.filter((i) => i.role === 'independent');
      if (planted === undefined) problems.push(`${rel}: no item carries the decision criterion`);
      else if (independent.length === 0) problems.push(`${rel}: no item is independent of the planted item ${planted.id}`);
      else {
        for (const item of independent) {
          const shared = item.files.filter((f) => planted.spec.files.includes(f));
          if (shared.length > 0) problems.push(`${rel}: independent item ${item.id} and planted item ${planted.id} share ${shared.join(', ')}`);
          if (item.files.length >= c.files.write.length) problems.push(`${rel}: independent item ${item.id} names no file of its own (its derived files are the whole write set)`);
        }
        if (planted.spec.files.length >= c.files.write.length) problems.push(`${rel}: planted item ${planted.id} names no file of its own`);
      }
      // Every file a run may write exists at the pin, or is created by the brief (named in an acceptance criterion or the behavior).
      for (const file of c.files.write) {
        if (!files.includes(file) && !text.includes(file)) problems.push(`${rel}: write path ${file} is neither in the pin's tree nor named by the brief`);
        if (!files.includes(file)) warnings.push(`${rel}: ${file} is created by the run (absent at the pin)`);
      }
    }
    report['briefs'] = briefReports;

    // 4. the host the exit would select, read without running anything.
    report['host'] = hostSelection();
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }

  // 5. the owner's portfolio must not have moved.
  const after = portfolioState(source);
  const unchanged = sameState(before, after);
  report['portfolio'] = { before: summaryOf(before), after: summaryOf(after), unchanged };
  if (!unchanged) problems.push('the portfolio HEAD, status, refs or checkout digest changed during the dry run');
  report['problems'] = problems;
  report['warnings'] = warnings;
  report['wallSeconds'] = Math.round((Date.now() - startedAt) / 1000);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`);

  for (const b of (report['briefs'] ?? []) as BriefReport[]) {
    out(`\n${b.path}: ${b.compiled ? 'compiled' : `NOT compiled (${b.problem ?? '?'})`}${b.digest !== undefined ? `, digest ${b.digest.slice(0, 19)}...` : ''}\n`);
    for (const i of b.items ?? []) out(`  item ${i.id} ${i.role.padEnd(11)} ${i.size.padEnd(6)} ${i.model.padEnd(6)} depends on [${i.dependsOn.join(',')}]  criteria ${i.acceptance.join(',')}  files ${i.files.join(', ')}\n`);
    if (b.promptScope !== undefined) out(`  prompt scope (another item's options in this item's Behavior): ${Object.entries(b.promptScope).map(([id, s]) => `${id}=${s.otherItemOptions}`).join(', ')}\n`);
    if (b.writeSet !== undefined) out(`  write-set check: ${b.writeSet.needles.length} name(s) read from the Behavior, ${b.writeSet.findings.length} file(s) outside the Write list hold one, ${b.writeSet.findings.filter((f) => f.problem).length} protected or outside the conventions\n`);
    if (b.decisionKeys !== undefined) out(`  decision keys: ${b.decisionKeys.join(', ')}; expected decisions ${b.expectedDecisions}; write set: ${(b.write ?? []).join(', ')}\n`);
    if (b.budgets !== undefined) out(`  budgets: invocations ${String(b.budgets['invocations'])}, per run ${String(b.budgets['costUsdPerRun'])} USD, per invocation ${String(b.budgets['costUsdPerInvocation'])} USD, wall clock ${String(b.budgets['wallClockMinutes'])} min\n`);
  }
  const spend = report['spend'] as Json | undefined;
  if (spend !== undefined) {
    out(`\nPhase 3 spend so far ${String(spend['spentUsd'])} USD of ${String(spend['ceilingUsd'])}; headroom ${String(spend['headroomUsd'])} USD for ${String(spend['runs'])} runs\n`);
    out(`${String(spend['runs'])} runs at the routine ${String(spend['routineCapUsdPerRun'])} USD cap would need ${String(spend['fullCapsTotalUsd'])} USD: ${spend['fullCapsFit'] === true ? 'fits' : 'does NOT fit'}\n`);
    out(`largest per-run cap that fits ${String(spend['runs'])} runs: ${String(spend['largestPerRunCapThatFitsUsd'])} USD (exactly ${String(spend['largestPerRunCapThatFitsExactUsd'])}); ${String(spend['flag'])}\n`);
  }
  out(`portfolio before and after: ${unchanged ? 'equal' : 'DIFFERENT'} (HEAD ${before.head.slice(0, 7)}, ${before.status.split('\n').filter((l) => l !== '').length} status entries)\n`);
  for (const w of warnings) out(`warning: ${w}\n`);
  for (const p of problems) out(`PROBLEM: ${p}\n`);
  out(`exit-dry-run: ${problems.length} problem(s), ${warnings.length} warning(s); spent 0 USD; evidence ${resolve(outPath)}\n`);
  return problems.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// The live exit (plan 03-29; D-03, D-05, D-14)
// ---------------------------------------------------------------------------------------------------------------

// The plan the spend line and the evidence file are recorded under (plan 03-41): AVARICE_PHASE3_PLAN, the variable the live harness reads for its own
// spend lines too; 03-29 when it is unset or empty, so the first attempt's tools behave as they did.
export function livePlan(env: NodeJS.ProcessEnv = process.env): string {
  const named = env['AVARICE_PHASE3_PLAN'];
  return named !== undefined && named !== '' ? named : '03-29';
}

// The authorization file the host pin came from, as the evidence names it: the file the tools were given, not a fixed name.
export const pinnedByOf = (authorizationPath: string): string => basename(authorizationPath);

// The evidence file as it is rewritten: this tool's own keys replace the file's, and every other top-level key it holds (the `supersedes` block of a
// repeated exit among them) is kept as it was read.
export function evidenceFileBody(existing: Json | undefined, plan: string, runs: readonly Json[], updatedAt: string): Json {
  const own = new Set(['schema', 'plan', 'decision', 'updatedAt', 'runs']);
  const kept = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => !own.has(key)));
  return { schema: 1, plan, decision: 'D-03, D-05', updatedAt, runs, ...kept };
}

// D-03: the run an evidence file says it supersedes must already be over. `readState` is the owner's ledger read model; undefined means the run is not
// there to read. Returns the refusal text, or undefined when the file supersedes nothing or the superseded run is failed, cancelled or closed.
export function supersededRunRefusal(evidence: Json | undefined, readState: (runId: string) => string | undefined): string | undefined {
  const block = evidence?.['supersedes'];
  if (!isObject(block) || typeof block['runId'] !== 'string') return undefined;
  const runId = block['runId'];
  const state = readState(runId);
  if (state === undefined) return `run ${runId} cannot be read from the owner's ledger; the owner cancels it first (D-03, no silent repeat)`;
  if (isRunTerminal(state as RunState)) return undefined;
  return `run ${runId} is ${state}; the owner cancels it first (D-03, no silent repeat)`;
}

// The state of one run in the owner's profile, read through the read-only read model (no migration, no write); undefined when the profile or the run
// cannot be read.
export function runStateOf(env: NodeJS.ProcessEnv, runId: string): string | undefined {
  const composed = createDeps(env, {}, { readOnly: true });
  if (!composed.ok) return undefined;
  try {
    const run = composed.value.deps.ledger.getRun(runId);
    return run.ok ? run.value.state : undefined;
  } finally {
    composed.value.close();
  }
}

// What each item's unit is shown of the other items' owner choices (plan 03-40): for every item, how many of the options another item owns (its numbered
// lines and its open-decision wording, normalized) are found in the Behavior that item's prompt carries. Options this item owns itself are not counted.
export function promptScopeOf(contract: ScopeContract): Record<string, { otherItemOptions: number }> {
  const ids = contract.intent.workItems.map((i) => i.id);
  const scope: Record<string, { otherItemOptions: number }> = {};
  for (const id of ids) {
    const shown = normalizeOption(itemBehavior(contract.intent.behavior, id, ids));
    const own = new Set(itemChoiceOptions(contract, id, []));
    const foreign = new Set(ids.filter((other) => other !== id).flatMap((other) => itemChoiceOptions(contract, other, [])));
    scope[id] = { otherItemOptions: [...foreign].filter((option) => option !== '' && !own.has(option) && shown.includes(option)).length };
  }
  return scope;
}

// ---------------------------------------------------------------------------------------------------------------
// The owner's relaxation of D-03 for one run (plan 03-49)
// ---------------------------------------------------------------------------------------------------------------

// The field-level difference of two contract bodies, by field path: a list that gained or lost entries reads `{ path, added, removed }`, a changed scalar
// `{ path, from, to }`. The ledger port exposes no stored diff, so the finish derives one from the contract files of the two versions.
export function contractDiff(before: unknown, after: unknown, path = ''): Json[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const flat = (list: unknown[]): string[] => list.map((v) => JSON.stringify(v));
    const was = flat(before);
    const now = flat(after);
    if (was.length === now.length && was.every((v, n) => v === now[n])) return [];
    const added = after.filter((v) => !was.includes(JSON.stringify(v)));
    const removed = before.filter((v) => !now.includes(JSON.stringify(v)));
    if (added.length === 0 && removed.length === 0) return [{ path, from: before, to: after }];
    return [{ path, ...(added.length > 0 ? { added } : {}), ...(removed.length > 0 ? { removed } : {}) }];
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...Object.keys(after), ...Object.keys(before).filter((k) => !(k in after))];
    return keys.flatMap((key) => contractDiff(before[key], after[key], path === '' ? key : `${path}.${key}`));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, from: before ?? null, to: after ?? null }];
}

export interface RelaxRecord {
  by: string;
  ref: string;
  decisions: string[];
  at: string;
}

// The evidence file with a relax record set on the entry of one run; every other key of the file and of every entry is as it was. Undefined when the
// file has no entry for the run.
export function withRelax(file: Json, runId: string, record: RelaxRecord): Json | undefined {
  const runs = asObjects(file['runs']);
  if (!runs.some((r) => r['runId'] === runId)) return undefined;
  return { ...file, runs: runs.map((r) => (r['runId'] === runId ? { ...r, relax: record } : r)) };
}

const DECISION_ID = /^dec_[0-9A-Za-z]+$/;

// The relax record of an entry, validated: `{ record }` when it is the owner's with a reference and decision IDs, `{}` when there is none, and `{ problem }`
// (with no record, so nothing is relaxed) when there is one and it is not valid.
export function relaxOf(raw: unknown): { record?: RelaxRecord; problem?: string } {
  if (raw === undefined || raw === null) return {};
  const invalid = (why: string): { problem: string } => ({ problem: `the relax record is not valid: ${why}` });
  if (!isObject(raw)) return invalid('it is not an object');
  if (raw['by'] !== 'owner') return invalid(`by is ${JSON.stringify(raw['by'] ?? null)}, not owner`);
  if (typeof raw['ref'] !== 'string' || raw['ref'].trim() === '') return invalid('it names no reference to the owner decision');
  const ids = raw['decisions'];
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && DECISION_ID.test(id))) return invalid('decisions must be a non-empty list of decision IDs');
  if (typeof raw['at'] !== 'string' || raw['at'] === '') return invalid('it records no time');
  return { record: { by: 'owner', ref: raw['ref'], decisions: [...(ids as string[])], at: raw['at'] } };
}

// `relax --evidence F --run-id R --decision D [--decision D2 ...] --ref TEXT --by owner`: records, in the run's entry of the evidence file, that the owner relaxed
// D-03 for this run and which decisions beyond the one that paused it they answered. The finish judge accepts an extra decision only through this record.
// It writes nothing else. Claude runs it only after the owner's decision is recorded in STATE.md; the record names that decision as its reference.
function relaxCommand(argv: readonly string[]): number {
  const { named, many } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: relax: ${text}`);
    return 2;
  };
  const evidence = named['evidence'];
  const runId = named['run-id'];
  const decisions = many['decision'] ?? [];
  if (evidence === undefined || runId === undefined) return refuse('usage: relax --evidence F --run-id R --decision D [--decision D2] --ref TEXT --by owner');
  if (named['by'] !== 'owner') return refuse('--by must be owner: only the owner relaxes D-03');
  const ref = named['ref']?.trim() ?? '';
  if (ref === '') return refuse('--ref is required: name the owner decision that relaxed D-03 (for example "STATE.md 5ed69e0")');
  if (decisions.length === 0) return refuse('name at least one --decision');
  const bad = decisions.find((d) => !DECISION_ID.test(d));
  if (bad !== undefined) return refuse(`${JSON.stringify(bad)} is not a decision ID (dec_...)`);
  const path = resolve(evidence);
  const file = readJson(path);
  if (file === undefined) return refuse(`${evidence} is not an evidence file`);
  // D-28, plan 03-52: the relax path stays in the tool for the history of plan 03-49 but cannot act in the exit that carries the rules D-26..D-35.
  if (file['exitRules'] === EXIT_RULES) return refuse(`${evidence} is the evidence file of the exit under ${EXIT_RULES}: relax cannot act there, a second answered decision is a failure of the run (D-28)`);
  const next = withRelax(file, runId, { by: 'owner', ref, decisions: [...new Set(decisions)], at: new Date().toISOString() });
  if (next === undefined) return refuse(`the evidence file holds no entry for ${runId}`);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  out(`relax recorded for ${runId}: decisions ${decisions.join(', ')} (ref ${ref})\n`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// The attempts of each run, the classification of a stop, and the rule that starts another attempt (plan 03-53; D-26, D-27, D-29, D-33)
// ---------------------------------------------------------------------------------------------------------------

export const DEFECT_CLASSES: readonly string[] = ['product-defect', 'brief-harness-defect'];

// The identity of one start in the evidence (plan 03-53): the role the authorization gives the brief's digest (`run1`, `run2`, ...), the attempt number (1 plus the
// earlier entries of the role, whatever their brief digest, so a redrafted brief continues the run's count) and what the run is expected to end on. An entry the same run
// ID already holds keeps its own number when it is judged again. Undefined when the digest is not one the authorization names.
export function attemptFor(auth: Pick<Authorization, 'briefs'>, digest: string, runs: readonly Json[], runId: string): { run: string; attempt: number; expects: string } | undefined {
  const approved = auth.briefs.find((b) => b['digest'] === digest);
  const run = approved?.['run'];
  if (approved === undefined || typeof run !== 'string' || run === '') return undefined;
  const expects = typeof approved['expects'] === 'string' ? approved['expects'] : '';
  const held = runs.find((r) => r['runId'] === runId && r['run'] === run);
  if (held !== undefined && typeof held['attempt'] === 'number') return { run, attempt: held['attempt'], expects };
  return { run, attempt: 1 + runs.filter((r) => r['runId'] !== runId && r['run'] === run).length, expects };
}

export interface ClassificationPatch {
  proposed?: Json;
  confirmed?: Json;
}

// The evidence file with a classification patch merged into the entry of one run; every other key of the file and of every entry is as it was. Undefined when the
// file has no entry for the run.
export function withClassification(file: Json, runId: string, patch: ClassificationPatch): Json | undefined {
  const runs = asObjects(file['runs']);
  if (!runs.some((r) => r['runId'] === runId)) return undefined;
  const merged = (r: Json): Json => ({ ...r, classification: { ...(isObject(r['classification']) ? r['classification'] : {}), ...patch } });
  return { ...file, runs: runs.map((r) => (r['runId'] === runId ? merged(r) : r)) };
}

const AT_REFERENCE = /^[^\s:]+:[1-9]\d*$/;
const isDocsSystemRef = (ref: string): boolean => /^docs\/system\/\S+$/.test(ref) && !ref.split('/').includes('..');

// `classify --evidence F --run-id R --propose --class C --stopped-by TEXT --at PATH:LINE [--at ...] --docs-system conformant|nonconformant --docs-ref docs/system/X
// --summary TEXT --by claude` records Claude's D-26 classification of a stopped attempt: the class, the file:line, the gate or check that stopped the run and whether
// AVARICE behaved as docs/system documents. `classify --evidence F --run-id R --confirm --by owner --ref TEXT [--class C]` records the owner's ruling (D-27), which
// is the proposed class unless the owner names the other (then `overrides` names the proposed one). Each writes into the one entry and nothing else, and refuses
// (exit 2, file untouched) on a passed entry, an unknown run, a proposal the owner already ruled on, a confirmation with no proposal and a `--by` of the wrong party.
// Claude runs --confirm only from the owner's own checkpoint reply, which `--ref` names.
function classifyCommand(argv: readonly string[]): number {
  const { named, many, bools } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: classify: ${text}`);
    return 2;
  };
  const proposing = bools.has('propose');
  const confirming = bools.has('confirm');
  if (proposing === confirming) return refuse('usage: give exactly one of --propose and --confirm (neither takes a value)');
  const evidence = named['evidence'];
  const runId = named['run-id'];
  if (evidence === undefined || runId === undefined) return refuse('usage: classify --evidence F --run-id R (--propose ... | --confirm --by owner --ref TEXT [--class C])');
  const mode = proposing ? 'proposal' : 'confirmation';
  if (proposing && named['by'] !== 'claude') return refuse('--by must be claude: Claude proposes the classification (D-27)');
  if (confirming && named['by'] !== 'owner') return refuse('--by must be owner: only the owner confirms a classification (D-27)');
  const cls = named['class'];
  if (cls !== undefined && !DEFECT_CLASSES.includes(cls)) return refuse(`--class ${JSON.stringify(cls)} is neither ${DEFECT_CLASSES.join(' nor ')} (D-26)`);
  const stoppedBy = named['stopped-by']?.trim() ?? '';
  const at = many['at'] ?? [];
  const docsSystem = named['docs-system'];
  const docsRef = named['docs-ref'] ?? '';
  const summary = named['summary']?.trim() ?? '';
  const ref = named['ref']?.trim() ?? '';
  if (proposing) {
    if (cls === undefined) return refuse(`--class is required: ${DEFECT_CLASSES.join(' or ')} (D-26)`);
    if (stoppedBy === '') return refuse('--stopped-by is required: name the gate or check that stopped the run (D-27)');
    if (at.length === 0) return refuse('--at is required: name the file and line as <path>:<line> (D-27)');
    const badAt = at.find((a) => !AT_REFERENCE.test(a));
    if (badAt !== undefined) return refuse(`--at ${JSON.stringify(badAt)} is not <path>:<line>`);
    if (docsSystem !== 'conformant' && docsSystem !== 'nonconformant') return refuse('--docs-system must be conformant or nonconformant: whether AVARICE behaved as docs/system documents (D-27)');
    if (!isDocsSystemRef(docsRef)) return refuse(`--docs-ref ${JSON.stringify(docsRef)} is not a document under docs/system/ (D-27)`);
    if (summary === '') return refuse('--summary is required: say what stopped the run (D-27)');
  } else if (ref === '') return refuse('--ref is required: name the owner reply that confirmed the classification (D-27)');

  const path = resolve(evidence);
  const file = readJson(path);
  if (file === undefined) return refuse(`${evidence} is not an evidence file`);
  const entry = asObjects(file['runs']).find((r) => r['runId'] === runId);
  if (entry === undefined) return refuse(`the evidence file holds no entry for ${runId}`);
  if (entry['passed'] === true) return refuse(`${runId} passed: a passed run has nothing to classify`);
  const held = isObject(entry['classification']) ? entry['classification'] : {};
  if (isObject(held['confirmed'])) return refuse(`${runId} is already ruled on by the owner (${String(held['confirmed']['class'])}): the ruling stands, and a ${mode} cannot replace it`);

  const now = new Date().toISOString();
  let patch: ClassificationPatch;
  let said: string;
  if (proposing) {
    patch = { proposed: { by: 'claude', class: cls, stoppedBy, at: [...at], docsSystem: { conformant: docsSystem === 'conformant', ref: docsRef }, summary, proposedAt: now } };
    said = `proposed ${String(cls)}`;
  } else {
    const proposed = isObject(held['proposed']) ? held['proposed'] : undefined;
    if (proposed === undefined) return refuse(`${runId} has no proposal to confirm: Claude proposes first (D-27)`);
    const ruling = cls ?? String(proposed['class']);
    patch = { confirmed: { by: 'owner', class: ruling, ...(ruling !== proposed['class'] ? { overrides: proposed['class'] } : {}), ref, at: now } };
    said = `confirmed ${ruling}${ruling !== proposed['class'] ? ` (overriding ${String(proposed['class'])})` : ''}`;
  }
  const next = withClassification(file, runId, patch);
  if (next === undefined) return refuse(`the evidence file holds no entry for ${runId}`);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  out(`classify: ${said} for ${runId}\n`);
  return 0;
}

const sha256OfFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

// A JSON file that may not be there or may not parse: undefined then, instead of a throw.
function tryReadJson(path: string): Json | undefined {
  try {
    return readJson(path);
  } catch {
    return undefined;
  }
}

export interface ResetProposalInput {
  evidence: Json | undefined;
  order: readonly string[];
  role: string;
  // The role's digest from the authorization's briefs, or undefined.
  briefDigest: string | undefined;
  pin: string;
  // The parsed parity report, or undefined when it is missing or is not JSON.
  parity: Json | undefined;
  // One entry per `--defect` group: the parsed red and green proof bodies (undefined when missing or not JSON) and the sha256 of each proof file.
  scenarios: Array<{ runId: string; test: string; testTracked: boolean; red: Json | undefined; green: Json | undefined; redSha256: string; greenSha256: string }>;
}

// A scenario's test is a relative path under test/ (D-37): never absolute and never leaving the directory.
const isTestPath = (path: string): boolean => path.startsWith('test/') && !path.split('/').includes('..');
// The count a TAP summary line gives (`# fail 2`): the last such line, or undefined when the report has none.
function tapCount(output: unknown, label: 'pass' | 'fail'): number | undefined {
  const found = typeof output === 'string' ? [...output.matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, 'gm'))] : [];
  const last = found[found.length - 1];
  return last === undefined ? undefined : Number(last[1]);
}
const commandNamesTest = (command: unknown, test: string): boolean => typeof command === 'string' && command.split(/\s+/).includes(test);

// D-36 and D-37 before a reset is proposed, as a list of problems (empty when the proposal may be written). Pure: it reads no file. It judges, in this order: the role is a run of the
// authorization; no attempt of the role is open; the role has a failed attempt in its stop-loss epoch and the latest of them is an owner-confirmed product defect (a brief/harness
// stop, or an unruled one, resets nothing); each product-defect attempt has exactly one scenario and each scenario names one; each scenario's test is tracked under test/ and its red
// and green proofs show the failure and the pass of that test; no red proof was proved by an earlier confirmed reset (a repeat of the same failure still counts); and the parity
// report is clean, at the pin, checked after every ruling and covering the run's brief. Each problem names the fact and the decision it serves.
export function judgeResetProposal(input: ResetProposalInput): string[] {
  const { evidence, role, scenarios } = input;
  if (!input.order.includes(role)) return [`${role} is not a run of the authorization (order ${input.order.join(', ')}) (D-28)`];
  const problems: string[] = [];
  const mine = asObjects(evidence?.['runs']).filter((r) => r['run'] === role);
  const idOf = (e: Json): string => String(e['runId'] ?? '');
  for (const open of mine.filter((e) => e['passed'] !== true && !isFailedAttempt(e))) problems.push(`${idOf(open)} is neither passed nor failed: it is still open, so nothing is proven yet (D-34)`);

  const since = stopLossEpochOf(evidence, role);
  const sinceMs = since === null ? Number.NEGATIVE_INFINITY : Date.parse(since);
  const failed = mine.filter((e) => isFailedAttempt(e) && startedMs(e) >= sinceMs);
  if (failed.length === 0) return [...problems, `nothing to reset: ${role} has no failed attempt since its last reset (D-36)`];
  const latest = latestAttempt(failed) as Json;
  const ruling = confirmedOf(latest);
  if (ruling === undefined) problems.push(`${idOf(latest)} has no owner ruling: only an owner-confirmed product defect resets the count (D-27, D-36)`);
  else if (ruling['class'] !== 'product-defect') problems.push(`only an owner-confirmed product defect resets the count (D-36): ${idOf(latest)} is ${String(ruling['class'])}`);

  const covered = failed.filter((e) => confirmedOf(e)?.['class'] === 'product-defect').map(idOf);
  for (const id of covered) {
    const named = scenarios.filter((s) => s.runId === id).length;
    if (named === 0) problems.push(`no red-to-green scenario for ${id} (D-37)`);
    else if (named > 1) problems.push(`${id} is named by more than one scenario (D-37)`);
  }
  for (const s of scenarios.filter((x) => !covered.includes(x.runId))) problems.push(`scenario names ${s.runId}, which is not a failed product-defect attempt of ${role} in its stop-loss epoch (D-37)`);

  const cited = new Set<string>();
  for (const reset of asObjects(evidence?.['resets']).filter((r) => isObject(r['confirmed']))) {
    const proposed = isObject(reset['proposed']) ? reset['proposed'] : {};
    for (const s of asObjects(proposed['scenarios'])) if (isObject(s['red']) && typeof s['red']['sha256'] === 'string') cited.add(s['red']['sha256']);
  }
  for (const s of scenarios) {
    const label = `scenario ${s.runId}`;
    if (!isTestPath(s.test)) problems.push(`${label}: the test ${s.test} is not a relative path under test/ without .. (D-37)`);
    else if (!s.testTracked) problems.push(`${label}: the test ${s.test} is not tracked by git (D-37)`);
    if (s.red === undefined) problems.push(`${label}: the red proof is missing or is not JSON (D-37)`);
    else {
      if (!commandNamesTest(s.red['command'], s.test)) problems.push(`${label}: the red proof's command does not name ${s.test} (D-37)`);
      if (typeof s.red['exitCode'] !== 'number' || s.red['exitCode'] === 0) problems.push(`${label}: the red proof's exit code is ${String(s.red['exitCode'])}, not a failure (D-37)`);
      if ((tapCount(s.red['output'], 'fail') ?? 0) <= 0) problems.push(`${label}: the red proof does not show a failing test (no \`# fail\` above 0) (D-37)`);
    }
    if (s.green === undefined) problems.push(`${label}: the green proof is missing or is not JSON (D-37)`);
    else {
      if (!commandNamesTest(s.green['command'], s.test)) problems.push(`${label}: the green proof's command does not name ${s.test} (D-37)`);
      if (s.green['exitCode'] !== 0) problems.push(`${label}: the green proof's exit code is ${String(s.green['exitCode'])}, not 0 (D-37)`);
      if (tapCount(s.green['output'], 'fail') !== 0) problems.push(`${label}: the green proof does not show \`# fail 0\` (D-37)`);
      if ((tapCount(s.green['output'], 'pass') ?? 0) <= 0) problems.push(`${label}: the green proof does not show a passing test (no \`# pass\` above 0) (D-37)`);
      if (typeof s.green['output'] === 'string' && /^\s*not ok\b/m.test(s.green['output'])) problems.push(`${label}: the green proof has a not ok line (D-37)`);
    }
    if (cited.has(s.redSha256)) problems.push(`${label}: the red proof is already proved by an earlier reset: a repeat of the same failure still counts (D-36)`);
  }
  const shared = scenarios.filter((s, i) => scenarios.findIndex((o) => o.redSha256 === s.redSha256) !== i);
  for (const s of shared) problems.push(`scenario ${s.runId}: the scenarios share one red proof, and each defect needs its own reproduction (D-37)`);

  const p = input.parity;
  if (p === undefined) problems.push('the parity report is missing or is not JSON (D-37)');
  else {
    const emptyList = (value: unknown): boolean => Array.isArray(value) && value.length === 0;
    if (p['schema'] !== 1) problems.push(`the parity report is not schema 1 (it is ${String(p['schema'])}) (D-37)`);
    if (p['parity'] !== true) problems.push("the parity report's parity is not true (D-37)");
    if (!emptyList(p['problems'])) problems.push('the parity report lists a problem (D-37)');
    if (!emptyList(p['mismatches'])) problems.push('the parity report lists a mismatch (D-37)');
    if (p['spentUsd'] !== 0) problems.push(`the parity report records spend (spentUsd ${String(p['spentUsd'])}); the check is offline (D-37)`);
    if (!isObject(p['checkout']) || p['checkout']['unchanged'] !== true) problems.push("the parity report's checkout is not unchanged (D-37)");
    const reportPin = p['pin'];
    if (typeof reportPin !== 'string' || input.pin === '' || !reportPin.startsWith(input.pin)) problems.push(`the parity report is at pin ${String(reportPin)}, not ${input.pin} (D-37)`);
    const checkedMs = typeof p['checkedAt'] === 'string' ? Date.parse(p['checkedAt']) : Number.NaN;
    const rulingMs = failed.map((e) => confirmedOf(e)?.['at']).map((at) => (typeof at === 'string' ? Date.parse(at) : Number.NEGATIVE_INFINITY));
    if (!Number.isFinite(checkedMs)) problems.push('the parity report has no checkedAt time (D-37)');
    else if (checkedMs <= Math.max(...rulingMs)) problems.push(`the parity report was checked before the owner's ruling (${String(p['checkedAt'])}): re-run it after the ruling (D-37)`);
    const digests = asObjects(p['briefs']).map((b) => b['digest']);
    if (input.briefDigest === undefined) problems.push(`the authorization names no brief digest for ${role} (D-37)`);
    else if (!digests.includes(input.briefDigest)) problems.push(`the parity report does not cover the brief of ${role} (${input.briefDigest}) (D-37)`);
  }
  return problems;
}

// `reset --propose --by claude --evidence F --authorization-file A --run R --parity P [--pin SHA] --defect RUN_ID --test PATH --red FILE --green FILE [...] --summary TEXT`
// records Claude's proposal to begin a new stop-loss epoch for one run (D-36, D-37): into the evidence file's top-level `resets` list, as `{ run, covers, proposed }`, with the
// proof files each named and hashed. `reset --confirm --by owner --evidence F --run R --ref TEXT` adds the owner's `confirmed` record to the run's pending proposal (its latest
// reset, when that has no confirmation). Only that record lifts the stop-loss, and Claude runs --confirm only from the owner's own checkpoint reply, which `--ref` quotes (D-27,
// D-37), the classify pattern. Each refuses with exit 2 and the file untouched, and each keeps every other key of the file.
function resetCommand(argv: readonly string[]): number {
  const { named, many, bools } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: reset: ${text}`);
    return 2;
  };
  const proposing = bools.has('propose');
  const confirming = bools.has('confirm');
  if (proposing === confirming) return refuse('usage: give exactly one of --propose and --confirm (neither takes a value)');
  const evidence = named['evidence'];
  const role = named['run'];
  if (evidence === undefined || role === undefined) return refuse('usage: reset --evidence F --run R (--propose ... | --confirm --by owner --ref TEXT)');
  const ref = named['ref']?.trim() ?? '';
  if (proposing && named['by'] !== 'claude') return refuse('--by must be claude: Claude proposes the reset (D-37)');
  if (confirming && named['by'] !== 'owner') return refuse('--by must be owner: only the owner confirms a reset (D-37)');
  if (confirming && ref === '') return refuse('--ref is required: name the owner reply that confirmed the reset (D-37)');

  const path = resolve(evidence);
  const file = tryReadJson(path);
  if (file === undefined) return refuse(`${evidence} is not an evidence file`);
  const resets = asObjects(file['resets']);
  const now = new Date().toISOString();

  if (confirming) {
    const latest = [...resets].reverse().find((r) => r['run'] === role);
    if (latest === undefined || isObject(latest['confirmed'])) return refuse(`${role} has no pending reset proposal to confirm: Claude proposes first (D-37)`);
    const confirmation = { by: 'owner', ref, at: now };
    if (!isValidReset({ ...latest, confirmed: confirmation })) return refuse(`the pending proposal for ${role} lacks a field the proposal writes, so it cannot be confirmed (D-37)`);
    // D-37: the owner confirms the proofs Claude proposed, so each proof file must still be the one hashed at the proposal.
    const proposed = latest['proposed'] as Json;
    const proofs = [...asObjects(proposed['scenarios']).flatMap((s) => [s['red'], s['green']]), proposed['parity']].filter(isObject);
    for (const proof of proofs) {
      const proofPath = String(proof['path']);
      if (!existsSync(resolve(proofPath))) return refuse(`${proofPath} is missing, so it changed since the proposal (D-37)`);
      if (sha256OfFile(resolve(proofPath)) !== proof['sha256']) return refuse(`${proofPath} changed since the proposal (D-37)`);
    }
    const next = resets.map((r) => (r === latest ? { ...r, confirmed: confirmation } : r));
    writeFileSync(path, `${JSON.stringify({ ...file, resets: next }, null, 2)}\n`);
    out(`reset: confirmed for ${role}\n`);
    return 0;
  }

  const authorizationPath = named['authorization-file'];
  const parityPath = named['parity'];
  const summary = named['summary']?.trim() ?? '';
  if (authorizationPath === undefined || parityPath === undefined) return refuse('usage: reset --propose needs --authorization-file and --parity');
  if (summary === '') return refuse('--summary is required: say what the fixes are and what the proofs show (D-37)');
  const auth = authorizationOf(authorizationPath);
  if (typeof auth === 'string') return refuse(auth);
  const groups = { defect: many['defect'] ?? [], test: many['test'] ?? [], red: many['red'] ?? [], green: many['green'] ?? [] };
  if (groups.defect.length === 0) return refuse('--defect RUN_ID --test PATH --red FILE --green FILE is required at least once: one scenario per product defect the reset covers (D-37)');
  if (new Set(Object.values(groups).map((g) => g.length)).size !== 1) return refuse('--defect, --test, --red and --green must be given the same number of times, in groups (D-37)');
  const missing = [parityPath, ...groups.red, ...groups.green].find((p) => !existsSync(resolve(p)));
  if (missing !== undefined) return refuse(`${missing} does not exist`);
  const parity = tryReadJson(resolve(parityPath));
  if (parity === undefined) return refuse(`${parityPath} is not a parity report`);

  const pin = named['pin'] ?? DEFAULT_PIN;
  const proofOf = (p: string): { path: string; sha256: string } => ({ path: p, sha256: sha256OfFile(resolve(p)) });
  const scenarios = groups.defect.map((runId, i) => ({ runId, test: groups.test[i] as string, red: proofOf(groups.red[i] as string), green: proofOf(groups.green[i] as string) }));
  // D-37: the three proofs are checked here, before anything is written. The tracked test is read from this checkout, read-only.
  const problems = judgeResetProposal({
    evidence: file,
    order: auth.order,
    role,
    briefDigest: auth.briefs.find((b) => b['run'] === role)?.['digest'] as string | undefined,
    pin,
    parity,
    scenarios: groups.defect.map((runId, i) => {
      const test = groups.test[i] as string;
      const tracked = isTestPath(test) && spawnSync('git', ['--no-optional-locks', '-C', REPO_ROOT, 'ls-files', '--error-unmatch', '--', test], { encoding: 'utf8' }).status === 0;
      return {
        runId,
        test,
        testTracked: tracked,
        red: tryReadJson(resolve(groups.red[i] as string)),
        green: tryReadJson(resolve(groups.green[i] as string)),
        redSha256: (scenarios[i] as { red: { sha256: string } }).red.sha256,
        greenSha256: (scenarios[i] as { green: { sha256: string } }).green.sha256,
      };
    }),
  });
  for (const problem of problems) errOut(`exit-run: reset: ${problem}`);
  if (problems.length > 0) return 2;

  const since = stopLossEpochOf(file, role);
  const sinceMs = since === null ? Number.NEGATIVE_INFINITY : Date.parse(since);
  const covers = asObjects(file['runs']).filter((r) => r['run'] === role && isFailedAttempt(r) && startedMs(r) >= sinceMs).map((r) => String(r['runId'] ?? ''));
  const record = {
    run: role,
    covers,
    proposed: {
      by: 'claude',
      at: now,
      summary,
      pin,
      scenarios,
      parity: { ...proofOf(parityPath), checkedAt: parity['checkedAt'], pin: parity['pin'], parity: parity['parity'], problems: parity['problems'] },
    },
  };
  writeFileSync(path, `${JSON.stringify({ ...file, resets: [...resets, record] }, null, 2)}\n`);
  out(`reset: proposed for ${role}\n`);
  return 0;
}

// The owner's confirmed ruling on an entry, when there is one: the record the owner's `classify --confirm` wrote.
function confirmedOf(entry: Json): Json | undefined {
  const classification = entry['classification'];
  const confirmed = isObject(classification) && isObject(classification['confirmed']) ? classification['confirmed'] : undefined;
  return confirmed !== undefined && confirmed['by'] === 'owner' && typeof confirmed['class'] === 'string' ? confirmed : undefined;
}

// A stopped attempt: the entry did not pass and it carries a finish, a stop the start stage judged not to be the planned one, or a classification. An attempt that
// is still waiting for the owner's answer is neither passed nor failed.
const isFailedAttempt = (entry: Json): boolean => entry['passed'] !== true && (typeof entry['finishedAt'] === 'string' || entry['stopOk'] === false || isObject(entry['classification']));

// When an attempt started, in milliseconds: its startedAt, else the pause it recorded. An entry that records neither is older than any epoch.
function startedMs(entry: Json): number {
  const atPause = isObject(entry['atPause']) ? entry['atPause']['at'] : undefined;
  for (const candidate of [entry['startedAt'], atPause]) {
    const ms = typeof candidate === 'string' ? Date.parse(candidate) : Number.NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return Number.NEGATIVE_INFINITY;
}

// The epoch of an evidence file (D-26): the time of the latest owner-confirmed product defect, or null when there is none. A product defect means every run must pass
// again, so an attempt started before this time no longer counts toward the order of D-33 or as a pass.
export function epochOf(evidence: Json | undefined): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const entry of asObjects(evidence?.['runs'])) {
    const confirmed = confirmedOf(entry);
    const at = confirmed?.['class'] === 'product-defect' ? confirmed['at'] : undefined;
    const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN;
    if (typeof at === 'string' && Number.isFinite(ms) && ms > latestMs) {
      latest = at;
      latestMs = ms;
    }
  }
  return latest;
}

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isProofFile = (value: unknown): boolean => isObject(value) && isFilled(value['path']) && isFilled(value['sha256']);

// A reset the tools count (D-36, D-37): every field `reset --propose` and then `reset --confirm` write. Claude's proposal holds one scenario per covered attempt, each with a
// test and a red and a green proof file, and a parity report that is true and lists no problem; the owner's confirmation names the owner, a reference and a time. A hand-edited
// record that lacks one of these is no reset.
function isValidReset(reset: Json): boolean {
  const proposed = reset['proposed'];
  const confirmed = reset['confirmed'];
  if (!isObject(proposed) || !isObject(confirmed)) return false;
  if (proposed['by'] !== 'claude') return false;
  const scenarios = proposed['scenarios'];
  const scenarioOk = (s: unknown): boolean => isObject(s) && isFilled(s['runId']) && isFilled(s['test']) && isProofFile(s['red']) && isProofFile(s['green']);
  if (!Array.isArray(scenarios) || scenarios.length === 0 || !scenarios.every(scenarioOk)) return false;
  const parity = proposed['parity'];
  if (!isObject(parity) || parity['parity'] !== true || !Array.isArray(parity['problems']) || parity['problems'].length !== 0) return false;
  return confirmed['by'] === 'owner' && isFilled(confirmed['ref']) && typeof confirmed['at'] === 'string' && Number.isFinite(Date.parse(confirmed['at']));
}

// The stop-loss epoch of one run (D-36, D-39): the confirmation time of its latest valid reset in the evidence's top-level `resets`, or null when it has none. The later entry
// wins a tie. It is a different epoch from epochOf's: that one is the time of the latest owner-confirmed product defect and decides which passes count and the order (D-26,
// unchanged); this one begins only at an owner-confirmed reset that carries D-37's proofs, is per run, and bounds only the two-failure count of D-29.
export function stopLossEpochOf(evidence: Json | undefined, role: string): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const reset of asObjects(evidence?.['resets'])) {
    if (reset['run'] !== role || !isValidReset(reset)) continue;
    const at = (reset['confirmed'] as Json)['at'] as string;
    const ms = Date.parse(at);
    if (ms >= latestMs) {
      latest = at;
      latestMs = ms;
    }
  }
  return latest;
}

// The latest attempt among entries of one role: the highest attempt number, the later entry on a tie.
const latestAttempt = (entries: readonly Json[]): Json | undefined =>
  entries.reduce<Json | undefined>((best, e) => (best === undefined || Number(e['attempt'] ?? 0) >= Number(best['attempt'] ?? 0) ? e : best), undefined);

// Whether authorize may start an attempt of a run (D-26, D-27, D-29, D-33, D-34), judged over the entries of the evidence file. `readState` reads a run from the owner's
// ledger. Returns the refusal, or undefined. Code 75 is the stop-loss: two failed attempts of the run within its stop-loss epoch, whatever their classification (D-29). That epoch
// begins at the run's latest owner-confirmed reset (`stopLossEpochOf`), or at the run's first attempt when there is none (D-36 to D-39). Code 2:
//   - the run already passed in the current epoch (D-26, D-03);
//   - a run earlier in the authorization's order has no recorded outcome in the current epoch, an outcome being a pass or the owner's confirmed classification (D-33);
//   - an earlier attempt of the run, in the current epoch, has no owner-confirmed classification (D-26, D-27), where a confirmed product defect starts a new epoch;
//   - an earlier attempt's live run is not failed, cancelled or closed in the owner's ledger: Claude never cancels it (D-34).
// No flag, variable or file edit lifts any of these; the stop-loss is lifted only by a recorded reset the owner confirmed (D-36, D-37) or a new owner decision and a re-plan.
export function startRefusal(evidence: Json | undefined, auth: Pick<Authorization, 'order'>, role: string, readState: (runId: string) => string | undefined): { code: 2 | 75; text: string } | undefined {
  const refuse = (text: string): { code: 2; text: string } => ({ code: 2, text });
  if (!auth.order.includes(role)) return refuse(`${role} is not a run of the authorization (order ${auth.order.join(', ')}) (D-28)`);
  const entries = asObjects(evidence?.['runs']);
  const mine = entries.filter((r) => r['run'] === role);
  const resetAt = stopLossEpochOf(evidence, role);
  const sinceMs = resetAt === null ? Number.NEGATIVE_INFINITY : Date.parse(resetAt);
  if (mine.filter((e) => isFailedAttempt(e) && startedMs(e) >= sinceMs).length >= 2) {
    const text = resetAt === null ? `stop-loss (D-29): ${role} has failed twice; return to the owner before spending again` : `stop-loss (D-29, D-36): ${role} has failed twice since its reset at ${resetAt}; return to the owner before spending again`;
    return { code: 75, text };
  }

  const epoch = epochOf(evidence);
  const epochMs = epoch === null ? Number.NEGATIVE_INFINITY : Date.parse(epoch);
  const currentOf = (run: string): Json[] => entries.filter((e) => e['run'] === run && startedMs(e) >= epochMs);
  const current = currentOf(role);
  if (current.some((e) => e['passed'] === true)) return refuse(`${role} already passed in this exit; a run is never repeated by hand (D-03)`);

  for (const earlierRun of auth.order.slice(0, auth.order.indexOf(role))) {
    const latest = latestAttempt(currentOf(earlierRun));
    const because = `${role} starts only after ${earlierRun}'s outcome is recorded (D-33)`;
    if (latest === undefined) return refuse(`${because}: ${earlierRun} has no attempt in this exit yet`);
    if (latest['passed'] !== true && confirmedOf(latest) === undefined) return refuse(`${because}: its latest attempt ${String(latest['runId'] ?? '')} has neither passed nor an owner-confirmed classification`);
  }

  const unruled = current.find((e) => confirmedOf(e) === undefined);
  if (unruled !== undefined) return refuse(`${role}'s previous attempt has no owner-confirmed classification (${String(unruled['runId'] ?? '')}): Claude proposes it and the owner confirms it before any re-run spend (D-26, D-27)`);
  for (const earlier of mine.filter((r) => r['passed'] !== true)) {
    const earlierId = String(earlier['runId'] ?? '');
    const state = readState(earlierId);
    if (state === undefined) return refuse(`${role}'s previous attempt ${earlierId} cannot be read from the owner's ledger; the owner cancels it first (D-34)`);
    if (!isRunTerminal(state as RunState)) return refuse(`${role}'s previous attempt ${earlierId} is ${state}; the owner cancels it first (D-34)`);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// brief-check: the write-set check of each brief at the pin, without the rest of the dry run (plan 03-49)
// ---------------------------------------------------------------------------------------------------------------

// The report `brief-check` writes, returned as an object (plan 03-52): the findings of the write-set check of each brief at the pin. With `limitPerNeedle: Infinity`
// the check lists every finding and the report is marked `uncapped`; it then also carries each brief's protected globs, which the D-31 gate reads (the default
// report keeps its keys and its cap of 25 findings per needle).
export function briefCheckReport(source: string, briefPaths: readonly string[], pinRef: string, options: { limitPerNeedle?: number } = {}): Json {
  const uncapped = options.limitPerNeedle === Infinity;
  const before = portfolioState(source);
  const pin = mustRead(source, ['rev-parse', '--verify', `${pinRef}^{commit}`]).trim();
  const gitSource = new GitRunSource();
  const head = gitSource.head(source);
  if (!head.ok) throw new Error(`cannot read the HEAD of ${source}: ${describeError(head.error)}`);
  const found = gitSource.conventionsAt(source, pin, head.value);
  if (!found.ok) throw new Error(`no committed conventions: ${describeError(found.error)}`);
  const committed = parseConventions(found.value.text);
  if (!committed.ok) throw new Error(`the committed conventions do not parse: ${describeError(committed.error)}`);
  const conventions = committed.value;
  const files = mustRead(source, ['ls-tree', '-r', '--name-only', pin]).split('\n').filter((l) => l !== '');
  const briefs: Record<string, Json> = {};
  let n = 0;
  for (const path of briefPaths) {
    n += 1;
    const key = (path.split('/').pop() as string).replace(/\.md$/, '');
    const parsed = parseBrief(readFileSync(path, 'utf8'), { kind: 'file', id: path.split('/').pop() as string });
    if (!parsed.ok) {
      briefs[key] = { path: relative(REPO_ROOT, path), problem: `does not parse: ${describeError(parsed.error)}` };
      continue;
    }
    const compiled = compileRunContract({ runId: `run_Phase3BriefCheck${n}`, projectId: 'portfolio', baseRevision: pin, conventionsRevision: found.value.revision, brief: parsed.value, conventions, nowIso: new Date().toISOString(), policy: 'routine', indexFacts: { files, symbolsByFile: {} } });
    if (!compiled.ok) {
      briefs[key] = { path: relative(REPO_ROOT, path), digest: parsed.value.digest, problem: `does not compile: ${JSON.stringify(compiled.error)}` };
      continue;
    }
    const c = compiled.value.contract;
    const checked = writeSetCheck(source, pin, { behavior: c.intent.behavior, writeGlobs: c.files.write, itemFiles: c.intent.workItems.flatMap((i) => i.spec.files), protectedGlobs: c.files.protected, conventionsWrite: conventions.paths.write }, options);
    // The files that hold each name, one entry per file with its lines: what an owner reads to judge whether the brief changes or removes the name.
    const byNeedle: Record<string, Array<{ path: string; lines: number[]; kind: string; protected: boolean; insideConventions: boolean; problem: boolean }>> = {};
    for (const f of checked.findings) {
      const files = (byNeedle[f.needle] ??= []);
      const known = files.find((x) => x.path === f.path && x.kind === f.kind);
      if (known !== undefined) known.lines.push(f.line);
      else files.push({ path: f.path, lines: [f.line], kind: f.kind, protected: f.protected, insideConventions: f.insideConventions, problem: f.problem });
    }
    briefs[key] = {
      path: relative(REPO_ROOT, path),
      digest: parsed.value.digest,
      write: c.files.write,
      needles: checked.needles,
      findings: checked.findings,
      lines: checked.lines,
      truncated: checked.truncated,
      problems: checked.findings.filter((f) => f.problem).length,
      byNeedle,
      ...(uncapped ? { protectedGlobs: c.files.protected } : {}),
    };
  }
  const after = portfolioState(source);
  const unchanged = sameState(before, after);
  return { schema: 1, plan: '03-49', checkedAt: new Date().toISOString(), source: source.replace(homedir(), '~'), pin, conventionsRevision: found.value.revision, readOnly: true, modelHostLaunched: false, spentUsd: 0, portfolio: { before: summaryOf(before), after: summaryOf(after), unchanged }, briefs, ...(uncapped ? { uncapped: true } : {}) };
}

function briefCheck(argv: readonly string[]): number {
  const { named, many, bools } = flags(argv);
  const source = resolve(named['source'] ?? join(homedir(), 'aa-phan-portfolio-v2'));
  const briefPaths = (many['brief'] ?? []).map((p) => resolve(p));
  const outPath = named['out'];
  const pinRef = named['pin'] ?? DEFAULT_PIN;
  if (briefPaths.length === 0 || outPath === undefined) {
    errOut('usage: brief-check [--all] --source REPO --brief F [--brief F ...] --out F [--pin SHA]');
    return 2;
  }
  const report = briefCheckReport(source, briefPaths, pinRef, bools.has('all') ? { limitPerNeedle: Infinity } : {});
  const briefs = report['briefs'] as Record<string, Json>;
  // A brief that does not parse or compile is one problem; otherwise its protected or outside-the-conventions findings.
  const problems = Object.values(briefs).reduce((sum, b) => sum + (typeof b['problem'] === 'string' ? 1 : Number(b['problems'])), 0);
  const unchanged = (report['portfolio'] as Json)['unchanged'] === true;
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`);
  for (const [key, b] of Object.entries(briefs)) {
    out(`${key}: ${String(b['problem'] ?? `${(b['findings'] as unknown[]).length} finding(s), ${String(b['problems'])} protected or outside the conventions`)}\n`);
    for (const line of (b['lines'] as string[] | undefined) ?? []) out(`  ${line}\n`);
  }
  out(`brief-check: ${problems} finding(s) protected or outside the conventions in all; portfolio ${unchanged ? 'unchanged' : 'DIFFERENT'}; spent 0 USD; ${resolve(outPath)}\n`);
  return unchanged ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// The D-31 gate (plan 03-52): a brief starts a run only when every finding of its write-set check was classified in a reviewed file, and the file holds no
// `changed` finding in a protected file or outside the conventions' write set. The file is a claim: every fact the gate judges (what the findings are, where, whether
// the file is protected or inside the conventions, the brief's digest, the pin) comes from a fresh uncapped check at the pin, never from the file. Nothing here reads
// a classification from a brief's text (D-31).
// ---------------------------------------------------------------------------------------------------------------

const showValue = (value: unknown): string => JSON.stringify(value ?? null);
const briefsRecord = (report: Json): Record<string, Json> => (isObject(report['briefs']) ? (report['briefs'] as Record<string, Json>) : {});
const findingKey = (f: Json): string => `${String(f['path'])}:${String(f['line'])}:${String(f['needle'])}`;

// The problems that concern the file as a whole: the pin and the conventions revision it was made at, and a repository that moved during the fresh check.
function gateTop(classification: Json, fresh: Json): string[] {
  const problems: string[] = [];
  if (classification['pin'] !== fresh['pin']) problems.push(`(file): the classification was made at pin ${showValue(classification['pin'])}, the fresh check ran at pin ${showValue(fresh['pin'])} (D-31)`);
  if (classification['conventionsRevision'] !== fresh['conventionsRevision']) problems.push(`(file): the classification was made against conventions ${showValue(classification['conventionsRevision'])}, the fresh check read conventions ${showValue(fresh['conventionsRevision'])} (D-31)`);
  if (isObject(fresh['portfolio']) && fresh['portfolio']['unchanged'] === false) problems.push('(file): the repository changed during the fresh check (D-31)');
  return problems;
}

// The problems of one brief: the fresh parse and compile, the digest, a capped check, a Write-list entry under a protected glob (D-30), and each finding.
function gateBrief(key: string, filed: Json | undefined, fresh: Json | undefined): string[] {
  if (fresh === undefined) return [`${key}: the fresh check holds no brief of this name (D-31)`];
  if (typeof fresh['problem'] === 'string') return [`${key}: the brief does not pass the fresh check: ${fresh['problem']} (D-31)`];
  if (filed === undefined) return [`${key}: the classification file holds no entry for this brief (D-31)`];
  const problems: string[] = [];
  if (filed['digest'] !== fresh['digest']) problems.push(`${key}: the digest ${showValue(filed['digest'])} in the file differs from the fresh parse ${showValue(fresh['digest'])}: the brief changed after it was classified (D-31)`);
  const truncated = isObject(fresh['truncated']) ? Object.entries(fresh['truncated']) : [];
  if (truncated.length > 0) problems.push(`${key}: the fresh check was capped (truncated ${JSON.stringify(Object.fromEntries(truncated))}), so its findings cannot all be classified (D-31)`);
  if (!Array.isArray(fresh['protectedGlobs'])) problems.push(`${key}: the fresh check carries no protected globs, so the Write list cannot be judged (D-30)`);
  else {
    for (const path of Array.isArray(fresh['write']) ? (fresh['write'] as unknown[]).map(String) : []) {
      if (matchesAny(path, (fresh['protectedGlobs'] as unknown[]).map(String))) problems.push(`${key}: the Write list names ${path}, which matches a protected glob (D-30)`);
    }
  }
  const freshFindings = new Map(asObjects(fresh['findings']).map((f) => [findingKey(f), f]));
  const seen = new Set<string>();
  for (const f of asObjects(filed['findings'])) {
    const id = findingKey(f);
    const label = `${key}: ${String(f['path'])}:${String(f['line'])} ${String(f['needle'])}`;
    if (seen.has(id)) {
      problems.push(`${label}: listed twice in the file (D-31)`);
      continue;
    }
    seen.add(id);
    const found = freshFindings.get(id);
    if (found === undefined) {
      problems.push(`${label}: the fresh check does not report this finding (D-31)`);
      continue;
    }
    const classification = f['classification'];
    if (classification !== 'kept' && classification !== 'changed') {
      problems.push(`${label}: the classification is ${showValue(classification)}, not kept or changed (D-31)`);
      continue;
    }
    const own = `${String(found['path'])}:${String(found['line'])}`;
    if (f['assertedAt'] !== own) problems.push(`${label}: assertedAt is ${showValue(f['assertedAt'])}, not the finding's own location ${own} (D-31)`);
    if (classification === 'changed') {
      if (found['protected'] === true) problems.push(`${label}: classified changed, but the file is protected and no run may write it (D-30, D-31)`);
      else if (found['insideConventions'] !== true) problems.push(`${label}: classified changed, but the file is outside the conventions' write set and no run may write it (D-31)`);
    }
  }
  for (const [id, found] of freshFindings) {
    if (!seen.has(id)) problems.push(`${key}: ${String(found['path'])}:${String(found['line'])} ${String(found['needle'])}: missing from the classification file, so unclassified (D-31)`);
  }
  return problems;
}

// The whole gate: the file as a whole, every brief of the fresh check, and every brief the file holds that the fresh check does not.
export function gateClassification(classification: Json, fresh: Json): string[] {
  const filed = briefsRecord(classification);
  const checked = briefsRecord(fresh);
  const problems = gateTop(classification, fresh);
  if (Object.keys(checked).length === 0) problems.push('(file): the fresh check holds no brief, so nothing was classified (D-31)');
  for (const key of Object.keys(checked)) problems.push(...gateBrief(key, filed[key], checked[key]));
  for (const key of Object.keys(filed)) {
    if (!(key in checked)) problems.push(`${key}: the file classifies a brief the fresh check does not hold (D-31)`);
  }
  return problems;
}

// The gate for the one brief a start is about to begin: the file as a whole and that brief's own findings.
export function gateForBrief(classification: Json, fresh: Json, briefKey: string): string[] {
  return [...gateTop(classification, fresh), ...gateBrief(briefKey, briefsRecord(classification)[briefKey], briefsRecord(fresh)[briefKey])];
}

const gateFindingCount = (fresh: Json): number => Object.values(briefsRecord(fresh)).reduce((sum, b) => sum + asObjects(b['findings']).length, 0);

// The classification file, or the reason it cannot be read as one.
function readClassification(path: string): Json | string {
  if (!existsSync(path)) return `${path} does not exist`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return `${path} is not JSON`;
  }
  if (!isObject(parsed) || !isObject(parsed['briefs'])) return `${path} is not a classification file (a brief-check report with a briefs object)`;
  return parsed;
}

// The fresh uncapped check of the briefs a classification file names, at the pin. A brief path of the file is read against the checkout the tools live in.
function freshCheckOf(classification: Json, source: string, pinRef: string): Json | string {
  const paths = Object.values(briefsRecord(classification)).map((b) => resolve(REPO_ROOT, String(b['path'] ?? '')));
  const missing = paths.find((p) => !existsSync(p));
  if (paths.length === 0) return 'the classification file names no brief';
  if (missing !== undefined) return `the brief ${missing} named by the classification file does not exist`;
  return briefCheckReport(source, paths, pinRef, { limitPerNeedle: Infinity });
}

// `brief-gate --classification F [--source REPO] [--pin SHA]`: read-only. Exit 0 and `brief-gate: pass` when the gate finds no problem, 1 with one `brief-gate: FAIL`
// line per problem, 2 on usage.
function briefGate(argv: readonly string[]): number {
  const { named } = flags(argv);
  if (named['classification'] === undefined) {
    errOut('usage: brief-gate --classification F [--source REPO] [--pin SHA]');
    return 2;
  }
  const classification = readClassification(resolve(named['classification']));
  if (typeof classification === 'string') {
    errOut(`exit-run: brief-gate: ${classification}`);
    return 2;
  }
  const source = resolve(named['source'] ?? join(homedir(), 'aa-phan-portfolio-v2'));
  const before = portfolioState(source);
  const fresh = freshCheckOf(classification, source, named['pin'] ?? DEFAULT_PIN);
  if (typeof fresh === 'string') {
    errOut(`exit-run: brief-gate: ${fresh}`);
    return 2;
  }
  const problems = gateClassification(classification, fresh);
  if (!sameState(before, portfolioState(source))) problems.push('(file): the repository HEAD, status, refs or checkout digest changed during the gate (D-31)');
  for (const problem of problems) out(`brief-gate: FAIL ${problem}\n`);
  if (problems.length > 0) return 1;
  out(`brief-gate: pass: ${gateFindingCount(fresh)} finding(s) classified in ${Object.keys(briefsRecord(fresh)).length} brief(s); repository unchanged\n`);
  return 0;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isIsoTime = (value: unknown): value is string => typeof value === 'string' && ISO_TIME.test(value) && Number.isFinite(Date.parse(value));

// `write-authorization --classification F --brief B --run R --expects E [--brief B --run R --expects E ...] --cap USD --ceiling USD --claude-bin P --claude-version V
// --decision-ref TEXT --owner-confirmed-at ISO --out F [--source REPO] [--pin SHA]`: the fresh approval of D-28. It writes the authorization file only when the D-31 gate
// passes and the cap is at most 4.50 USD (D-33), the ceiling at most 25 USD (D-05), the decision reference is not empty and the owner confirmed no earlier than the
// classification was checked. Otherwise it exits 2 and writes nothing. Claude runs it only after the owner's reply to the re-discussion checkpoint.
function writeAuthorizationCommand(argv: readonly string[]): number {
  const { named, many } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: write-authorization: refusing: ${text}`);
    return 2;
  };
  const need = ['classification', 'cap', 'ceiling', 'claude-bin', 'claude-version', 'decision-ref', 'owner-confirmed-at', 'out'];
  const missing = need.filter((k) => named[k] === undefined);
  const briefs = many['brief'] ?? [];
  const runs = many['run'] ?? [];
  const expects = many['expects'] ?? [];
  if (missing.length > 0 || briefs.length === 0) return refuse(`usage: needs --${missing.join(' --')}${briefs.length === 0 ? ' and at least one --brief B --run R --expects E' : ''}`);
  if (runs.length !== briefs.length || expects.length !== briefs.length) return refuse(`${briefs.length} --brief, ${runs.length} --run and ${expects.length} --expects: each brief takes one of each, in order`);
  if (new Set(runs).size !== runs.length) return refuse('a run name is given to two briefs');
  const cap = Number(named['cap']);
  const ceiling = Number(named['ceiling']);
  if (!(Number.isFinite(cap) && cap > 0 && cap <= EXIT_RUN_CAP_USD + EPS)) return refuse(`--cap ${named['cap']} is not a positive amount of at most ${EXIT_RUN_CAP_USD.toFixed(2)} USD per run (D-33)`);
  if (!(Number.isFinite(ceiling) && ceiling > 0 && ceiling <= EXIT_CEILING_USD + EPS)) return refuse(`--ceiling ${named['ceiling']} is not a positive amount of at most ${EXIT_CEILING_USD} USD (D-05, D-33)`);
  const decisionRef = (named['decision-ref'] as string).trim();
  if (decisionRef === '') return refuse('--decision-ref is empty: name the owner decision that approved the briefs after the re-discussion (D-28)');
  const confirmedAt = named['owner-confirmed-at'] as string;
  if (!isIsoTime(confirmedAt)) return refuse(`--owner-confirmed-at ${JSON.stringify(confirmedAt)} is not an ISO time (D-28)`);
  const claudeBin = named['claude-bin'] as string;
  const claudeVersion = named['claude-version'] as string;
  if (claudeBin === '' || claudeVersion === '') return refuse('--claude-bin and --claude-version name the pinned host: neither may be empty');

  const classificationPath = resolve(named['classification'] as string);
  const classification = readClassification(classificationPath);
  if (typeof classification === 'string') return refuse(classification);
  if (!isIsoTime(classification['checkedAt'])) return refuse('the classification file records no checkedAt time (D-31)');
  if (Date.parse(confirmedAt) < Date.parse(classification['checkedAt'])) return refuse(`--owner-confirmed-at ${confirmedAt} is earlier than the classification's checkedAt ${classification['checkedAt']}: the owner confirmed before the check the file records (D-28)`);

  const source = resolve(named['source'] ?? join(homedir(), 'aa-phan-portfolio-v2'));
  const before = portfolioState(source);
  const fresh = freshCheckOf(classification, source, named['pin'] ?? DEFAULT_PIN);
  if (typeof fresh === 'string') return refuse(fresh);
  const problems = gateClassification(classification, fresh);
  if (!sameState(before, portfolioState(source))) problems.push('(file): the repository HEAD, status, refs or checkout digest changed during the gate (D-31)');
  if (problems.length > 0) {
    for (const problem of problems) errOut(`brief-gate: FAIL ${problem}`);
    return refuse(`the D-31 gate found ${problems.length} problem(s); no authorization was written`);
  }

  const entries: Json[] = [];
  for (const [n, brief] of briefs.entries()) {
    const abs = resolve(brief);
    const key = Object.entries(briefsRecord(classification)).find(([, b]) => resolve(REPO_ROOT, String(b['path'] ?? '')) === abs)?.[0];
    const digest = key === undefined ? undefined : (briefsRecord(fresh)[key] as Json)['digest'];
    if (typeof digest !== 'string') return refuse(`${brief} is not a brief of the classification file (D-31)`);
    entries.push({ path: relative(REPO_ROOT, abs), digest, run: runs[n] as string, expects: expects[n] as string });
  }
  const body: Json = {
    selection: 'approve',
    exitRules: EXIT_RULES,
    decisionRef,
    briefs: entries,
    order: [...runs],
    perRunCapUsd: cap,
    perRunCapFlag: `--budget costUsdPerRun=${cap}`,
    ceilingUsd: ceiling,
    host: { claudeBin, claudeVersion },
    briefCheck: { path: relative(REPO_ROOT, classificationPath), sha256: createHash('sha256').update(readFileSync(classificationPath)).digest('hex'), checkedAt: classification['checkedAt'] },
    ownerConfirmedAt: confirmedAt,
    plan: livePlan(),
  };
  const outPath = resolve(named['out'] as string);
  mkdirSync(dirname(outPath), { recursive: true });
  const temporary = `${outPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(temporary, outPath);
  out(`write-authorization: ${entries.length} brief(s), order ${runs.join(', ')}, cap ${cap} USD per run, ceiling ${ceiling} USD; gate passed on ${gateFindingCount(fresh)} finding(s); ${outPath}\n`);
  return 0;
}

const EXIT_CEILING = 75;
const EPS = 1e-9;
const STOP_WAIT_MAX_MINUTES = 130;
const POLL_MS = 3000;
const NO_SUPERVISOR_GRACE_MS = 120_000;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asObjects = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function readJson(path: string): Json | undefined {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return isObject(parsed) ? parsed : undefined;
}

function briefDigestOf(path: string): string | undefined {
  const parsed = parseBrief(readFileSync(path, 'utf8'), { kind: 'file', id: path.split('/').pop() as string });
  return parsed.ok ? parsed.value.digest : undefined;
}

function claudeVersionOf(bin: string | undefined): string {
  if (bin === undefined || bin === '' || !existsSync(bin)) return 'unknown';
  const ran = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  return /^\s*(\d+\.\d+\.\d+)\b/.exec(ran.stdout ?? '')?.[1] ?? 'unknown';
}

// D-05: a start (or the rest of a run) is allowed only when the recorded Phase 3 spend plus what the run may still cost stays within the lower of the
// ceiling the environment may lower and the ceiling the owner authorized. Nothing here ever raises either.
export function spendGuard(spentUsd: number, capUsd: number, ceilings: { ledger: number; authorized: number }): { fits: boolean; ceilingUsd: number } {
  const ceilingUsd = Math.min(ceilings.ledger, ceilings.authorized);
  return { fits: Number.isFinite(capUsd) && capUsd >= 0 && spentUsd + capUsd <= ceilingUsd + EPS, ceilingUsd };
}

function eventsOf(text: string): Json[] {
  const events: Json[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isObject(event)) events.push(event);
    } catch {
      // a line that is not JSON is not an event
    }
  }
  return events;
}

// The session IDs of the host's `init` events in a stream-json transcript, in order.
export function initSessions(text: string): string[] {
  const out: string[] = [];
  for (const event of eventsOf(text)) {
    if (event['type'] === 'system' && event['subtype'] === 'init' && typeof event['session_id'] === 'string') out.push(event['session_id']);
  }
  return out;
}

export function toolUseCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of eventsOf(text)) {
    if (event['type'] !== 'assistant' || !isObject(event['message']) || !Array.isArray(event['message']['content'])) continue;
    for (const part of event['message']['content'] as unknown[]) {
      if (isObject(part) && part['type'] === 'tool_use' && typeof part['name'] === 'string') counts[part['name']] = (counts[part['name']] ?? 0) + 1;
    }
  }
  return counts;
}

// Where a decision came from, read from the park step of the attempt that opened it (the block descriptor): the unit's own pause, or a gate (G1) that caught
// something the unit settled itself. D-02: a silent pick caught by G1 is an exit failure, never counted as a pause.
export function originOf(block: Json | undefined): { origin: string; signalKind: string; pauseSignal: string | null; gate: string | null; rules: string | null } {
  const signal = block !== undefined && isObject(block['signal']) ? block['signal'] : {};
  const data = block !== undefined && isObject(block['data']) ? block['data'] : {};
  const signalKind = typeof signal['kind'] === 'string' ? signal['kind'] : 'unknown';
  const gate = typeof data['gate'] === 'string' ? data['gate'] : null;
  const rules = typeof data['rules'] === 'string' ? data['rules'] : null;
  const pauseSignal = typeof signal['pauseSignal'] === 'string' ? signal['pauseSignal'] : null;
  const origin = gate !== null ? `${gate}${rules !== null ? `:${rules}` : ''}` : signalKind === 'pause' ? 'pause' : signalKind;
  return { origin, signalKind, pauseSignal, gate, rules };
}

// The item that asked, read from the attempt that parked for the decision. A decision lists every item it affects (the item that asked and the items that
// wait for its answer), so neither the first affected item nor all of them are the owner-choice item. Undefined when no attempt of the run parked for the
// decision, or when that attempt belongs to an item the decision does not list.
export function ownerChoiceItemOf(decision: Json, attempts: readonly Json[]): string | undefined {
  const parked = typeof decision['parkAttemptId'] === 'string' ? attempts.find((a) => a['attemptId'] === decision['parkAttemptId']) : undefined;
  const itemId = parked === undefined ? undefined : parked['itemId'];
  return typeof itemId === 'string' && (decision['affectedItems'] as string[]).includes(itemId) ? itemId : undefined;
}

// The park step (the block descriptor) that opened a decision: the latest one before the decision opened, of one of the items it affects. An item that only
// waits for the answer was never delegated, so it has no park step and the one found is the item that asked.
export function parkStepFor<T extends { startedAt: string; result: unknown }>(parkSteps: readonly T[], affectedItems: readonly string[], openedAt: string): T | undefined {
  return parkSteps.filter((s) => isObject(s.result) && typeof s.result['itemId'] === 'string' && affectedItems.includes(s.result['itemId']) && s.startedAt <= openedAt).at(-1);
}

// A start judged again on the same run keeps what the earlier judgement concluded, so a corrected judge never erases the verdict it replaces.
export function earlierJudgementsOf(prior: Json | undefined, reason: string | undefined, now: string): Json[] {
  if (prior === undefined || !Array.isArray(prior['problems'])) return Array.isArray(prior?.['earlierJudgements']) ? (prior['earlierJudgements'] as Json[]) : [];
  const atPause = isObject(prior['atPause']) ? prior['atPause'] : {};
  const earlier = Array.isArray(prior['earlierJudgements']) ? (prior['earlierJudgements'] as Json[]) : [];
  return [...earlier, { judgedAt: atPause['at'] ?? null, supersededAt: now, supersededBecause: reason ?? null, problems: prior['problems'], stopOk: prior['stopOk'] ?? null, spend: prior['spend'] ?? null }];
}

export interface Authorization {
  perRunCapUsd: number;
  ceilingUsd: number;
  claudeBin: string;
  claudeVersion: string;
  // Each approved brief: { path, digest, run, expects }.
  briefs: Json[];
  // The runs of the briefs, in the order they start.
  order: string[];
  // The classification file the approval's D-31 gate passed on, as the authorization names it (read against the checkout the tools live in).
  briefCheckPath: string;
}

// The only selection that authorizes a start is a fresh approval (D-28, plan 03-52). The in-place selections of plan 03-49 and the approvals of plans 03-28 to 03-49
// authorize nothing any more; their files stay on disk as history.
const AUTHORIZING_SELECTIONS: readonly string[] = ['approve'];

// The classification file an authorization names, read as JSON; undefined when it cannot be.
function classificationOfAuthorization(absolutePath: string): Json | undefined {
  try {
    return readJson(absolutePath);
  } catch {
    return undefined;
  }
}

// What a fresh approval is (D-28): selection `approve`, `exitRules: D-26..D-35`, a per-run cap of at most 4.50 USD (D-33) and a ceiling of at most 25 USD (D-05), a
// `briefCheck` record naming a readable classification file whose sha256 matches, an `ownerConfirmedAt` no earlier than that file's `checkedAt`, and an `order` that
// holds the run of each brief exactly once. Returns the authorization, or the reason the file authorizes nothing.
export function authorizationOf(path: string): Authorization | string {
  const auth = readJson(resolve(path));
  if (auth === undefined) return `${path} is not the owner's authorization file`;
  if (!AUTHORIZING_SELECTIONS.includes(auth['selection'] as string)) return `the authorization selection is ${JSON.stringify(auth['selection'])}, not ${AUTHORIZING_SELECTIONS.map((s) => `"${s}"`).join(' or ')}: only a fresh approval authorizes a start (D-28)`;
  if (auth['exitRules'] !== EXIT_RULES) return `the authorization names exitRules ${JSON.stringify(auth['exitRules'] ?? null)}, not ${EXIT_RULES}: only an approval written by write-authorization after the re-discussion starts a run (D-28)`;
  const perRunCapUsd = Number(auth['perRunCapUsd']);
  const ceilingUsd = Number(auth['ceilingUsd']);
  if (!(Number.isFinite(perRunCapUsd) && perRunCapUsd > 0 && Number.isFinite(ceilingUsd) && ceilingUsd > 0)) return 'the authorization names no finite positive per-run cap and ceiling';
  if (perRunCapUsd > EXIT_RUN_CAP_USD + EPS) return `the authorization's per-run cap ${perRunCapUsd} USD is above ${EXIT_RUN_CAP_USD.toFixed(2)} USD (D-33)`;
  if (ceilingUsd > EXIT_CEILING_USD + EPS) return `the authorization's ceiling ${ceilingUsd} USD is above ${EXIT_CEILING_USD} USD (D-05, D-33)`;
  const host = isObject(auth['host']) ? auth['host'] : {};
  const claudeBin = typeof host['claudeBin'] === 'string' ? host['claudeBin'] : '';
  const claudeVersion = typeof host['claudeVersion'] === 'string' ? host['claudeVersion'] : '';
  if (claudeBin === '' || claudeVersion === '') return 'the authorization names no host pin (host.claudeBin, host.claudeVersion)';
  const check = isObject(auth['briefCheck']) ? auth['briefCheck'] : {};
  const briefCheckPath = typeof check['path'] === 'string' ? check['path'] : '';
  const classificationPath = resolve(REPO_ROOT, briefCheckPath);
  if (briefCheckPath === '' || !existsSync(classificationPath)) return `the authorization's briefCheck file ${JSON.stringify(briefCheckPath)} cannot be read: an approval names the classification file its gate passed on (D-28, D-31)`;
  if (check['sha256'] !== createHash('sha256').update(readFileSync(classificationPath)).digest('hex')) return `the briefCheck file ${briefCheckPath} does not match the sha256 the approval recorded: it changed after the approval (D-28, D-31)`;
  const confirmedAt = auth['ownerConfirmedAt'];
  if (!isIsoTime(confirmedAt)) return `the authorization's ownerConfirmedAt ${JSON.stringify(confirmedAt ?? null)} is not an ISO time (D-28)`;
  const checkedAt = classificationOfAuthorization(classificationPath)?.['checkedAt'];
  if (!isIsoTime(checkedAt)) return `the briefCheck file ${briefCheckPath} records no checkedAt time (D-28, D-31)`;
  if (Date.parse(confirmedAt) < Date.parse(checkedAt)) return `the owner's confirmation ${confirmedAt} is earlier than the classification's checkedAt ${checkedAt}: the owner approved before the check (D-28)`;
  const briefs = asObjects(auth['briefs']);
  const runs = briefs.map((b) => b['run']);
  const order: unknown[] = Array.isArray(auth['order']) ? auth['order'] : [];
  const named = (list: unknown[]): list is string[] => list.every((r) => typeof r === 'string' && r !== '');
  if (!named(runs) || !named(order) || order.length !== runs.length || new Set(order).size !== order.length || !runs.every((r) => order.includes(r))) return "the authorization's order must hold the run of each approved brief exactly once (D-28)";
  return { perRunCapUsd, ceilingUsd, claudeBin, claudeVersion, briefs, order: [...order], briefCheckPath };
}

function fieldCommand(argv: readonly string[]): number {
  const { named } = flags(argv);
  const parsed = authorizationOf(named['authorization-file'] ?? '');
  if (typeof parsed === 'string') {
    errOut(`exit-run: ${parsed}`);
    return 2;
  }
  const values: Record<string, string | number> = { 'host.claudeBin': parsed.claudeBin, 'host.claudeVersion': parsed.claudeVersion, perRunCapUsd: parsed.perRunCapUsd, ceilingUsd: parsed.ceilingUsd };
  const value = values[named['pick'] ?? ''];
  if (value === undefined) {
    errOut('usage: field --authorization-file F --pick host.claudeBin|host.claudeVersion|perRunCapUsd|ceilingUsd');
    return 2;
  }
  out(`${String(value)}\n`);
  return 0;
}

// The refusal text when the D-31 gate finds a problem with the one brief about to start, or undefined when it passes. Read-only: git objects of the source at the pin.
function gateRefusalOf(briefCheckPath: string, briefPath: string, source: string, pinRef: string): string | undefined {
  const classification = readClassification(resolve(REPO_ROOT, briefCheckPath));
  if (typeof classification === 'string') return `refusing to start: ${classification} (D-31)`;
  const key = basename(briefPath).replace(/\.md$/, '');
  const before = portfolioState(source);
  let fresh: Json;
  try {
    fresh = briefCheckReport(source, [briefPath], pinRef, { limitPerNeedle: Infinity });
  } catch (cause) {
    return `refusing to start ${key}: the fresh write-set check failed: ${cause instanceof Error ? cause.message : String(cause)} (D-31)`;
  }
  const problems = gateForBrief(classification, fresh, key);
  if (!sameState(before, portfolioState(source))) problems.push('(file): the repository HEAD, status, refs or checkout digest changed during the gate (D-31)');
  return problems.length === 0 ? undefined : `refusing to start ${key}: the D-31 gate found ${problems.length} problem(s): ${problems.join('; ')}`;
}

function authorize(argv: readonly string[]): number {
  const { named } = flags(argv);
  const need = ['authorization-file', 'brief', 'repo', 'config', 'evidence'];
  const missing = need.filter((k) => named[k] === undefined);
  if (missing.length > 0) {
    errOut(`usage: authorize needs --${missing.join(' --')}`);
    return 2;
  }
  const refuse = (text: string, code = 2): number => {
    errOut(`exit-run: ${text}`);
    return code;
  };
  const parsed = authorizationOf(named['authorization-file'] as string);
  if (typeof parsed === 'string') return refuse(`refusing to spend: ${parsed}`);

  // D-03, plan 03-41: an evidence file that supersedes a stopped run starts only once the owner has cancelled that run (or it failed or closed).
  const superseded = supersededRunRefusal(readJson(resolve(named['evidence'] as string)), (runId) => runStateOf(process.env, runId));
  if (superseded !== undefined) return refuse(superseded);

  // The host pin (the owner's decision of plan 03-28): the binary the authorization names, admitted by the unchanged list, never the widening variable.
  if (process.env['AVARICE_LIVE_ADMIT_CLAUDE_VERSION'] !== undefined) return refuse('AVARICE_LIVE_ADMIT_CLAUDE_VERSION is set: the exit never widens the admitted hosts');
  if (process.env['AVARICE_CLAUDE_BIN'] !== parsed.claudeBin) return refuse(`AVARICE_CLAUDE_BIN is ${JSON.stringify(process.env['AVARICE_CLAUDE_BIN'] ?? null)}, not the pinned ${parsed.claudeBin}`);
  if (!ADMITTED_CLAUDE_VERSIONS.includes(parsed.claudeVersion)) return refuse(`the pinned host ${parsed.claudeVersion} is not an admitted version (${ADMITTED_CLAUDE_VERSIONS.join(', ')})`);
  const actual = claudeVersionOf(parsed.claudeBin);
  if (actual !== parsed.claudeVersion) return refuse(`${parsed.claudeBin} reports ${actual}, not the pinned ${parsed.claudeVersion}`);

  const briefPath = resolve(named['brief'] as string);
  const digest = existsSync(briefPath) ? briefDigestOf(briefPath) : undefined;
  if (digest === undefined) return refuse(`${named['brief']} does not parse as a brief`);
  const entry = parsed.briefs.find((b) => b['digest'] === digest);
  if (entry === undefined) return refuse(`the brief ${named['brief']} (digest ${digest}) is not one of the briefs the owner approved: stop and report`);
  if (typeof entry['path'] === 'string' && resolve(REPO_ROOT, entry['path']) !== briefPath) return refuse(`the approved digest ${digest} belongs to ${entry['path']}, not ${named['brief']}`);

  // D-31, plan 03-52: the gate again, for this brief, against a fresh uncapped write-set check at the pin. The classification file the approval names is a claim;
  // a finding of this brief that it leaves out, or changes in a protected file or outside the conventions' write set, stops the start before any spend.
  const gate = gateRefusalOf(parsed.briefCheckPath, briefPath, resolve(named['repo'] as string), named['pin'] ?? DEFAULT_PIN);
  if (gate !== undefined) return refuse(gate);

  // D-26, D-27, D-34 (plan 03-53): another attempt of a run starts only on the owner's confirmed classification of the previous one, once that run is over.
  const existing = readJson(resolve(named['evidence'] as string));
  const identity = attemptFor(parsed, digest, asObjects(existing?.['runs']), '');
  if (identity === undefined) return refuse(`the brief ${named['brief']} (digest ${digest}) names no run in the authorization: stop and report`);
  const refusal = startRefusal(existing, parsed, identity.run, (runId) => runStateOf(process.env, runId));
  if (refusal !== undefined) return refuse(refusal.text, refusal.code === 75 ? EXIT_CEILING : 2);

  const report = preflight(resolve(named['repo'] as string), resolve(named['config'] as string), named['pin'] ?? DEFAULT_PIN, Date.now());
  for (const line of report.lines) out(`${line}\n`);
  if (!report.ok) return refuse('the preflight failed (see above); nothing was started', 1);

  const spent = phase3Spent();
  const guard = spendGuard(spent, parsed.perRunCapUsd, { ledger: phase3Ceiling(), authorized: parsed.ceilingUsd });
  if (!guard.fits) return refuse(`stop and ask the owner (D-05): recorded Phase 3 spend ${spent.toFixed(4)} USD plus this run's cap ${parsed.perRunCapUsd.toFixed(2)} USD would pass the ${guard.ceilingUsd} USD ceiling`, EXIT_CEILING);
  out(`authorized: ${named['brief']} (${digest.slice(0, 19)}...), host ${parsed.claudeVersion}, Phase 3 spend ${spent.toFixed(4)} plus ${parsed.perRunCapUsd.toFixed(2)} fits ${guard.ceilingUsd} USD, ${identity.run} attempt ${identity.attempt}\n`);
  return 0;
}

interface RefLine {
  ref: string;
  object: string;
}

const refsOfSnapshot = (snap: Json): RefLine[] => asObjects(snap['refs']).map((r) => ({ ref: String(r['ref']), object: String(r['object']) }));

// Appends what the run has cost beyond what the ledger already holds for it, under plan 03-29 (D-05): once after the start and once after the resume.
function recordSpendDelta(runId: string, briefPath: string, costUsd: number, claudeVersion: string, stage: string): Json {
  const ledger = phase3LedgerPath();
  const recorded = existsSync(ledger)
    ? readFileSync(ledger, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Json)
        .filter((l) => typeof l['case'] === 'string' && l['case'].includes(runId))
        .reduce((sum, l) => sum + Number(l['costUsd']), 0)
    : 0;
  const delta = Math.max(0, costUsd - recorded);
  if (delta <= EPS) return { recordedUsd: recorded, appendedUsd: 0 };
  const name = (briefPath.split('/').pop() ?? 'brief').replace(/\.md$/, '');
  const line = { plan: livePlan(), case: `exit-${name}-${runId}-${stage}`, costUsd: delta, claudeVersion, at: new Date().toISOString() };
  appendFileSync(ledger, `${JSON.stringify(line)}\n`);
  return { recordedUsd: recorded, appendedUsd: delta, line };
}

// The host configuration directory a run recorded at start (plan 03-43): the latest completed `host:config-dir` step's { claudeConfigDir, source }, or null
// for a run that has none (started before the fix) or whose step carries no directory.
export function hostConfigDirOf(steps: ReadonlyArray<{ step: string; status: string; result: unknown }>): Json | null {
  const latest = steps.filter((s) => s.step === HOST_CONFIG_DIR_STEP && s.status === 'completed').at(-1);
  if (latest === undefined || !isObject(latest.result)) return null;
  const dir = latest.result['claudeConfigDir'];
  if (typeof dir !== 'string' || dir === '') return null;
  return { claudeConfigDir: dir, source: latest.result['source'] ?? null };
}

// The decisions that paused the run at the start stage (plan 03-46): the ones its start-stage record holds open. A finish that recorded a second stop keeps
// them in `pauseDecisionIds`, so a later finish reads the same ones and not the decision the second stop opened.
export function pauseDecisionIdsOf(prior: Json | undefined): string[] {
  if (prior === undefined) return [];
  if (Array.isArray(prior['pauseDecisionIds'])) return prior['pauseDecisionIds'].filter((id): id is string => typeof id === 'string');
  return asObjects(prior['decisions'])
    .filter((d) => d['state'] === 'open' && typeof d['decisionId'] === 'string')
    .map((d) => String(d['decisionId']));
}

// The pause decision that is still open, which is the only reason --finish refuses (exit 2). A start that recorded no pause decision keeps the old reading:
// any open decision is one the owner has not answered.
export function openPauseDecisionOf(pauseIds: readonly string[], openIds: readonly string[]): string | undefined {
  return pauseIds.length === 0 ? openIds[0] : openIds.find((id) => pauseIds.includes(id));
}

// What a finish records of the stops of a run after the owner's answer: the answered pause decision, the decision the run is blocked on now, and the stop state.
export function secondStopOf(decisions: readonly Json[], pauseIds: readonly string[], state: string, reason: string | null): Json {
  const answered = decisions.find((d) => d['state'] === 'answered' && (pauseIds.length === 0 || pauseIds.includes(String(d['decisionId'])))) ?? decisions.find((d) => d['state'] === 'answered');
  const open = decisions.find((d) => d['state'] === 'open' && !pauseIds.includes(String(d['decisionId'])));
  return {
    answeredDecision:
      answered === undefined
        ? null
        : {
            decisionId: answered['decisionId'],
            class: answered['class'],
            answer: answered['answer'] ?? null,
            answerChannel: answered['answerChannel'] ?? null,
            answeredBy: answered['answeredBy'] ?? null,
            answeredAt: answered['answeredAt'] ?? null,
            origin: answered['origin'] ?? null,
          },
    newDecision:
      open === undefined ? null : { decisionId: open['decisionId'], class: open['class'], origin: open['origin'] ?? null, issue: open['issue'] ?? null, affectedItems: open['affectedItems'] ?? [] },
    stop: { state, reason },
  };
}

interface Facts {
  run: RunRow;
  // The run's latest contract body, from which the D-35 list of checks that do not run is computed (plan 03-54); undefined when it cannot be read.
  contractBody: RunContract | undefined;
  entry: Json;
  decisions: Json[];
  items: Json[];
  attempts: Json[];
  costUsd: number;
  budgetLimitUsd: number;
}

// What contract version `version` changed against the version before it: the field-level diff of the two contract files the amendment kept under the run's
// directory (the later one is the ledger's own body). Empty when the earlier file cannot be read.
function amendmentDiffOf(dataRoot: string, runId: string, version: number, body: unknown): Json[] {
  try {
    const earlier: unknown = JSON.parse(readFileSync(join(dataRoot, 'runs', runId, `contract-v${version - 1}.json`), 'utf8'));
    // The version number and the compile time change with every amendment; they are not what it changed.
    return contractDiff(earlier, body).filter((d) => d['path'] !== 'contractVersion' && d['path'] !== 'compiledAt');
  } catch {
    return [];
  }
}

export function collect(deps: AppDeps, runId: string): { facts?: Facts; problems: string[] } {
  const problems: string[] = [];
  const run = deps.ledger.getRun(runId);
  if (!run.ok) return { problems: [`the run ${runId} is not in the ledger: ${describeError(run.error)}`] };
  const read = <T>(label: string, value: Result<T>): T | undefined => {
    if (value.ok) return value.value;
    problems.push(`${label} could not be read: ${describeError(value.error)}`);
    return undefined;
  };
  const statuses = read('the run status', getRunStatuses(deps.ledger, run.value.projectId, deps.clock.nowMs()));
  const status = statuses?.find((s) => s.runId === runId);
  const contractRow = read('the contract', deps.ledger.getRunContract(runId));
  const contract = contractRow !== undefined && contractRow !== null ? (contractRow.body as RunContract) : undefined;
  // Plan 03-49: the latest contract version, who authorized it, why, and what it changed against the version before (read from the contract files; the ledger
  // port has no stored diff). A version above 1 is an amendment, which the finish judge accepts only under the owner's relax record.
  const contractFact: Json | null =
    contractRow === undefined || contractRow === null
      ? null
      : {
          version: contractRow.version,
          authorizedBy: contractRow.authorizedBy,
          reason: contractRow.reason,
          ...(contractRow.version > 1 ? { diff: amendmentDiffOf(deps.profile.dataRoot, runId, contractRow.version, contractRow.body) } : {}),
        };
  const workItems = read('the work items', deps.ledger.listWorkItems(runId)) ?? [];
  const attemptRows = read('the attempts', deps.ledger.listRunAttempts(runId)) ?? [];
  const decisionRows = read('the decisions', deps.ledger.listDecisions({ runId })) ?? [];
  const notificationRows = read('the notifications', deps.ledger.listNotifications({ runId })) ?? [];
  const evidenceRows = read('the evidence', deps.ledger.listEvidence(runId)) ?? [];
  const gateRows = read('the gate results', deps.ledger.listGateResults(runId)) ?? [];
  const budgetRows = read('the budgets', deps.ledger.getBudgets(runId)) ?? [];
  const steps = read('the steps', deps.ledger.getRunSteps(runId)) ?? [];
  const costRow = budgetRows.find((b) => b.name === 'costUsd');
  const costUsd = costRow?.used ?? 0;
  const hostConfigDir = hostConfigDirOf(steps);

  // The park steps (the block descriptors) and the invocations (session, cost, transcript) of the run, from its steps.
  const parkSteps = steps.filter((s) => s.step === 'park' && isObject(s.result) && isObject(s.result['block']));
  const invocations: Json[] = [];
  const totals: Record<string, number> = {};
  for (const s of steps) {
    if (!isObject(s.result) || typeof s.result['invocationId'] !== 'string') continue;
    const digest = typeof s.result['transcript'] === 'string' ? s.result['transcript'] : null;
    let sessions: string[] = [];
    let tools: Record<string, number> = {};
    if (digest !== null) {
      const bytes = deps.artifacts.get(digest);
      if (!bytes.ok) problems.push(`transcript ${digest} is not readable: ${bytes.error.kind}`);
      else {
        const text = new TextDecoder().decode(bytes.value);
        sessions = initSessions(text);
        tools = toolUseCounts(text);
        for (const [tool, n] of Object.entries(tools)) totals[tool] = (totals[tool] ?? 0) + n;
      }
    }
    invocations.push({
      step: s.step,
      status: s.status,
      attemptId: s.result['attemptId'] ?? null,
      itemId: s.result['itemId'] ?? null,
      model: s.result['model'] ?? null,
      invocationId: s.result['invocationId'],
      requestedSession: s.result['sessionId'] ?? null,
      answeredDecisionId: s.result['answeredDecisionId'] ?? null,
      kind: s.result['kind'] ?? null,
      error: s.result['error'] ?? null,
      costUsd: s.result['costUsd'] ?? null,
      costChargedUsd: s.result['costChargedUsd'] ?? null,
      transcript: digest,
      initSessions: sessions,
      toolCounts: tools,
    });
  }

  const decisions: Json[] = decisionRows.map((d) => {
    const park = parkStepFor(parkSteps, d.affectedItems, d.openedAt);
    const block = park !== undefined && isObject(park.result) && isObject(park.result['block']) ? park.result['block'] : undefined;
    return {
      decisionId: d.decisionId,
      class: d.class,
      state: d.state,
      urgency: d.urgency,
      contractVersion: d.contractVersion,
      stateDigest: d.stateDigest,
      affectedItems: [...d.affectedItems],
      issue: d.issue,
      recommendation: d.recommendation,
      options: d.options,
      consequences: d.consequences,
      evidenceRefs: [...d.evidenceRefs],
      authorizedDefault: d.authorizedDefault,
      openedAt: d.openedAt,
      answeredAt: d.answeredAt,
      answeredBy: d.answeredBy,
      answer: d.answer,
      answerChannel: d.answerChannel,
      supersedes: d.supersedes,
      origin: originOf(block),
      parkAttemptId: park !== undefined && isObject(park.result) ? (park.result['attemptId'] ?? null) : null,
    };
  });

  const items: Json[] = workItems.map((w) => ({ itemId: w.itemId, state: w.state, size: w.size, model: w.model, dependsOn: [...w.dependsOn], attempts: w.attempts, gsdSession: w.gsdSession }));
  const attempts: Json[] = attemptRows.map((a) => ({ attemptId: a.attemptId, ordinal: a.ordinal, reason: a.reason, itemId: a.itemId ?? 'A', outcome: a.outcome, startedAt: a.startedAt, endedAt: a.endedAt }));

  const commits = steps
    .filter((s) => s.step === 'commit' && isObject(s.result) && typeof s.result['commit'] === 'string')
    .map((s) => {
      const result = s.result as Json;
      const attemptId = typeof result['attemptId'] === 'string' ? result['attemptId'] : null;
      return { commit: result['commit'], attemptId, itemId: attempts.find((a) => a['attemptId'] === attemptId)?.['itemId'] ?? null, paths: result['paths'] ?? null };
    });

  const requiredNames = contract?.verification.requiredChecks ?? [];
  const finalChecks = status?.evidence.filter((e) => e.kind === 'check') ?? [];
  const requiredChecks = requiredNames.map((name) => {
    const row = finalChecks.find((c) => c.name === name);
    return { name, status: row?.status ?? 'missing', revision: row?.revision ?? null, clean: row?.clean ?? null, ...(row?.preExisting === true ? { preExisting: true } : {}) };
  });
  const acceptance = (contract?.intent.acceptance ?? []).map((a) => {
    const by = evidenceRows
      .filter((e) => e.independence === 'deterministic' && e.status === 'passed' && e.acceptance.includes(a.id))
      .map((e) => ({ kind: e.kind, name: e.name, status: e.status, independence: e.independence, revision: e.revision, workItem: e.workItem, ...(e.environment['phase'] !== undefined ? { phase: e.environment['phase'] } : {}) }));
    return { id: a.id, verifiedBy: a.verifiedBy, satisfiedBy: by, satisfied: by.length > 0 };
  });

  const entry: Json = {
    runId,
    title: run.value.title,
    state: run.value.state,
    reason: run.value.reason,
    baseRevision: run.value.baseRevision,
    branch: run.value.branch,
    updatedAt: run.value.updatedAt,
    commit: status?.commit ?? null,
    clean: status?.clean ?? null,
    costUsd,
    hostConfigDir,
    contract: contractFact,
    budgets: budgetRows.map((b) => ({ name: b.name, used: b.used, reserved: b.reserved, limit: b.limit })),
    items,
    attempts,
    decisions,
    notifications: notificationRows.map((n) => ({ notificationId: n.notificationId, kind: n.kind, destination: n.destination, subjectIds: [...n.subjectIds], state: n.state, attempts: n.attempts, lastError: n.lastError, createdAt: n.createdAt, deliveredAt: n.deliveredAt })),
    gates: gateRows.map((g) => ({ gate: g.gate, workItem: g.workItem, passed: g.passed, revision: g.revision, failures: g.failures })),
    requiredChecks,
    acceptance,
    evidenceRows: evidenceRows.map((e) => ({ kind: e.kind, name: e.name, status: e.status, independence: e.independence, revision: e.revision, clean: e.clean, workItem: e.workItem, acceptance: [...e.acceptance], ...(e.environment['phase'] !== undefined ? { phase: e.environment['phase'] } : {}), ...(e.environment['preExisting'] === true ? { preExisting: true } : {}) })),
    commits,
    invocations,
    toolCounts: totals,
    askUserQuestion: totals['AskUserQuestion'] ?? 0,
    statusView: status ?? null,
  };
  return { facts: { run: run.value, contractBody: contract, entry, decisions, items, attempts, costUsd, budgetLimitUsd: costRow?.limit ?? 0 }, problems };
}

// D-35 judged live (plan 03-54): the run's status must list, as not run, exactly the declared checks that are neither required nor a target. `expected` is that list
// computed from the run's own contract with checksNotRun; undefined judges nothing. Returns the problem text, or undefined when the status names the same checks.
export function checksNotRunProblem(statusView: unknown, expected: readonly string[] | undefined): string | undefined {
  if (expected === undefined) return undefined;
  const listed = isObject(statusView) ? statusView['checksNotRun'] : undefined;
  const reported = asObjects(listed).map((c) => String(c['name']));
  if (reported.length === expected.length && [...reported].sort().join('\n') === [...expected].sort().join('\n')) return undefined;
  if (expected.length === 0) return `status reports ${reported.join(', ')} as not run, but the contract expects none (D-35)`;
  if (expected.every((name) => reported.includes(name))) return `status reports ${reported.join(', ')} as not run, but the contract expects ${expected.join(', ')} (D-35)`;
  return `status does not report ${expected.join(', ')} as not run: not required (D-35)`;
}

// What the start stage expects of a run that has to stop on the planted decision (D-02, D-03): the pause-origin decision of the owner-choice item is open at
// contract version 1, the items independent of it are done, the items that wait for it have not been delegated, and one notification was queued. With
// `checksNotRunExpected` the status must also report the checks that do not run (D-35, plan 03-54).
export function judgeStart(facts: {
  state: string;
  reason: string | null;
  items: Json[];
  decisions: Json[];
  attempts: Json[];
  notifications: Json[];
  askUserQuestion: number;
  hostConfigDir: Json | null | undefined;
  statusView?: unknown;
  checksNotRunExpected?: readonly string[];
}): string[] {
  const problems: string[] = [];
  if (facts.state !== 'blocked_on_decision') problems.push(`the run stopped ${facts.state}${facts.reason !== null ? ` (${facts.reason})` : ''}, not blocked_on_decision (D-03)`);
  else if (facts.reason !== 'decision') problems.push(`the run is blocked for ${facts.reason}, not for a decision`);
  const open = facts.decisions.filter((d) => d['state'] === 'open');
  if (facts.decisions.length !== 1 || open.length !== 1) problems.push(`the run has ${facts.decisions.length} decision(s), ${open.length} open; D-02 wants exactly one, open`);
  const decision = open[0] ?? facts.decisions[0];
  // The decision lists the owner-choice item and the items that wait for its answer; only the item that asked has to be blocked on it.
  const asked = decision === undefined ? undefined : ownerChoiceItemOf(decision, facts.attempts);
  const planted = asked === undefined ? [] : [asked];
  if (decision !== undefined) {
    if (asked === undefined) problems.push(`cannot tell which item asked: no attempt of the run parked for decision ${String(decision['decisionId'])} on an item it affects`);
    const origin = isObject(decision['origin']) ? decision['origin'] : {};
    if (origin['origin'] !== 'pause') problems.push(`the decision's origin is ${JSON.stringify(origin['origin'])}, not the unit's own pause (a silent pick caught by G1 is an exit failure, D-02)`);
    if (decision['contractVersion'] !== 1) problems.push(`the decision is at contract version ${String(decision['contractVersion'])}, not 1`);
    const choices = asObjects(decision['options']).filter((o) => o['kind'] === 'choice');
    if (choices.length < 2) problems.push(`the decision lists ${choices.length} choice option(s), not the two wordings`);
  }
  const waiting = new Set<string>();
  for (let round = 0; round < facts.items.length; round += 1) {
    for (const i of facts.items) {
      if ((i['dependsOn'] as string[]).some((d) => planted.includes(d) || waiting.has(d))) waiting.add(String(i['itemId']));
    }
  }
  for (const i of facts.items) {
    const id = String(i['itemId']);
    if (planted.includes(id)) {
      if (i['state'] !== 'blocked_on_decision') problems.push(`item ${id} (the owner-choice item) is ${String(i['state'])}, not blocked_on_decision`);
    } else if (waiting.has(id)) {
      if (i['attempts'] !== 0 || i['state'] === 'done') problems.push(`item ${id} waits for the decision but is ${String(i['state'])} with ${String(i['attempts'])} attempt(s)`);
    } else if (i['state'] !== 'done') problems.push(`item ${id} is independent of the decision and is ${String(i['state'])}, not done`);
  }
  if (facts.notifications.length !== 1) problems.push(`the run has ${facts.notifications.length} notification row(s), not one`);
  if (facts.askUserQuestion !== 0) problems.push(`the transcripts have ${facts.askUserQuestion} AskUserQuestion call(s) (S-12)`);
  // Plan 03-43: a run started by the fixed code records the host configuration directory every later supervisor uses; without it the resume would depend on the
  // owner's terminal environment again.
  const dir = facts.hostConfigDir?.['claudeConfigDir'];
  if (typeof dir !== 'string' || dir === '') problems.push('the run recorded no host configuration directory (the fix of plan 03-43 did not run)');
  const notRun = checksNotRunProblem(facts.statusView, facts.checksNotRunExpected);
  if (notRun !== undefined) problems.push(notRun);
  return problems;
}

// What the authorization's `expects` makes of a contract above version 1 (plan 03-54; D-28, SC3, SC4). Only run 2 (`amend-stale`) is expected to be amended, once, to
// contract version 2 by the owner with a reason and a diff that names files.write; for every other expectation an amendment is a problem, with no relax and no
// in-place amendment.
export function amendmentProblemsOf(expects: string, contract: { version?: unknown; authorizedBy?: unknown; reason?: unknown; diff?: unknown } | null | undefined, owner: string): string[] {
  const version = contract === undefined || contract === null ? 1 : Number(contract.version);
  if (expects !== 'amend-stale') return version > 1 ? [`the contract was amended (version ${version}); only run 2 expects an amendment (D-28)`] : [];
  if (contract === undefined || contract === null || !(version > 1)) return ["no amendment: the contract is still at version 1, and run 2 expects the owner's amendment (SC3, SC4)"];
  const problems: string[] = [];
  if (version !== 2) problems.push(`the contract was amended to version ${version}: run 2 expects exactly one amendment, contract version 2 (D-28)`);
  if (contract.authorizedBy !== `owner:${owner}`) problems.push(`the amendment's authorized_by is ${JSON.stringify(contract.authorizedBy ?? null)}, not owner:${owner}`);
  if (typeof contract.reason !== 'string' || contract.reason.trim() === '') problems.push('the amendment records no reason');
  if (!Array.isArray(contract.diff) || !contract.diff.some((d) => isObject(d) && d['path'] === 'files.write')) problems.push("the amendment's diff does not name files.write");
  return problems;
}

// The stale original of run 2 and its answered successor (plan 03-54; SC3, SC4): the original pause decision went stale at the amendment with its answer kept, and the one
// answered decision supersedes it. `answered` is the decisions the owner answered; the successor is the first of them, the one whose item the resume check follows.
function staleProblemsOf(decisions: readonly Json[], answered: readonly Json[]): string[] {
  const stale = decisions.filter((d) => d['state'] === 'stale');
  if (stale.length === 0) return ['no decision is stale: run 2 expects its original pause decision to go stale at the amendment (SC3)'];
  const problems: string[] = [];
  for (const d of stale) if (d['answer'] === null || d['answer'] === undefined) problems.push(`the stale decision ${String(d['decisionId'])} has no answer kept (SC3)`);
  const successor = answered[0];
  if (successor !== undefined && !stale.some((d) => d['decisionId'] === successor['supersedes'])) problems.push(`the answered decision ${String(successor['decisionId'])} does not supersede the stale decision ${stale.map((d) => String(d['decisionId'])).join(', ')} (SC3)`);
  return problems;
}

// What the finish stage expects after the owner's answer: the owner-choice item resumed its own session, every item is done and committed, and the run is
// ready for review on verified evidence (D-03 run 1, SC1, SC3). The resume facts carry the run's recorded host configuration directory (plan 03-43); the session
// checks do not depend on it.
export function judgeFinish(facts: {
  state: string;
  items: Json[];
  decisions: Json[];
  attempts: Json[];
  invocations: Json[];
  pauseSessions: Record<string, string | null>;
  requiredChecks: Json[];
  acceptance: Json[];
  commit: string | null;
  clean: boolean | null;
  gates: Json[];
  commits: Json[];
  askUserQuestion: number;
  owner: string;
  hostConfigDir?: Json | null;
  // The decisions that paused the run at the start stage; an open decision outside them is a second stop (plan 03-46). Absent: every open decision is one.
  pauseDecisionIds?: readonly string[];
  // Plan 03-49: the owner's relaxation of D-03 for this run, as the `relax` subcommand wrote it into the entry: `{ by: 'owner', ref, decisions, at }`. Only through
  // it is a decision beyond the one that paused the run accepted, and then only when the owner answered it on the terminal.
  relax?: unknown;
  // Plan 03-52 (D-28): false in the exit under D-26..D-35. A relax record in the entry is then a problem and relaxes nothing: every decision and amendment is judged as if
  // there were none. Absent (or true): the plan 03-49 rules above.
  relaxAllowed?: boolean;
  // The latest contract of the run: `{ version, authorizedBy, reason, diff }`. A version above 1 is an amendment, accepted only under a valid relax record, as
  // contract version 2, authorized by the owner, with a reason and a diff. Absent: nothing about amendments is judged.
  contract?: { version?: unknown; authorizedBy?: unknown; reason?: unknown; diff?: unknown } | null;
  // Plan 03-54 (D-28): what the authorization expects of this run, copied into the entry by the start stage: `amend-stale` (run 2), `block-resume` (run 1) or `silence`
  // (run 3). Present, it replaces the relax-based amendment rule with the role rule: only `amend-stale` is amended, and then once, to version 2, by the owner, with a
  // reason and a files.write diff, the original pause decision stale with its answer kept and its successor the one answered decision. A relax record is never accepted.
  // Absent: the plan 03-49 rules.
  expects?: string;
  // Plan 03-54 (D-35): the declared checks the run's contract does not run (checksNotRun), and the status view the run was read with. The status must report exactly these.
  checksNotRunExpected?: readonly string[];
  statusView?: unknown;
}): { problems: string[]; resume: Json } {
  const problems: string[] = [];
  const expecting = facts.expects !== undefined;
  const relaxAllowed = facts.relaxAllowed !== false && !expecting;
  if (!relaxAllowed && facts.relax !== undefined && facts.relax !== null) problems.push('a relax record is not accepted in the exit (D-28)');
  const relaxed: { record?: RelaxRecord; problem?: string } = relaxAllowed ? relaxOf(facts.relax) : {};
  if (relaxed.problem !== undefined) problems.push(relaxed.problem);
  const relaxedIds = new Set(relaxed.record?.decisions ?? []);
  if (facts.state !== 'ready_for_review') problems.push(`the run ended ${facts.state}, not ready_for_review (D-03)`);
  // A run the owner answered that stopped again on another open decision (plan 03-46, the 03-45 run 1 stop at G2): the stop is named, and the judgement goes on.
  for (const d of facts.decisions.filter((x) => x['state'] === 'open' && !(facts.pauseDecisionIds ?? []).includes(String(x['decisionId'])))) {
    const origin = isObject(d['origin']) ? String(d['origin']['origin']) : 'unknown';
    problems.push(`the run stopped again on decision ${String(d['decisionId'])} (${String(d['class'])}, origin ${origin}) after the owner's answer`);
  }
  // The decisions the owner's relax record names are judged by their own rules; the rest are counted as before.
  if (relaxed.record !== undefined) {
    const named = relaxed.record.decisions.map((id) => ({ id, decision: facts.decisions.find((d) => d['decisionId'] === id) }));
    for (const { id, decision: d } of named) {
      if (d === undefined) problems.push(`the relax record names decision ${id}, which the run does not have`);
      else if (d['state'] !== 'answered' && d['state'] !== 'stale') problems.push(`the relaxed decision ${id} is ${String(d['state'])}, not answered by the owner`);
      else if (d['answeredBy'] !== `owner:${facts.owner}`) problems.push(`the relaxed decision ${id} was answered by ${JSON.stringify(d['answeredBy'])}, not owner:${facts.owner}`);
      else if (d['answerChannel'] !== 'terminal') problems.push(`the relaxed decision ${id} was answered on channel ${JSON.stringify(d['answerChannel'])}, not terminal`);
    }
    if (named.every((n) => n.decision !== undefined) && !named.some((n) => n.decision?.['state'] === 'answered')) problems.push('the relax record names no decision the owner answered');
  }
  if (facts.expects !== undefined) problems.push(...amendmentProblemsOf(facts.expects, facts.contract, facts.owner));
  else if (facts.contract !== undefined && facts.contract !== null && Number(facts.contract.version) > 1) {
    const version = Number(facts.contract.version);
    if (relaxed.record === undefined) problems.push(`the contract was amended (version ${version}) without a valid relax record: an amendment is accepted only when the owner relaxed D-03 for this run`);
    else {
      if (version !== 2) problems.push(`the contract was amended to version ${version}: an amendment is accepted only as contract version 2`);
      if (facts.contract.authorizedBy !== `owner:${facts.owner}`) problems.push(`the amendment's authorized_by is ${JSON.stringify(facts.contract.authorizedBy ?? null)}, not owner:${facts.owner}`);
      if (typeof facts.contract.reason !== 'string' || facts.contract.reason.trim() === '') problems.push('the amendment records no reason');
      if (!Array.isArray(facts.contract.diff) || facts.contract.diff.length === 0) problems.push('the amendment records no diff');
    }
  }
  const answered = facts.decisions.filter((d) => d['state'] === 'answered' && !relaxedIds.has(String(d['decisionId'])));
  if (answered.length !== 1) problems.push(`${answered.length} decision(s) are answered, not one`);
  if (facts.expects === 'amend-stale') problems.push(...staleProblemsOf(facts.decisions, answered));
  const decision = answered[0];
  const resume: Json = { resumed: false, hostConfigDir: facts.hostConfigDir ?? null };
  if (relaxed.record !== undefined) resume['relax'] = relaxed.record;
  if (decision !== undefined) {
    if (decision['answerChannel'] !== 'terminal') problems.push(`the answer arrived on channel ${JSON.stringify(decision['answerChannel'])}, not terminal`);
    if (decision['answeredBy'] !== `owner:${facts.owner}`) problems.push(`the answer was given by ${JSON.stringify(decision['answeredBy'])}, not owner:${facts.owner}`);
    const itemId = ownerChoiceItemOf(decision, facts.attempts) ?? '?';
    if (itemId === '?') problems.push(`cannot tell which item asked: no attempt of the run parked for decision ${String(decision['decisionId'])} on an item it affects`);
    const pauseSession = facts.pauseSessions[itemId] ?? null;
    const item = facts.items.find((i) => i['itemId'] === itemId);
    const attempt = facts.attempts.filter((a) => a['itemId'] === itemId && a['reason'] === 'resume').at(-1);
    const invocation = attempt === undefined ? undefined : facts.invocations.filter((i) => i['attemptId'] === attempt['attemptId']).at(-1);
    resume['itemId'] = itemId;
    resume['sessionAtPause'] = pauseSession;
    resume['sessionAfter'] = item?.['gsdSession'] ?? null;
    resume['attempt'] = attempt ?? null;
    resume['invocationRequestedSession'] = invocation?.['requestedSession'] ?? null;
    resume['invocationInitSessions'] = invocation?.['initSessions'] ?? [];
    resume['answeredDecisionId'] = invocation?.['answeredDecisionId'] ?? null;
    if (attempt === undefined) problems.push(`item ${itemId} has no attempt with reason resume: its session was not resumed (a fresh unit with the answer does not count)`);
    else if (pauseSession === null) problems.push(`the start stage recorded no session for item ${itemId}`);
    else {
      const sessions = resume['invocationInitSessions'] as string[];
      const same = resume['sessionAfter'] === pauseSession && resume['invocationRequestedSession'] === pauseSession && sessions.length > 0 && sessions.every((s) => s === pauseSession);
      resume['resumed'] = same;
      if (!same) problems.push(`the resume attempt's session does not equal the session recorded at delegation (${pauseSession}): item ${String(resume['sessionAfter'])}, requested ${String(resume['invocationRequestedSession'])}, host init ${JSON.stringify(sessions)}`);
    }
  }
  for (const i of facts.items) {
    if (i['state'] !== 'done') problems.push(`item ${String(i['itemId'])} is ${String(i['state'])}, not done`);
    if (!facts.commits.some((c) => c['itemId'] === i['itemId'])) problems.push(`item ${String(i['itemId'])} has no commit step`);
  }
  for (const c of facts.requiredChecks) if (c['status'] !== 'passed' && c['preExisting'] !== true) problems.push(`required check ${String(c['name'])} is ${String(c['status'])} at the final revision`);
  for (const a of facts.acceptance) if (a['satisfied'] !== true) problems.push(`acceptance criterion ${String(a['id'])} has no passed deterministic evidence`);
  if (facts.clean !== true) problems.push('the final evidence was not taken on a clean tree');
  if (facts.commit === null) problems.push('no handed-off commit');
  if (!facts.gates.some((g) => g['gate'] === 'G4' && g['passed'] === true)) problems.push('gate G4 did not pass');
  if (facts.askUserQuestion !== 0) problems.push(`the transcripts have ${facts.askUserQuestion} AskUserQuestion call(s) (S-12)`);
  const notRun = checksNotRunProblem(facts.statusView, facts.checksNotRunExpected);
  if (notRun !== undefined) problems.push(notRun);
  return { problems, resume };
}

// ---------------------------------------------------------------------------------------------------------------
// The exit record (plan 03-54; D-26, D-28, D-34, T-03-138). `exitVerdict` says 3 of 3 only when each role of the authorization's order has a clean run in the current epoch.
// A correct stop is evidence and never a pass (D-28); a superseded run kept by `supplement` is supplementary and never counts (D-34).
// ---------------------------------------------------------------------------------------------------------------

const EXIT_RUN_COUNT = 3;

export interface ExitVerdict {
  verdict: string;
  // The clean run counted for each role, in the authorization's order.
  counted: Array<{ role: string; runId: string; attempt: number }>;
  // Every stopped attempt the owner confirmed as a brief/harness defect while Claude's proposal said docs/system conformant: evidence that does not count.
  correctStops: Json[];
  // Every other entry that is not counted, with the reason.
  notCounted: Array<{ runId: string; role: string | null; attempt: number | null; reason: string }>;
}

// What keeps a finished entry from being its role's clean run (D-26, D-28): it passed with no problem, ended ready_for_review with the paused item resumed in its own
// session, every decision is of pause origin, the checkout digests are equal and only the run's own branch was added; run 2 (`amend-stale`) ended on contract version 2 with
// a stale decision, run 3 (`silence`) recorded a silence block with no problem. Empty when it is clean.
function unmetOf(entry: Json, expects: unknown): string[] {
  const unmet: string[] = [];
  const runId = String(entry['runId'] ?? '');
  if (entry['passed'] !== true) unmet.push('did not pass');
  const problems = entry['problems'];
  if (!Array.isArray(problems) || problems.length > 0) unmet.push(`lists ${Array.isArray(problems) ? problems.length : 'unreadable'} problem(s)`);
  if (entry['finalState'] !== 'ready_for_review') unmet.push(`ended ${String(entry['finalState'] ?? 'unrecorded')}, not ready_for_review`);
  if (entry['resumed'] !== true) unmet.push('the paused item did not resume its own session');
  const decisions = asObjects(entry['decisions']);
  const notPause = decisions.filter((d) => !(isObject(d['origin']) && d['origin']['origin'] === 'pause'));
  if (notPause.length > 0) unmet.push(`decision ${notPause.map((d) => String(d['decisionId'])).join(', ')} is not of pause origin: the unit did not ask it itself (D-02)`);
  const checkout = isObject(entry['checkout']) ? entry['checkout'] : {};
  const own = `refs/heads/avarice/${runId}`;
  const added = Array.isArray(checkout['newRefs']) ? checkout['newRefs'] : [];
  const changed = Array.isArray(checkout['removedOrChangedRefs']) ? checkout['removedOrChangedRefs'] : [];
  if (checkout['equal'] !== true) unmet.push('the checkout digests differ before and after');
  if (changed.length > 0) unmet.push(`refs were removed or changed: ${changed.join(', ')}`);
  if (added.length !== 1 || added[0] !== own) unmet.push(`the refs added are ${JSON.stringify(added)}, not only the run branch ${own}`);
  if (expects === 'amend-stale') {
    const contract = isObject(entry['contract']) ? entry['contract'] : {};
    if (Number(contract['version']) !== 2) unmet.push(`run 2 expects contract version 2 (amend-stale), found version ${String(contract['version'] ?? 'unrecorded')}`);
    if (!decisions.some((d) => d['state'] === 'stale')) unmet.push('run 2 expects its original pause decision to be stale, and no decision is');
  }
  if (expects === 'silence') {
    const silence = isObject(entry['silence']) ? entry['silence'] : undefined;
    if (silence === undefined || !Array.isArray(silence['problems']) || silence['problems'].length > 0) unmet.push('run 3 expects a silence block with no problem, and the entry has none');
  }
  return unmet;
}

// A correct stop (D-28): a stopped attempt the owner confirmed as a brief/harness defect while Claude's proposal said AVARICE behaved as docs/system documents. It is
// evidence of the exit, and it never counts as one of the three.
function correctStopOf(entry: Json): Json | undefined {
  const confirmed = confirmedOf(entry);
  if (entry['passed'] === true || confirmed?.['class'] !== 'brief-harness-defect') return undefined;
  const classification = entry['classification'];
  const proposed = isObject(classification) && isObject(classification['proposed']) ? classification['proposed'] : undefined;
  const docs = proposed !== undefined && isObject(proposed['docsSystem']) ? proposed['docsSystem'] : undefined;
  if (proposed === undefined || docs === undefined || docs['conformant'] !== true) return undefined;
  return {
    runId: entry['runId'] ?? null,
    role: entry['run'] ?? null,
    attempt: entry['attempt'] ?? null,
    class: confirmed['class'],
    stoppedBy: proposed['stoppedBy'] ?? null,
    at: proposed['at'] ?? null,
    docsRef: docs['ref'] ?? null,
    summary: proposed['summary'] ?? null,
    confirmedRef: confirmed['ref'] ?? null,
    confirmedAt: confirmed['at'] ?? null,
  };
}

// The verdict of an evidence file against the owner's authorization (D-26, D-28, D-34). For each role of the authorization's order, the clean run counted is the latest
// attempt started in the current epoch that meets every condition of unmetOf, judged against the expectation the authorization gives the role. The supplementary list
// and every stop are read for nothing but their listing. `exit: 3/3 ready_for_review` only when three roles are counted.
export function exitVerdict(evidence: Json, auth: Pick<Authorization, 'order' | 'briefs'>): ExitVerdict {
  const entries = asObjects(evidence['runs']);
  const epoch = epochOf(evidence);
  const epochMs = epoch === null ? Number.NEGATIVE_INFINITY : Date.parse(epoch);
  const expectsOf = (role: string): unknown => auth.briefs.find((b) => b['run'] === role)?.['expects'];
  const counted: ExitVerdict['counted'] = [];
  const countedIds = new Set<string>();
  for (const role of auth.order) {
    const clean = entries.filter((e) => e['run'] === role && startedMs(e) >= epochMs && unmetOf(e, expectsOf(role)).length === 0);
    const best = latestAttempt(clean);
    if (best !== undefined) {
      counted.push({ role, runId: String(best['runId']), attempt: Number(best['attempt'] ?? 0) });
      countedIds.add(String(best['runId']));
    }
  }
  const correctStops: Json[] = [];
  const notCounted: ExitVerdict['notCounted'] = [];
  for (const entry of entries) {
    const runId = String(entry['runId'] ?? '');
    if (countedIds.has(runId)) continue;
    const stop = correctStopOf(entry);
    if (stop !== undefined) {
      correctStops.push(stop);
      continue;
    }
    const role = typeof entry['run'] === 'string' ? entry['run'] : null;
    const attempt = typeof entry['attempt'] === 'number' ? entry['attempt'] : null;
    let reason: string;
    const confirmed = confirmedOf(entry);
    if (role === null || !auth.order.includes(role)) reason = 'not a run of the authorization (D-28)';
    else if (entry['passed'] === true) {
      const unmet = unmetOf(entry, expectsOf(role));
      if (startedMs(entry) < epochMs) reason = `passed before the epoch that began at ${String(epoch)}, when the owner confirmed a product defect: every run passes again (D-26)`;
      else if (unmet.length > 0) reason = `does not count: ${unmet.join('; ')}`;
      else reason = `a later attempt of ${role} is the one counted`;
    } else if (confirmed === undefined) reason = isFailedAttempt(entry) ? 'stopped with no owner-confirmed classification (D-26, D-27)' : 'no outcome yet: the attempt still waits for the owner';
    else if (confirmed['class'] === 'product-defect') reason = 'owner-confirmed product defect: it starts a new epoch and every run passes again (D-26)';
    else reason = 'owner-confirmed brief/harness defect, but the proposal does not say docs/system is conformant, so it is not a correct stop (D-27)';
    notCounted.push({ runId, role, attempt, reason });
  }
  // 3/3 needs the three roles of an order of exactly three; anything less never reads as complete, whatever else was counted.
  const complete = counted.length === EXIT_RUN_COUNT && auth.order.length === EXIT_RUN_COUNT && counted.every((c) => auth.order.includes(c.role));
  return { verdict: `exit: ${complete ? EXIT_RUN_COUNT : Math.min(counted.length, EXIT_RUN_COUNT - 1)}/${EXIT_RUN_COUNT} ready_for_review`, counted, correctStops, notCounted };
}

const isCompleteVerdict = (verdict: string): boolean => verdict === `exit: ${EXIT_RUN_COUNT}/${EXIT_RUN_COUNT} ready_for_review`;

// An evidence file, or undefined when it is missing or not JSON of an object.
function readEvidenceFile(path: string): Json | undefined {
  try {
    return readJson(path);
  } catch {
    return undefined;
  }
}

// The evidence file with top-level keys set: this tool's writer keeps every other key (evidenceFileBody), the file's own plan and decision are kept as they were, and the
// write goes through a temporary file and a rename.
function writeEvidenceKeys(path: string, file: Json, patch: Json, now: string): void {
  const base = evidenceFileBody(file, typeof file['plan'] === 'string' ? file['plan'] : livePlan(), asObjects(file['runs']), now);
  if (file['decision'] !== undefined) base['decision'] = file['decision'];
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...base, ...patch }, null, 2)}\n`);
  renameSync(temporary, path);
}

// `verdict --evidence F --authorization-file A`: writes `verdict`, `verdictRuns` (role, runId, attempt), `correctStops` and `verdictAt` as top-level keys, keeping every other
// key. Exit 0 for `exit: 3/3 ready_for_review`, 1 for any other verdict; 2 and nothing written for a missing flag, an unreadable file or an authorization that authorizes nothing.
function verdictCommand(argv: readonly string[]): number {
  const { named } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: verdict: ${text}`);
    return 2;
  };
  const missing = ['evidence', 'authorization-file'].filter((k) => named[k] === undefined);
  if (missing.length > 0) return refuse(`usage: verdict needs --${missing.join(' --')}`);
  const auth = authorizationOf(named['authorization-file'] as string);
  if (typeof auth === 'string') return refuse(auth);
  const path = resolve(named['evidence'] as string);
  const file = readEvidenceFile(path);
  if (file === undefined) return refuse(`${named['evidence']} is not an evidence file`);
  const result = exitVerdict(file, auth);
  const now = new Date().toISOString();
  writeEvidenceKeys(path, file, { verdict: result.verdict, verdictRuns: result.counted, correctStops: result.correctStops, verdictAt: now }, now);
  out(`${result.verdict}\n`);
  for (const c of result.counted) out(`counted: ${c.role} ${c.runId} (attempt ${c.attempt})\n`);
  for (const s of result.correctStops) out(`correct stop, evidence that does not count (D-28): ${String(s['role'])} ${String(s['runId'])} stopped at ${String(s['stoppedBy'])}\n`);
  for (const n of result.notCounted) out(`not counted: ${n.role ?? '?'} ${n.runId}: ${n.reason}\n`);
  out(`evidence ${path}\n`);
  return isCompleteVerdict(result.verdict) ? 0 : 1;
}

// A superseded run's facts as the supplementary record of the exit (D-34): what the run did, kept for the owner and never counted toward the three.
export function supplementRecordOf(entry: Json, fromFile: string, note: string): Json {
  return {
    runId: entry['runId'],
    fromFile,
    brief: entry['brief'] ?? null,
    briefDigest: entry['briefDigest'] ?? null,
    items: Array.isArray(entry['items']) ? entry['items'] : [],
    decisions: asObjects(entry['decisions']).map((d) => ({
      id: d['decisionId'] ?? null,
      state: d['state'] ?? null,
      class: d['class'] ?? null,
      origin: isObject(d['origin']) ? (d['origin']['origin'] ?? null) : null,
      answeredBy: d['answeredBy'] ?? null,
      answerChannel: d['answerChannel'] ?? null,
    })),
    resume: entry['resume'] ?? null,
    problems: Array.isArray(entry['problems']) ? entry['problems'] : [],
    checkout: entry['checkout'] ?? null,
    costUsd: entry['costUsd'] ?? null,
    note,
    countsToward3of3: false,
  };
}

// `supplement --evidence F --from OTHER --run-id R --note TEXT`: appends the facts of run R in OTHER to the top-level `supplementary` list of F, marked
// `countsToward3of3: false`. Exit 2 and the file byte-identical for a missing flag, an empty note, a file that is not an evidence file, a run that is an entry of F, a run OTHER
// does not hold and a run already supplementary.
function supplementCommand(argv: readonly string[]): number {
  const { named } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: supplement: ${text}`);
    return 2;
  };
  const missing = ['evidence', 'from', 'run-id', 'note'].filter((k) => named[k] === undefined);
  if (missing.length > 0) return refuse(`usage: supplement needs --${missing.join(' --')}`);
  const runId = named['run-id'] as string;
  const note = (named['note'] as string).trim();
  if (note === '') return refuse('--note is empty: say why the run is kept as supplementary evidence (D-34)');
  const path = resolve(named['evidence'] as string);
  const file = readEvidenceFile(path);
  if (file === undefined) return refuse(`${named['evidence']} is not an evidence file`);
  const fromPath = resolve(named['from'] as string);
  const other = readEvidenceFile(fromPath);
  if (other === undefined) return refuse(`${named['from']} is not an evidence file`);
  if (asObjects(file['runs']).some((r) => r['runId'] === runId)) return refuse(`${runId} is an entry of the evidence file: a run that counts is not supplementary evidence (D-34)`);
  const entry = asObjects(other['runs']).find((r) => r['runId'] === runId);
  if (entry === undefined) return refuse(`${named['from']} holds no entry for ${runId}`);
  const held = asObjects(file['supplementary']);
  if (held.some((r) => r['runId'] === runId)) return refuse(`${runId} is already supplementary evidence in the file (D-34): it is recorded once`);
  const relativeFrom = relative(REPO_ROOT, fromPath);
  const record = supplementRecordOf(entry, relativeFrom.startsWith('..') ? fromPath : relativeFrom, note);
  writeEvidenceKeys(path, file, { supplementary: [...held, record] }, new Date().toISOString());
  out(`supplement: ${runId} from ${String(record['fromFile'])} kept as supplementary evidence; it counts toward nothing (D-34)\n`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Run 3's silence (plan 03-54; SC2, AUT-4, AUT-6, T-03-136). The run blocks on its decision while the notifier is down. After the batch window and a digest, the decision must
// still be open and unanswered, and still be listed by inbox and status: a failed banner, a failed digest and the passing of time answer nothing. The step reads the
// owner's ledger read-only and runs `avarice digest` once; it never answers, amends, resumes or cancels anything.
// ---------------------------------------------------------------------------------------------------------------

const SILENCE_WAIT_MAX_MINUTES = 10;
const SILENCE_MARGIN_SECONDS = 15;
// The error code of a banner the local notifier could not deliver because osascript is not there (src/adapters/notify/local-notifier.ts).
const BANNER_ERROR = 'osascript-missing';
const ANSWER_COLUMNS = ['answeredAt', 'answeredBy', 'answer', 'answerChannel'] as const;

const isBlockingBanner = (row: Json): boolean => row['kind'] === 'decisions';
const answerColumnsSet = (decision: Json | undefined): string[] => ANSWER_COLUMNS.filter((key) => decision !== undefined && decision[key] !== null && decision[key] !== undefined);
const latestByCreatedAt = (rows: readonly Json[]): Json | undefined => [...rows].sort((a, b) => String(a['createdAt'] ?? '').localeCompare(String(b['createdAt'] ?? ''))).at(-1);

// What the silence judge reads: the run's notification rows, the digest rows that cover the decision, the decision row, the inbox's view of the decision, the run's status
// state, the batch window the profile sets and the seconds that passed between the block and the digest.
export interface SilenceFacts {
  notifications: Json[];
  digestRows: Json[];
  decision: Json | undefined;
  inboxDecision: Json | undefined;
  statusState: string | undefined;
  batchWindowMinutes: number;
  elapsedSeconds: number;
}

// Run 3's expectation (SC2): every blocking banner failed with the missing osascript, the digest failed, the decision is open with all four answer columns null, inbox lists
// it with a failed banner, status shows the run blocked on it, and at least the batch window plus 15 seconds passed since the block. [] when all of it holds.
export function judgeSilence(facts: SilenceFacts): string[] {
  const problems: string[] = [];
  const banners = facts.notifications.filter(isBlockingBanner);
  if (banners.length === 0) problems.push('the run has no blocking banner row: the stop raised none, so no failed delivery was recorded (AUT-6)');
  for (const banner of banners) {
    const id = String(banner['notificationId'] ?? '?');
    if (banner['state'] === 'delivered') problems.push(`blocking banner ${id} was delivered: the notifier was not down (SC2)`);
    else if (banner['state'] !== 'failed') problems.push(`blocking banner ${id} is ${String(banner['state'])}, not failed: its delivery attempts are not final`);
    else if (banner['lastError'] !== BANNER_ERROR) problems.push(`blocking banner ${id} failed with ${JSON.stringify(banner['lastError'] ?? null)}, not ${BANNER_ERROR}`);
  }
  const digest = latestByCreatedAt(facts.digestRows);
  if (digest === undefined) problems.push('no digest row covers the decision: the digest after the batch window recorded none (AUT-6)');
  else if (digest['state'] !== 'failed') problems.push(`the digest row ${String(digest['notificationId'] ?? '?')} is ${String(digest['state'])}, not failed`);
  if (facts.decision === undefined) problems.push('the decision row cannot be read from the ledger');
  else {
    const set = answerColumnsSet(facts.decision);
    if (facts.decision['state'] !== 'open' || set.length > 0) problems.push(`the decision ${String(facts.decision['decisionId'] ?? '?')} is not open and unanswered: state ${String(facts.decision['state'])}, answer columns set: ${set.join(', ') || 'none'} (AUT-4)`);
  }
  if (facts.inboxDecision === undefined) problems.push('inbox does not list the decision (AUT-6)');
  else {
    const notification = isObject(facts.inboxDecision['notification']) ? facts.inboxDecision['notification'] : undefined;
    if (notification?.['state'] !== 'failed') problems.push(`inbox lists the decision with notification state ${String(notification?.['state'] ?? 'none')}, not failed (AUT-6)`);
  }
  if (facts.statusState !== 'blocked_on_decision') problems.push(`status shows ${facts.statusState ?? 'no run'}, not blocked_on_decision (SC2)`);
  const needed = facts.batchWindowMinutes * 60 + SILENCE_MARGIN_SECONDS;
  if (!(facts.elapsedSeconds >= needed)) problems.push(`only ${Math.floor(facts.elapsedSeconds)} s have passed since the block; the batch window of ${facts.batchWindowMinutes} min plus ${SILENCE_MARGIN_SECONDS} s needs ${needed} s (SC2)`);
  return problems;
}

// The reads and the one write (the digest the CLI runs) the step is made of, so a test can play them without a ledger, a notifier or a clock.
export interface SilenceSeams {
  read(): Omit<SilenceFacts, 'elapsedSeconds'>;
  digest(): { exit: number | null; stdout: string; stderr: string };
  nowMs(): number;
  pause(ms: number): Promise<void>;
}

const secondsSince = (decision: Json | undefined, nowMs: number): number => {
  const openedAt = Date.parse(String(decision?.['openedAt'] ?? ''));
  return Number.isFinite(openedAt) ? (nowMs - openedAt) / 1000 : 0;
};

// Waits (POLL_MS polls, no shell sleep and no sub-second timer) until every blocking banner row is final and the batch window plus 15 seconds has passed since the block,
// or the longest wait ends; runs the digest once; reads the rows again and judges them. The seconds judged are those that had passed when the digest was started.
export async function runSilence(seams: SilenceSeams, options: { maxWaitMs: number }): Promise<{ block: Json; problems: string[] }> {
  const giveUpAt = seams.nowMs() + options.maxWaitMs;
  let facts = seams.read();
  for (;;) {
    const banners = facts.notifications.filter(isBlockingBanner);
    const final = banners.length > 0 && banners.every((b) => b['state'] === 'failed' || b['state'] === 'delivered');
    const due = secondsSince(facts.decision, seams.nowMs()) >= facts.batchWindowMinutes * 60 + SILENCE_MARGIN_SECONDS;
    if ((final && due) || seams.nowMs() >= giveUpAt) break;
    await seams.pause(POLL_MS);
    facts = seams.read();
  }
  const waitedUntilMs = seams.nowMs();
  const elapsedSeconds = Math.floor(secondsSince(facts.decision, waitedUntilMs));
  const digest = seams.digest();
  const after = seams.read();
  const problems = judgeSilence({ ...after, elapsedSeconds });
  const set = answerColumnsSet(after.decision);
  const block: Json = {
    waitedUntil: new Date(waitedUntilMs).toISOString(),
    elapsedSeconds,
    batchWindowMinutes: after.batchWindowMinutes,
    digestExit: digest.exit,
    digestStdoutTail: digest.stdout.slice(-500),
    digestStderrTail: digest.stderr.slice(-500),
    decisionId: after.decision?.['decisionId'] ?? null,
    notifications: after.notifications,
    digestRow: latestByCreatedAt(after.digestRows) ?? null,
    decisionOpen: after.decision?.['state'] === 'open',
    answerColumnsNull: after.decision !== undefined && set.length === 0,
    inboxNotificationState: isObject(after.inboxDecision?.['notification']) ? (after.inboxDecision['notification']['state'] ?? null) : null,
    statusState: after.statusState ?? null,
    problems,
  };
  return { block, problems };
}

const notificationJson = (n: { notificationId: string; kind: string; destination: string; subjectIds: readonly string[]; state: string; attempts: number; lastError: string | null; createdAt: string; deliveredAt: string | null }): Json => ({
  notificationId: n.notificationId,
  kind: n.kind,
  destination: n.destination,
  subjectIds: [...n.subjectIds],
  state: n.state,
  attempts: n.attempts,
  lastError: n.lastError,
  createdAt: n.createdAt,
  deliveredAt: n.deliveredAt,
});

// The rows of the owner's ledger the judge reads, through the read-only composition: nothing here writes.
function readSilenceFacts(deps: AppDeps, projectId: string, runId: string, decisionId: string): Omit<SilenceFacts, 'elapsedSeconds'> {
  const own = deps.ledger.listNotifications({ runId });
  const every = deps.ledger.listNotifications();
  const decisions = deps.ledger.listDecisions({ runId });
  const decision = decisions.ok ? decisions.value.find((d) => d.decisionId === decisionId) : undefined;
  const inbox = getInbox(deps.ledger);
  const inboxDecision = inbox.ok ? inbox.value.decisions.find((d) => d.decisionId === decisionId) : undefined;
  const statuses = getRunStatuses(deps.ledger, projectId, deps.clock.nowMs());
  const settings = readProfileNotify(deps.profile.configHome, deps.profile.profile);
  return {
    notifications: own.ok ? own.value.map(notificationJson) : [],
    digestRows: every.ok ? every.value.filter((n) => n.kind === 'digest' && n.subjectIds.includes(decisionId)).map(notificationJson) : [],
    decision:
      decision === undefined
        ? undefined
        : { decisionId: decision.decisionId, state: decision.state, openedAt: decision.openedAt, answeredAt: decision.answeredAt, answeredBy: decision.answeredBy, answer: decision.answer, answerChannel: decision.answerChannel },
    inboxDecision: inboxDecision === undefined ? undefined : { decisionId: inboxDecision.decisionId, ...(inboxDecision.notification !== undefined ? { notification: { ...inboxDecision.notification } } : {}) },
    statusState: statuses.ok ? statuses.value.find((s) => s.runId === runId)?.state : undefined,
    batchWindowMinutes: settings.ok ? settings.value.batchWindowMinutes : NOTIFY_DEFAULTS.batchWindowMinutes,
  };
}

// `avarice digest` through this checkout's CLI under the environment the script exported (the owner's profile and the pinned host): the only write the step causes is the digest
// row it records. Its exit code and output are recorded and never judged as an answer.
function digestOnce(): { exit: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO_ROOT, 'bin', 'avarice.ts'), 'digest'], { encoding: 'utf8', env: process.env, cwd: REPO_ROOT, timeout: 300_000, maxBuffer: 1 << 24 });
  return { exit: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' };
}

// `silence --run-id R --authorization-file F --out EVIDENCE [--wait-max-minutes N]`: exit 0 only when the block it records lists no problem; 1 on a problem; 2 and nothing written
// for a missing flag, an authorization that authorizes nothing, a run the file has no start-stage record of, or an entry whose `expects` is not `silence`. Every refusal comes
// before the owner's profile is read.
async function silenceCommand(argv: readonly string[]): Promise<number> {
  const { named } = flags(argv);
  const refuse = (text: string): number => {
    errOut(`exit-run: silence: ${text}`);
    return 2;
  };
  const need = ['run-id', 'authorization-file', 'out'];
  const missing = need.filter((k) => named[k] === undefined);
  if (missing.length > 0) return refuse(`usage: silence needs --${missing.join(' --')} [--wait-max-minutes N]`);
  const runId = named['run-id'] as string;
  const auth = authorizationOf(named['authorization-file'] as string);
  if (typeof auth === 'string') return refuse(`refusing to spend: ${auth}`);
  const outPath = resolve(named['out'] as string);
  let file: Json | undefined;
  try {
    file = readJson(outPath);
  } catch {
    return refuse(`${named['out']} is not an evidence file`);
  }
  const priorRuns = asObjects(file?.['runs']);
  const prior = priorRuns.find((r) => r['runId'] === runId);
  if (prior === undefined) return refuse(`the evidence file holds no entry for ${runId}`);
  if (!isObject(prior['atPause']) || !isObject(prior['checkoutBeforeSnapshot'])) return refuse(`the evidence file has no start-stage record of ${runId}: nothing to wait on`);
  if (prior['expects'] !== 'silence') return refuse(`the entry of ${runId} expects ${JSON.stringify(prior['expects'] ?? null)}, not silence: only run 3 waits for the owner's silence`);
  const decisionId = pauseDecisionIdsOf(prior)[0];
  if (decisionId === undefined) return refuse(`the start-stage record of ${runId} names no pause decision to watch`);

  const composed = createDeps(process.env, {}, { readOnly: true });
  if (!composed.ok) {
    errOut(`exit-run: cannot read the profile: ${composed.message}`);
    return 1;
  }
  const deps = composed.value.deps;
  let result: { block: Json; problems: string[] };
  try {
    const run = deps.ledger.getRun(runId);
    if (!run.ok) {
      errOut(`exit-run: the run ${runId} is not in the ledger: ${describeError(run.error)}`);
      return 1;
    }
    const seams: SilenceSeams = {
      read: () => readSilenceFacts(deps, run.value.projectId, runId, decisionId),
      digest: digestOnce,
      nowMs: () => Date.now(),
      pause,
    };
    result = await runSilence(seams, { maxWaitMs: Number(named['wait-max-minutes'] ?? SILENCE_WAIT_MAX_MINUTES) * 60_000 });
  } finally {
    composed.value.close();
  }
  const entry: Json = { ...prior, silence: result.block };
  const runs = priorRuns.map((r) => (r['runId'] === runId ? entry : r));
  const body = evidenceFileBody(file, livePlan(), runs, new Date().toISOString());
  const temporary = `${outPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(temporary, outPath);
  out(`silence ${runId}: waited until ${String(result.block['waitedUntil'])}, ${String(result.block['elapsedSeconds'])} s after the block, digest exit ${String(result.block['digestExit'])}, decision ${result.block['decisionOpen'] === true ? 'open' : 'NOT open'}, ${result.problems.length} problem(s)\n`);
  for (const p of result.problems) out(`PROBLEM: ${p}\n`);
  out(`evidence ${outPath}\n`);
  return result.problems.length === 0 ? 0 : 1;
}

function snapshotCommand(argv: readonly string[]): number {
  const { named } = flags(argv);
  if (named['repo'] === undefined) {
    errOut('usage: snapshot --repo REPO');
    return 2;
  }
  out(`${JSON.stringify(snapshot(resolve(named['repo'])))}\n`);
  return 0;
}

function checkoutOf(before: Json, after: Json, runId: string, expectNewRun: boolean): { view: Json; problems: string[] } {
  const problems: string[] = [];
  const beforeComposite = isObject(before['digest']) ? compositeOf(before) : '';
  const afterComposite = isObject(after['digest']) ? compositeOf(after) : '';
  const beforeRefs = new Map(refsOfSnapshot(before).map((r) => [r.ref, r.object]));
  const afterRefs = new Map(refsOfSnapshot(after).map((r) => [r.ref, r.object]));
  const newRefs = [...afterRefs.keys()].filter((r) => !beforeRefs.has(r));
  const changedRefs = [...beforeRefs].filter(([r, o]) => afterRefs.get(r) !== o).map(([r]) => r);
  if (beforeComposite === '' || beforeComposite !== afterComposite) problems.push('the checkout digest (HEAD, branch, status, files, index, refs outside the run branches) differs before and after, or one is missing');
  if (changedRefs.length > 0) problems.push(`refs removed or changed: ${changedRefs.join(', ')}`);
  const own = `refs/heads/avarice/${runId}`;
  if (newRefs.some((r) => r !== own)) problems.push(`refs added other than the run's own branch: ${newRefs.join(', ')}`);
  if (expectNewRun && !newRefs.includes(own)) problems.push(`the run branch ${own} was not fetched into the checkout`);
  if (!expectNewRun && newRefs.length > 0) problems.push(`the run stopped before hand-off but refs were added: ${newRefs.join(', ')}`);
  const digestOf = (snap: Json): Json => {
    const d = isObject(snap['digest']) ? snap['digest'] : {};
    return { takenAt: snap['takenAt'], head: d['head'], branch: d['branch'], statusDigest: d['statusDigest'], filesDigest: d['filesDigest'], refsDigest: d['refsDigest'], counts: d['counts'], indexDigest: snap['indexDigest'], headRef: snap['headRef'], composite: snap['composite'] };
  };
  return { view: { before: digestOf(before), after: digestOf(after), equal: beforeComposite !== '' && beforeComposite === afterComposite, newRefs, removedOrChangedRefs: changedRefs, newRefObjects: newRefs.map((r) => ({ ref: r, object: afterRefs.get(r) })) }, problems };
}

async function waitForNextStop(deps: AppDeps, runId: string, maxMinutes: number, problems: string[]): Promise<void> {
  const giveUpAt = Date.now() + maxMinutes * 60_000;
  let idleSince: number | null = null;
  for (;;) {
    const read = deps.ledger.getRun(runId);
    if (!read.ok) {
      problems.push(`the run cannot be read while waiting: ${describeError(read.error)}`);
      return;
    }
    const open = deps.ledger.listDecisions({ runId, state: 'open' });
    const openCount = open.ok ? open.value.length : 0;
    const leaseLive = read.value.leaseHolder !== null && read.value.leaseExpiresAt !== null && Date.parse(read.value.leaseExpiresAt) >= deps.clock.nowMs();
    // `blocked_on_decision` with nothing open is the moment before the supervisor picks the answered item up; it is a stop only when a new decision is open
    // or the block is for another reason.
    if (isRunStopState(read.value.state) && (read.value.state !== 'blocked_on_decision' || openCount > 0 || read.value.reason !== 'decision')) return;
    if (read.value.state === 'blocked_on_decision' && !leaseLive) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > NO_SUPERVISOR_GRACE_MS) {
        problems.push('the run is still blocked_on_decision with no open decision and no supervisor holding it: nobody took the answered item up');
        return;
      }
    } else idleSince = null;
    if (Date.now() >= giveUpAt) {
      problems.push(`the run did not reach a stop state within ${maxMinutes} minutes (state ${read.value.state})`);
      return;
    }
    await pause(POLL_MS);
  }
}

async function evidenceCommand(argv: readonly string[]): Promise<number> {
  const { named } = flags(argv);
  const need = ['run-id', 'brief', 'repo', 'out', 'authorization-file'];
  const missing = need.filter((k) => named[k] === undefined);
  const stageName = named['stage'];
  if (missing.length > 0 || (stageName !== 'start' && stageName !== 'finish') || (stageName === 'start' && (named['before'] === undefined || named['after'] === undefined))) {
    errOut(`usage: evidence --stage start|finish needs --${need.join(' --')} (start also --before --after --start-exit --start-out [--start-err] [--started-at] [--rejudge-reason TEXT: judge a run already recorded again and keep the earlier judgement as history]; finish waits for the next stop and then takes the checkout snapshot itself)`);
    return 2;
  }
  const stage: 'start' | 'finish' = stageName;
  const runId = named['run-id'] as string;
  const outPath = resolve(named['out'] as string);
  const briefPath = resolve(named['brief'] as string);
  const auth = authorizationOf(named['authorization-file'] as string);
  if (typeof auth === 'string') {
    errOut(`exit-run: ${auth}`);
    return 2;
  }
  const repo = resolve(named['repo'] as string);
  let after: Json = stage === 'start' ? (readJson(resolve(named['after'] as string)) ?? {}) : {};
  const file = readJson(outPath) ?? {};
  const priorRuns = asObjects(file['runs']);
  const prior = priorRuns.find((r) => r['runId'] === runId);
  const problems: string[] = [];

  // Plan 03-53: a start is recorded under the run and attempt the authorization gives its brief; a brief it does not name is not recorded at all.
  const briefDigest = existsSync(briefPath) ? briefDigestOf(briefPath) : undefined;
  const identity = attemptFor(auth, briefDigest ?? '', priorRuns, runId);
  if (stage === 'start' && identity === undefined) {
    errOut(`exit-run: the brief ${named['brief']} (digest ${briefDigest ?? 'none: it does not parse'}) is not one of the briefs the owner approved: nothing was recorded`);
    return 2;
  }

  if (stage === 'finish' && (prior === undefined || !isObject(prior['atPause']) || !isObject(prior['checkoutBeforeSnapshot']))) {
    errOut(`exit-run: the evidence file has no start-stage record of ${runId}: nothing to finish`);
    return 2;
  }
  const before: Json = stage === 'start' ? (readJson(resolve(named['before'] as string)) ?? {}) : ((prior as Json)['checkoutBeforeSnapshot'] as Json);

  const composed = createDeps(process.env, {}, { readOnly: true });
  if (!composed.ok) {
    errOut(`exit-run: cannot read the profile: ${composed.message}`);
    return 1;
  }
  const deps = composed.value.deps;
  let entry: Json = {};
  let state = 'unknown';
  try {
    if (stage === 'finish') {
      // The owner has answered, and the supervisor the decide command started takes the run on. The decision that paused the run at the start stage still
      // open means the owner has not answered yet; another open decision is a second stop, and it is judged and recorded below (plan 03-46).
      const stillOpen = deps.ledger.listDecisions({ runId, state: 'open' });
      const current = deps.ledger.getRun(runId);
      const unanswered = stillOpen.ok ? openPauseDecisionOf(pauseDecisionIdsOf(prior), stillOpen.value.map((d) => d.decisionId)) : undefined;
      if (current.ok && current.value.state === 'blocked_on_decision' && unanswered !== undefined) {
        errOut(`exit-run: decision ${unanswered} of ${runId} is still open: the owner has not answered it yet`);
        return 2;
      }
      await waitForNextStop(deps, runId, Number(named['wait-max-minutes'] ?? STOP_WAIT_MAX_MINUTES), problems);
      after = snapshot(repo);
    }
    const collected = collect(deps, runId);
    problems.push(...collected.problems);
    const facts = collected.facts;
    if (facts === undefined) {
      errOut(`exit-run: ${problems.join('; ')}`);
      return 1;
    }
    state = facts.run.state;
    entry = { ...(prior ?? {}), ...facts.entry };
    // D-35 (plan 03-54): the checks the run's own contract does not run, which its status must report as not run. Recorded beside the status view.
    const notRunExpected = facts.contractBody === undefined ? undefined : checksNotRun(facts.contractBody);
    entry['checksNotRunExpected'] = notRunExpected ?? null;
    const hostVersion = claudeVersionOf(process.env['AVARICE_CLAUDE_BIN']);

    if (stage === 'start') {
      const startOut = named['start-out'] !== undefined && existsSync(resolve(named['start-out'])) ? readFileSync(resolve(named['start-out']), 'utf8') : '';
      const startErr = named['start-err'] !== undefined && existsSync(resolve(named['start-err'])) ? readFileSync(resolve(named['start-err']), 'utf8') : '';
      Object.assign(entry, {
        brief: briefPath.replace(`${REPO_ROOT}/`, ''),
        briefDigest: briefDigest ?? null,
        ...(identity !== undefined ? { run: identity.run, attempt: identity.attempt, expects: identity.expects } : {}),
        plan: livePlan(),
        host: { claudeBin: process.env['AVARICE_CLAUDE_BIN'] ?? null, claudeVersion: hostVersion, pinnedBy: pinnedByOf(named['authorization-file'] as string), liveAdmitVariableSet: process.env['AVARICE_LIVE_ADMIT_CLAUDE_VERSION'] !== undefined },
        perRunCapUsd: auth.perRunCapUsd,
        startExit: Number(named['start-exit'] ?? Number.NaN),
        startedAt: named['started-at'] ?? null,
        startStdoutTail: startOut.slice(-2500),
        ...(startErr !== '' ? { startStderrTail: startErr.slice(-2500) } : {}),
        checkoutBeforeSnapshot: before,
      });
      problems.push(
        ...judgeStart({
          state,
          reason: facts.run.reason,
          items: facts.items,
          decisions: facts.decisions,
          attempts: facts.attempts,
          notifications: asObjects(facts.entry['notifications']),
          askUserQuestion: Number(facts.entry['askUserQuestion']),
          hostConfigDir: isObject(facts.entry['hostConfigDir']) ? facts.entry['hostConfigDir'] : null,
          statusView: facts.entry['statusView'],
          ...(notRunExpected !== undefined ? { checksNotRunExpected: notRunExpected } : {}),
        }),
      );
      const checkout = checkoutOf(before, after, runId, false);
      problems.push(...checkout.problems);
      entry['checkout'] = checkout.view;
      // What the finish stage compares the resumed session with: the session each item carried when the run stopped.
      const judgedAt = new Date().toISOString();
      const earlier = earlierJudgementsOf(prior, named['rejudge-reason'], judgedAt);
      if (earlier.length > 0) entry['earlierJudgements'] = earlier;
      const pausedAt = isObject(prior?.['atPause']) && typeof prior['atPause']['at'] === 'string' ? prior['atPause']['at'] : judgedAt;
      entry['atPause'] = { at: pausedAt, ...(pausedAt !== judgedAt ? { judgedAgainAt: judgedAt } : {}), state, items: facts.items.map((i) => ({ itemId: i['itemId'], state: i['state'], attempts: i['attempts'], gsdSession: i['gsdSession'] })) };
      entry['stopOk'] = problems.length === 0;
    } else {
      const atPause = (prior as Json)['atPause'] as Json;
      const pauseDecisionIds = pauseDecisionIdsOf(prior);
      const pauseSessions: Record<string, string | null> = {};
      for (const i of asObjects(atPause['items'])) pauseSessions[String(i['itemId'])] = typeof i['gsdSession'] === 'string' ? i['gsdSession'] : null;
      const judged = judgeFinish({
        state,
        items: facts.items,
        decisions: facts.decisions,
        attempts: facts.attempts,
        invocations: asObjects(facts.entry['invocations']),
        pauseSessions,
        requiredChecks: asObjects(facts.entry['requiredChecks']),
        acceptance: asObjects(facts.entry['acceptance']),
        commit: state === 'ready_for_review' ? ((facts.entry['commit'] as string | null) ?? null) : null,
        clean: facts.entry['clean'] as boolean | null,
        gates: asObjects(facts.entry['gates']),
        commits: asObjects(facts.entry['commits']),
        askUserQuestion: Number(facts.entry['askUserQuestion']),
        owner: userInfo().username,
        hostConfigDir: isObject(facts.entry['hostConfigDir']) ? facts.entry['hostConfigDir'] : null,
        pauseDecisionIds,
        // The owner's relaxation of D-03 for this run, written into its entry by the `relax` subcommand (plan 03-49), and the contract the run ended on.
        relax: (prior as Json)['relax'],
        // D-28 (plan 03-52): the relax record cannot count in the exit under D-26..D-35: the evidence stage judges a record as a problem.
        relaxAllowed: false,
        contract: isObject(facts.entry['contract']) ? facts.entry['contract'] : null,
        // Plan 03-54: the run's role rule (D-28) from the entry the start stage wrote, and D-35's live report.
        ...(typeof (prior as Json)['expects'] === 'string' ? { expects: (prior as Json)['expects'] as string } : {}),
        statusView: facts.entry['statusView'],
        ...(notRunExpected !== undefined ? { checksNotRunExpected: notRunExpected } : {}),
      });
      problems.push(...judged.problems);
      entry['resume'] = judged.resume;
      entry['pauseDecisionIds'] = pauseDecisionIds;
      Object.assign(entry, secondStopOf(facts.decisions, pauseDecisionIds, state, facts.run.reason));
      entry['finalState'] = state;
      entry['resumed'] = judged.resume['resumed'] === true;
      const branchRef = `refs/heads/avarice/${runId}`;
      const afterRefs = new Map(refsOfSnapshot(after).map((r) => [r.ref, r.object]));
      entry['branchRefCommit'] = afterRefs.get(branchRef) ?? null;
      if (facts.entry['commit'] !== null && afterRefs.get(branchRef) !== undefined && afterRefs.get(branchRef) !== facts.entry['commit']) problems.push(`the branch ${branchRef} is at ${String(afterRefs.get(branchRef))} but the handed-off commit is ${String(facts.entry['commit'])}`);
      const checkout = checkoutOf(before, after, runId, state === 'ready_for_review');
      problems.push(...checkout.problems);
      entry['checkout'] = checkout.view;
      entry['finishedAt'] = new Date().toISOString();
      entry['passed'] = state === 'ready_for_review' && problems.length === 0;
    }
    entry['spend'] = recordSpendDelta(runId, briefPath, facts.costUsd, hostVersion, stage);
    entry['phase3SpentUsd'] = phase3Spent();
    // What the rest of the run may still cost at most, judged before the owner is handed the command (D-05).
    const remaining = Math.max(0, facts.budgetLimitUsd - facts.costUsd);
    const guard = spendGuard(phase3Spent(), remaining, { ledger: phase3Ceiling(), authorized: auth.ceilingUsd });
    entry['spendGuardAfterStage'] = { remainingRunCapUsd: remaining, ceilingUsd: guard.ceilingUsd, fits: guard.fits };
    if (stage === 'start' && !guard.fits) problems.push(`the rest of the run (up to ${remaining.toFixed(2)} USD) would pass the ${guard.ceilingUsd} USD ceiling: stop and ask the owner (D-05)`);
  } finally {
    composed.value.close();
  }
  entry['problems'] = problems;
  const runs = [...priorRuns.filter((r) => r['runId'] !== runId), entry];
  const result = evidenceFileBody(readJson(outPath), livePlan(), runs, new Date().toISOString());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);

  out(`run ${runId}: stage ${stage}, state ${state}, cost ${Number(entry['costUsd'] ?? 0).toFixed(4)} USD, ${problems.length} problem(s); Phase 3 spend now ${phase3Spent().toFixed(4)} USD\n`);
  for (const p of problems) out(`PROBLEM: ${p}\n`);
  if (stage === 'start') {
    for (const d of asObjects(entry['decisions']).filter((x) => x['state'] === 'open')) {
      out(`open decision ${String(d['decisionId'])} (${String(d['class'])}, origin ${String((d['origin'] as Json)['origin'])}): ${String(d['issue'])}\n`);
      out(`owner command (your own terminal; the pinned host, this checkout's CLI): AVARICE_CLAUDE_BIN=${auth.claudeBin} ${join(REPO_ROOT, 'bin', 'avarice')} decide ${String(d['decisionId'])}\n`);
    }
  }
  out(`evidence ${outPath}\n`);
  return problems.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'dry-run') return dryRun(rest);
  if (command === 'field') return fieldCommand(rest);
  if (command === 'authorize') return authorize(rest);
  if (command === 'snapshot') return snapshotCommand(rest);
  if (command === 'evidence') return evidenceCommand(rest);
  if (command === 'relax') return relaxCommand(rest);
  if (command === 'classify') return classifyCommand(rest);
  if (command === 'reset') return resetCommand(rest);
  if (command === 'silence') return silenceCommand(rest);
  if (command === 'verdict') return verdictCommand(rest);
  if (command === 'supplement') return supplementCommand(rest);
  if (command === 'brief-check') return briefCheck(rest);
  if (command === 'brief-gate') return briefGate(rest);
  if (command === 'write-authorization') return writeAuthorizationCommand(rest);
  if (command === 'parity') {
    const { named, many, bools } = flags(rest);
    return parityCommand(named, many, bools);
  }
  if (command === 'preflight') {
    const { named } = flags(rest);
    if (named['repo'] === undefined || named['config'] === undefined) {
      errOut('usage: preflight --repo REPO --config F [--pin SHA]');
      return 2;
    }
    const report = preflight(resolve(named['repo']), resolve(named['config']), named['pin'] ?? DEFAULT_PIN, Date.now());
    for (const line of report.lines) out(`${line}\n`);
    return report.ok ? 0 : 1;
  }
  errOut('usage: exit-run-phase3-tools.ts (dry-run | brief-check [--all] | brief-gate | write-authorization | parity | preflight | field | authorize | snapshot | evidence | relax | classify | reset | silence | verdict | supplement) ...');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
