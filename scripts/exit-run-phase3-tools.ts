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
// Plan 03-29 adds the subcommands of the live exit (they never start a model; `avarice start` and the owner's `avarice decide` do):
//   field --authorization-file F --pick NAME
//       Prints one scalar of the owner's authorization (host.claudeBin, perRunCapUsd, ceilingUsd).
//   authorize --authorization-file F --brief B --repo REPO --config F --evidence F [--pin SHA]
//       Before a start: the owner's approval names this brief (parseBrief digest), the host is the pinned one and admitted, the evidence file holds no
//       run of the brief yet, the preflight is ok and the Phase 3 guard (D-05) says the recorded spend plus the per-run cap fits the lower of the
//       ceiling and the authorization's. Exit 0 ok, 75 when it would pass the ceiling ("stop and ask the owner"), 2 otherwise.
//   snapshot --repo REPO
//       The Phase 2 checkout snapshot (digest, index digest, symbolic HEAD, every ref) of the owner's checkout, read-only.
//   evidence --stage start|finish --run-id ID --brief B --repo REPO --out F ...
//       Reads the run from the owner's profile (read-only), appends the spend since the last record to the Phase 3 ledger under plan 03-29, and
//       writes the run's record into the exit evidence JSON. Stage `start` expects a stop on a pause-origin decision with the independent items
//       done; stage `finish` waits for the next stop state after the owner's answer and expects ready_for_review with the resumed session.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { phase3Ceiling, phase3LedgerPath, phase3Spent } from '../test/helpers/live-harness.ts';
import { getRunStatuses } from '../src/app/run-status.ts';
import { createDeps } from '../src/cli/composition.ts';
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
import { compileRunContract } from '../src/domain/run-contract.ts';
import type { RunContract } from '../src/domain/run-contract.ts';
import { compositeOf, preflight, snapshot } from './exit-run-phase2-tools.ts';

type Json = Record<string, unknown>;
const DEFAULT_PIN = '9f1cd8d';
const REPO_ROOT = resolve(import.meta.dirname, '..');
const PLAN = '03-28';

const out = (text: string): void => void process.stdout.write(text);
const errOut = (text: string): void => void process.stderr.write(`${text}\n`);

function flags(argv: readonly string[]): { named: Record<string, string>; many: Record<string, string[]> } {
  const named: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (!word.startsWith('--')) continue;
    const key = word.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      named[key] = next;
      (many[key] ??= []).push(next);
      i += 1;
    }
  }
  return { named, many };
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

interface Authorization {
  perRunCapUsd: number;
  ceilingUsd: number;
  claudeBin: string;
  claudeVersion: string;
  briefs: Json[];
}

