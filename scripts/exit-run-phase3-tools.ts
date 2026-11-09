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
//   evidence ...
//       Plan 03-29 (the live exit). Not implemented here: this plan spends nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { phase3Ceiling, phase3LedgerPath, phase3Spent } from '../test/helpers/live-harness.ts';
import { GitRunSource } from '../src/adapters/git/run-source.ts';
import { ADMITTED_CLAUDE_VERSIONS } from '../src/adapters/host-claude/launch-preflight.ts';
import { parseBrief } from '../src/domain/brief.ts';
import type { Brief } from '../src/domain/brief.ts';
import { parseConventions } from '../src/domain/conventions.ts';
import type { Conventions } from '../src/domain/conventions.ts';
import { compileRunContract } from '../src/domain/run-contract.ts';
import type { RunContract } from '../src/domain/run-contract.ts';
import { preflight, snapshot } from './exit-run-phase2-tools.ts';

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
  const report: Json = { schema: 1, plan: PLAN, startedAt: new Date(startedAt).toISOString(), source: source.replace(homedir(), '~'), pin: pinRef, node: process.version, spentUsd: 0, installs: false, modelHostLaunched: false, readOnly: true };

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

export function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command === 'dry-run') return dryRun(rest);
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
  if (command === 'evidence') {
    errOut('exit-run-phase3-tools evidence: implemented by plan 03-29 (the live exit); plan 03-28 spends nothing');
    return 2;
  }
  errOut('usage: exit-run-phase3-tools.ts (dry-run | preflight | evidence) ...');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