function authorizationOf(path: string): Authorization | string {
  const auth = readJson(resolve(path));
  if (auth === undefined) return `${path} is not the owner's authorization file`;
  if (auth['selection'] !== 'approve') return `the authorization selection is ${JSON.stringify(auth['selection'])}, not "approve"`;
  const perRunCapUsd = Number(auth['perRunCapUsd']);
  const ceilingUsd = Number(auth['ceilingUsd']);
  if (!(Number.isFinite(perRunCapUsd) && perRunCapUsd > 0 && Number.isFinite(ceilingUsd) && ceilingUsd > 0)) return 'the authorization names no finite positive per-run cap and ceiling';
  const host = isObject(auth['host']) ? auth['host'] : {};
  const claudeBin = typeof host['claudeBin'] === 'string' ? host['claudeBin'] : '';
  const claudeVersion = typeof host['claudeVersion'] === 'string' ? host['claudeVersion'] : '';
  if (claudeBin === '' || claudeVersion === '') return 'the authorization names no host pin (host.claudeBin, host.claudeVersion)';
  return { perRunCapUsd, ceilingUsd, claudeBin, claudeVersion, briefs: asObjects(auth['briefs']) };
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

  // D-03: no run is repeated by hand, and no fourth run is started.
  const existing = readJson(resolve(named['evidence'] as string));
  const runs = asObjects(existing?.['runs']);
  if (runs.some((r) => r['briefDigest'] === digest)) return refuse(`the evidence file already records a run of ${named['brief']}: a run is never started twice by hand (D-03); stop and report`);
  if (runs.length >= parsed.briefs.length) return refuse(`the evidence file already records ${runs.length} runs (the owner approved ${parsed.briefs.length})`);

  const report = preflight(resolve(named['repo'] as string), resolve(named['config'] as string), named['pin'] ?? DEFAULT_PIN, Date.now());
  for (const line of report.lines) out(`${line}\n`);
  if (!report.ok) return refuse('the preflight failed (see above); nothing was started', 1);

  const spent = phase3Spent();
  const guard = spendGuard(spent, parsed.perRunCapUsd, { ledger: phase3Ceiling(), authorized: parsed.ceilingUsd });
  if (!guard.fits) return refuse(`stop and ask the owner (D-05): recorded Phase 3 spend ${spent.toFixed(4)} USD plus this run's cap ${parsed.perRunCapUsd.toFixed(2)} USD would pass the ${guard.ceilingUsd} USD ceiling`, EXIT_CEILING);
  out(`authorized: ${named['brief']} (${digest.slice(0, 19)}...), host ${parsed.claudeVersion}, Phase 3 spend ${spent.toFixed(4)} plus ${parsed.perRunCapUsd.toFixed(2)} fits ${guard.ceilingUsd} USD, run ${runs.length + 1} of ${parsed.briefs.length}\n`);
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

// The host configuration directory a run recorded at start (plan 03-43): the latest completed `host:config-dir` step's { claudeConfigDir, source }.
export function hostConfigDirOf(_steps: ReadonlyArray<{ step: string; status: string; result: unknown }>): Json | null {
  return null;
}

interface Facts {
  run: RunRow;
  entry: Json;
  decisions: Json[];
  items: Json[];
  attempts: Json[];
  costUsd: number;
  budgetLimitUsd: number;
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
  return { facts: { run: run.value, entry, decisions, items, attempts, costUsd, budgetLimitUsd: costRow?.limit ?? 0 }, problems };
}

// What the start stage expects of a run that has to stop on the planted decision (D-02, D-03): the pause-origin decision of the owner-choice item is open at
// contract version 1, the items independent of it are done, the items that wait for it have not been delegated, and one notification was queued.
export function judgeStart(facts: { state: string; reason: string | null; items: Json[]; decisions: Json[]; attempts: Json[]; notifications: Json[]; askUserQuestion: number; hostConfigDir?: Json | null }): string[] {
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
  return problems;
}

// What the finish stage expects after the owner's answer: the owner-choice item resumed its own session, every item is done and committed, and the run is
// ready for review on verified evidence (D-03 run 1, SC1, SC3).
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
}): { problems: string[]; resume: Json } {
  const problems: string[] = [];
  if (facts.state !== 'ready_for_review') problems.push(`the run ended ${facts.state}, not ready_for_review (D-03)`);
  const answered = facts.decisions.filter((d) => d['state'] === 'answered');
  if (answered.length !== 1) problems.push(`${answered.length} decision(s) are answered, not one`);
  const decision = answered[0];
  const resume: Json = { resumed: false };
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
  return { problems, resume };
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
      // The owner has answered, and the supervisor the decide command started takes the run on. A decision still open means the owner has not answered yet.
      const stillOpen = deps.ledger.listDecisions({ runId, state: 'open' });
      const current = deps.ledger.getRun(runId);
      if (current.ok && current.value.state === 'blocked_on_decision' && stillOpen.ok && stillOpen.value.length > 0) {
        errOut(`exit-run: decision ${stillOpen.value[0]?.decisionId ?? '?'} of ${runId} is still open: the owner has not answered it yet`);
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
    const hostVersion = claudeVersionOf(process.env['AVARICE_CLAUDE_BIN']);

    if (stage === 'start') {
      const startOut = named['start-out'] !== undefined && existsSync(resolve(named['start-out'])) ? readFileSync(resolve(named['start-out']), 'utf8') : '';
      const startErr = named['start-err'] !== undefined && existsSync(resolve(named['start-err'])) ? readFileSync(resolve(named['start-err']), 'utf8') : '';
      Object.assign(entry, {
        brief: briefPath.replace(`${REPO_ROOT}/`, ''),
        briefDigest: briefDigestOf(briefPath) ?? null,
        plan: livePlan(),
        host: { claudeBin: process.env['AVARICE_CLAUDE_BIN'] ?? null, claudeVersion: hostVersion, pinnedBy: pinnedByOf(named['authorization-file'] as string), liveAdmitVariableSet: process.env['AVARICE_LIVE_ADMIT_CLAUDE_VERSION'] !== undefined },
        perRunCapUsd: auth.perRunCapUsd,
        startExit: Number(named['start-exit'] ?? Number.NaN),
        startedAt: named['started-at'] ?? null,
        startStdoutTail: startOut.slice(-2500),
        ...(startErr !== '' ? { startStderrTail: startErr.slice(-2500) } : {}),
        checkoutBeforeSnapshot: before,
      });
      problems.push(...judgeStart({ state, reason: facts.run.reason, items: facts.items, decisions: facts.decisions, attempts: facts.attempts, notifications: asObjects(facts.entry['notifications']), askUserQuestion: Number(facts.entry['askUserQuestion']) }));
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
      });
      problems.push(...judged.problems);
      entry['resume'] = judged.resume;
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
  errOut('usage: exit-run-phase3-tools.ts (dry-run | preflight | field | authorize | snapshot | evidence) ...');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
