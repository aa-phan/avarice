// Helpers of scripts/exit-run-phase2.sh (plan 02-21; D-06, D-09, D-10, D-11, D-16). Nothing here starts a model, and nothing writes to the
// owner's portfolio: it is a `git clone` source and a `git show` / `git rev-list` subject, and its status and HEAD are compared before and after.
//
//   dry-run --source REPO --config F --brief F [--brief F ...] --out F [--pin SHA] [--temp-profile] [--keep]
//       Proves the drafts against the pin in a scratch clone: the parsers, the contract compiler for every brief, ONB-10 validation of every
//       declared check (dependencies installed through the registry-only egress proxy), a baseline of every declared check and the test
//       inventory, through the same functions a real run uses (validateChecks, installDependencies, runRequiredChecks, measureInventory).
//       The profile (config, data and work roots) is a throwaway one placed under the default AVARICE parents, so the sandbox denials a real
//       run has apply; `--temp-profile` places it under $TMPDIR instead. Needs the network for npm only (AVARICE_NET=1).
//       Writes the evidence JSON to --out; exit 0 only when it lists no problem.
//   preflight --repo REPO --config F [--pin SHA]
//       Read-only: finds the conventions the way `avarice start` does (D-16), parses them, compares the checks digest with the draft's and
//       judges the staleness rules (D-04). Prints `conventions: ok|FAIL` and `staleness: ok|FAIL` lines; exit 1 on a FAIL.
//
// Plan 02-22 adds the three subcommands of the live exit (they never start a model; `avarice start` does, from the shell script):
//   authorize --authorization-file F --brief B --repo REPO --config F [--evidence F] [--pin SHA]
//       Before a run: the owner's approval names this brief (parseBrief digest equal), the evidence file holds no run of it yet and fewer
//       than maxRuns runs, the preflight (D-04, D-16) is ok, and the Phase 2 ceiling guard `fitsPhase2Ceiling(perRunCap)` (D-15) says the
//       recorded spend plus this run's cap fits. Exit 0 ok, 75 when the ceiling would be passed ("stop and ask the owner"), 1 otherwise.
//   snapshot --repo REPO
//       Read-only JSON of the owner's checkout: the checkout digest (HEAD, branch, status, tracked and untracked file bytes, refs excluding
//       refs/heads/avarice/run_*, worktrees), a digest of the index entries, the symbolic HEAD, and every ref with its object.
//   evidence --run-id ID --brief B --before F --after F --start-exit N --start-out F --out F --ledger F [--repo REPO] [--plan 02-22]
//       After a run: reads the run from the owner's profile (read-only), appends its spend line to the Phase 2 ledger (once per run), and
//       writes the run's record into the exit evidence JSON, with the diagnosis when the run did not reach ready_for_review.
//       Exit 0 when the run is a clean `ready_for_review`, 1 otherwise.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkoutDigest, RUN_REF_GLOB } from './checkout-digest.ts';
import { fitsPhase2Ceiling, phase2Ceiling, phase2LedgerPath, phase2Spent } from '../test/helpers/live-harness.ts';
import { getRunStatuses } from '../src/app/run-status.ts';
import { GitRunSource } from '../src/adapters/git/run-source.ts';
import { runGit } from '../src/adapters/git/safe-git.ts';
import { blockingOf, validateChecks } from '../src/app/check-validation.ts';
import { installDependencies, measureInventory, runRequiredChecks, sandboxSetup } from '../src/app/checks.ts';
import type { InstallResult } from '../src/app/checks.ts';
import type { AppDeps } from '../src/app/deps.ts';
import { startRun } from '../src/app/run-start.ts';
import { createDeps } from '../src/cli/composition.ts';
import { parseBrief } from '../src/domain/brief.ts';
import { checkSpecDigest, parseConventions } from '../src/domain/conventions.ts';
import { judgeRunPreflight } from '../src/domain/run-preflight.ts';
import type { RunContract } from '../src/domain/run-contract.ts';

type Json = Record<string, unknown>;
const DEFAULT_PIN = '9f1cd8d';
const REPO_ROOT = resolve(import.meta.dirname, '..');
const DAY_MS = 86_400_000;
// The base statuses D-12 expects at the pin: format:check fails on index.html (pre-existing), everything else passes.
const EXPECTED_BASE_FAILURES: readonly string[] = ['format:check'];

const out = (text: string): void => void process.stdout.write(text);
const errOut = (text: string): void => void process.stderr.write(`${text}\n`);

function flags(argv: readonly string[]): { named: Record<string, string>; many: Record<string, string[]>; booleans: Set<string> } {
  const named: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (!word.startsWith('--')) continue;
    const key = word.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      named[key] = next;
      (many[key] ??= []).push(next);
      i += 1;
    } else booleans.add(key);
  }
  return { named, many, booleans };
}

function git(cwd: string | undefined, args: readonly string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync('git', [...(cwd !== undefined ? ['-C', cwd] : []), ...args], { encoding: 'utf8', env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 1 << 26 });
  return { status: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' };
}

function mustGit(cwd: string | undefined, args: readonly string[]): string {
  const ran = git(cwd, args);
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr.trim()}`);
  return ran.stdout;
}

function describeError(error: { kind: string } & Record<string, unknown>): string {
  return `${error.kind}${typeof error['cause'] === 'string' ? `: ${error['cause']}` : typeof error['reason'] === 'string' ? `: ${error['reason']}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// preflight (read-only; Task 3's verification of the owner's commit, and the dry run's last step on its clone)
// ---------------------------------------------------------------------------------------------------------------

interface PreflightReport {
  lines: string[];
  ok: boolean;
  conventionsRevision?: string;
  checksDigest?: string;
}

function preflight(repo: string, configPath: string, pinRef: string, nowMs: number): PreflightReport {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string): void => {
    ok = false;
    lines.push(line);
  };
  const draft = parseConventions(readFileSync(configPath, 'utf8'));
  if (!draft.ok) {
    fail(`conventions: FAIL the draft ${configPath} does not parse: ${describeError(draft.error)}`);
    return { lines, ok };
  }
  const draftDigest = checkSpecDigest(draft.value.checks);

  const source = new GitRunSource();
  const resolvedPin = runGit(['rev-parse', '--verify', `${pinRef}^{commit}`], { cwd: repo });
  if (!resolvedPin.ok) {
    fail(`conventions: FAIL the pin ${pinRef} is not a commit of ${repo}`);
    return { lines, ok };
  }
  const pin = resolvedPin.value.stdout.trim();
  const head = source.head(repo);
  if (!head.ok) {
    fail(`conventions: FAIL cannot read the HEAD of ${repo}: ${describeError(head.error)}`);
    return { lines, ok };
  }
  lines.push(`ok   pin ${pin.slice(0, 7)}, source HEAD ${head.value.slice(0, 7)}`);

  const drift = source.staleness(repo, pin, head.value);
  const staleness = drift.ok ? drift.value : { descendant: false, commitsOutside: 0, oldestOutsideCommittedAtMs: null };
  const found = staleness.descendant ? source.conventionsAt(repo, pin, head.value) : null;
  const roadmap = staleness.descendant ? source.hasFile(repo, pin, '.planning/ROADMAP.md') : null;
  const verdict = judgeRunPreflight({
    pin,
    head: head.value,
    staleness: {
      descendant: staleness.descendant,
      commitsOutside: staleness.commitsOutside,
      oldestOutsideAgeDays: staleness.oldestOutsideCommittedAtMs === null ? null : (nowMs - staleness.oldestOutsideCommittedAtMs) / DAY_MS,
    },
    conventions: found !== null && found.ok ? 'found' : 'not_found',
    roadmapAtPin: roadmap !== null && roadmap.ok && roadmap.value,
  });

  // The staleness rules (D-04) and the descendant rule (D-16), as their own line; "no conventions" is the other line's failure.
  if (!staleness.descendant) fail(`staleness: FAIL the source HEAD ${head.value.slice(0, 7)} does not descend from the pin ${pin.slice(0, 7)} (D-16)`);
  else if (!verdict.ok && (verdict.refusal.code === 'stale-commits' || verdict.refusal.code === 'stale-age' || verdict.refusal.code === 'no-planning' || verdict.refusal.code === 'not-descendant')) {
    fail(`staleness: FAIL ${verdict.refusal.code}: ${verdict.refusal.message}`);
  } else lines.push(`staleness: ok (HEAD descends from the pin; ${staleness.commitsOutside} commit(s) outside .avarice/ and .planning/ past the pin; the pin tree has .planning/ROADMAP.md)`);

  if (found === null || !found.ok) {
    fail(`conventions: FAIL ${found === null ? 'no conventions: HEAD does not descend from the pin' : found.error.kind === 'not_found' ? '.avarice/config.json is not at the pin or at a descendant commit that changes only .avarice/ (D-16): commit it as its own commit on top of the pin' : describeError(found.error)}`);
    return { lines, ok };
  }
  const committed = parseConventions(found.value.text);
  if (!committed.ok) {
    fail(`conventions: FAIL .avarice/config.json at ${found.value.revision.slice(0, 7)} does not parse: ${describeError(committed.error)}`);
    return { lines, ok };
  }
  const committedDigest = checkSpecDigest(committed.value.checks);
  if (committedDigest !== draftDigest) {
    fail(`conventions: FAIL the checks digest of ${found.value.revision.slice(0, 7)} (${committedDigest}) differs from the draft's (${draftDigest})`);
    return { lines, ok, conventionsRevision: found.value.revision, checksDigest: committedDigest };
  }
  // Same checks, but the owner may have changed something outside them (paths, inventory, dependencies, agent commands): the parsed content
  // is what AVARICE uses, so it is what is compared.
  if (JSON.stringify(committed.value) !== JSON.stringify(draft.value)) {
    fail('conventions: FAIL the committed file parses to other conventions than the draft (the checks match; paths, inventory, dependencies or agent commands differ)');
    return { lines, ok, conventionsRevision: found.value.revision, checksDigest: committedDigest };
  }
  lines.push(`conventions: ok (revision ${found.value.revision}, checks digest ${committedDigest} equals the draft's, ${committed.value.checks.length} checks)`);
  return { lines, ok, conventionsRevision: found.value.revision, checksDigest: committedDigest };
}

// ---------------------------------------------------------------------------------------------------------------
// dry-run
// ---------------------------------------------------------------------------------------------------------------

interface BriefReport {
  path: string;
  title: string;
  digest?: string;
  compiled: boolean;
  problem?: string;
  write?: string[];
  targetChecks?: string[];
  acceptance?: Array<{ id: string; verifiedBy: string[] }>;
  budgets?: { wallClockMinutes: number; invocations: number; toolCalls: number; costUsdPerInvocation: number; costUsdPerRun: number };
  expectedDecisions?: number;
}

interface CheckReport {
  name: string;
  required: boolean;
  verdict: string;
  verdictDetail: Json;
  baseStatus: string | null;
  exitCode: number | null;
  baseDurationMs: number | null;
  validationReused: boolean;
  outputTail?: string;
}

const OUTPUT_TAIL_CHARS = 1200;

function outputTailOf(deps: AppDeps, digest: string): string {
  const bytes = deps.artifacts.get(digest);
  if (!bytes.ok) return `(output not readable: ${bytes.error.kind})`;
  const text = new TextDecoder().decode(bytes.value);
  return text.length <= OUTPUT_TAIL_CHARS ? text : `...${text.slice(-OUTPUT_TAIL_CHARS)}`;
}

function portfolioState(path: string): { status: string; head: string } {
  return { status: mustGit(path, ['status', '--porcelain']), head: mustGit(path, ['rev-parse', 'HEAD']).trim() };
}

function realTmpdir(): string {
  const real = realpathSync(process.env['TMPDIR'] !== undefined && process.env['TMPDIR'] !== '' ? process.env['TMPDIR'] : '/tmp');
  if (`${real}/`.startsWith(`${homedir()}/.claude`)) throw new Error(`TMPDIR ${real} is under a Claude config directory; set TMPDIR elsewhere`);
  return real;
}

async function dryRun(argv: readonly string[]): Promise<number> {
  const { named, many, booleans } = flags(argv);
  const source = named['source'] ?? join(homedir(), 'aa-phan-portfolio-v2');
  const configPath = resolve(named['config'] ?? '');
  const briefPaths = (many['brief'] ?? []).map((p) => resolve(p));
  const outPath = named['out'];
  const pinRef = named['pin'] ?? DEFAULT_PIN;
  if (!existsSync(configPath) || briefPaths.length === 0 || outPath === undefined) {
    errOut('usage: dry-run --source REPO --config F --brief F [--brief F ...] --out F [--pin SHA] [--temp-profile] [--keep]');
    return 2;
  }
  if (process.env['AVARICE_NET'] !== '1') {
    errOut('exit-run-phase2 dry-run: the dependency install needs the registry (npm ci through the egress proxy); set AVARICE_NET=1');
    return 2;
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  const startedAt = Date.now();
  const home = realpathSync(homedir());
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const tmp = realTmpdir();
  const root = mkdtempSync(join(tmp, 'avarice-exit-dry-'));
  chmodSync(root, 0o700);
  const unique = `exit-dry-${stamp}-${process.pid}`;
  const roots = booleans.has('temp-profile')
    ? { config: join(root, 'profile', 'config'), data: join(root, 'profile', 'data'), work: join(root, 'profile', 'work') }
    : { config: join(home, '.config', 'avarice', unique), data: join(home, '.local', 'share', 'avarice', unique), work: join(home, '.local', 'share', 'avarice-work', unique) };
  const cleanup = (): void => {
    if (booleans.has('keep')) return;
    for (const dir of [root, ...(booleans.has('temp-profile') ? [] : [roots.config, roots.data, roots.work])]) rmSync(dir, { recursive: true, force: true });
  };

  const sourceBefore = portfolioState(source);
  const report: Json = { schema: 1, plan: '02-21', startedAt: new Date(startedAt).toISOString(), source, pin: pinRef, profile: booleans.has('temp-profile') ? 'temp' : 'default-parents', node: process.version };
  try {
    const pin = mustGit(source, ['rev-parse', '--verify', `${pinRef}^{commit}`]).trim();
    report['pinSha'] = pin;
    const clone = join(root, 'clone');
    mustGit(undefined, ['-c', 'core.hooksPath=/dev/null', 'clone', '--local', '--no-hardlinks', '--quiet', source, clone]);
    mustGit(clone, ['remote', 'remove', 'origin']);
    mustGit(clone, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '-B', 'exit-dry-run', pin]);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AVARICE_CONFIG_HOME: roots.config,
      AVARICE_DATA_ROOT: roots.data,
      AVARICE_WORK_ROOT: roots.work,
      // No model can run: with no admitted claude the composition keeps the host that refuses.
      AVARICE_CLAUDE_BIN: '/nonexistent/avarice-exit-dry-run-has-no-claude',
    };
    delete env['NODE_TEST_CONTEXT'];

    // Onboard the clone with the fake onboarding host (the real GSD verbs, no model), then commit the draft conventions on top (D-16).
    const onboarded = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts'), 'onboard', '--policy', 'onboarding', clone], {
      encoding: 'utf8',
      env: { ...env, AVARICE_FAKE_HOST: '{}' },
      timeout: 600_000,
    });
    if (onboarded.status !== 0 || !/onboarding onb_[0-9A-Z]{26}: active/.test(onboarded.stdout)) {
      problems.push(`the scratch clone could not be onboarded with the fake host: ${(onboarded.stdout + onboarded.stderr).trim().slice(0, 400)}`);
      return finish(1);
    }
    report['onboarded'] = onboarded.stdout.trim().split('\n').at(-1);
    mkdirSync(join(clone, '.avarice'), { recursive: true });
    writeFileSync(join(clone, '.avarice', 'config.json'), readFileSync(configPath));
    mustGit(clone, ['add', '--', '.avarice/config.json']);
    mustGit(clone, ['-c', 'user.name=exit-dry-run', '-c', 'user.email=exit-dry-run@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'conventions: draft .avarice/config.json (dry run, scratch clone only)']);
    const changed = mustGit(clone, ['diff', '--name-only', pin, 'HEAD']).trim().split('\n').filter((l) => l !== '');
    report['conventionsCommitTouches'] = changed;
    if (changed.length !== 1 || changed[0] !== '.avarice/config.json') problems.push(`the conventions commit touches ${changed.join(', ')} instead of only .avarice/config.json`);

    // The preflight tool judges the clone exactly as it will judge the owner's commit.
    const pre = preflight(clone, configPath, pin, Date.now());
    report['preflight'] = pre.lines;
    if (!pre.ok) problems.push(`the preflight on the scratch clone failed: ${pre.lines.filter((l) => l.includes('FAIL')).join(' / ')}`);

    const composed = createDeps(env);
    if (!composed.ok) {
      problems.push(`cannot compose the dependencies: ${composed.message}`);
      return finish(1);
    }
    const deps: AppDeps = composed.value.deps;
    try {
      return finish(await prove(deps, clone, pin));
    } finally {
      composed.value.close();
    }
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
    return finish(1);
  }

  async function prove(deps: AppDeps, clone: string, pin: string): Promise<number> {
    // 1. every brief through `avarice start`'s own code: parse, preflight, compile, store (no run is executed).
    const briefReports: BriefReport[] = [];
    const runs: Array<{ runId: string; brief: BriefReport }> = [];
    for (const path of briefPaths) {
      const text = readFileSync(path, 'utf8');
      const parsed = parseBrief(text, { kind: 'file', id: path.split('/').pop() as string });
      const entry: BriefReport = { path, title: parsed.ok ? parsed.value.title : '(does not parse)', compiled: false };
      briefReports.push(entry);
      if (!parsed.ok) {
        entry.problem = `does not parse: ${describeError(parsed.error)}`;
        problems.push(`${path}: ${entry.problem}`);
        continue;
      }
      entry.digest = parsed.value.digest;
      const started = startRun(deps, { cwd: clone, briefPath: path, policy: 'routine', budgetOverrides: {} });
      if (!started.ok) {
        const failure = started.failure;
        entry.problem = failure.kind === 'internal' ? failure.message : `${failure.kind === 'refused' ? failure.code : failure.field}: ${failure.message}`;
        problems.push(`${path}: does not compile against the draft conventions: ${entry.problem}`);
        continue;
      }
      const c = started.value.contract;
      entry.compiled = true;
      entry.write = c.files.write;
      entry.targetChecks = c.verification.targetChecks;
      entry.acceptance = c.intent.acceptance.map((a) => ({ id: a.id, verifiedBy: a.verifiedBy }));
      entry.budgets = { wallClockMinutes: c.budgets.wallClockMinutes, invocations: c.budgets.invocations, toolCalls: c.budgets.toolCalls, costUsdPerInvocation: c.budgets.costUsd.perInvocation, costUsdPerRun: c.budgets.costUsd.perRun };
      if (c.intent.expectedDecisions !== undefined) entry.expectedDecisions = c.intent.expectedDecisions;
      runs.push({ runId: started.value.runId, brief: entry });
    }
    report['briefs'] = briefReports;
    const first = runs[0];
    if (first === undefined) return 1;

    const run = deps.ledger.getRun(first.runId);
    const stored = deps.ledger.getRunContract(first.runId);
    if (!run.ok || !stored.ok || stored.value === null) {
      problems.push('the first compiled run cannot be read back from the ledger');
      return 1;
    }
    const contract = stored.value.body as RunContract;
    const workspace = deps.runWorkspace;
    if (workspace === undefined) {
      problems.push('the run workspace is not composed');
      return 1;
    }

    // 2. the run clone at the pin, the install in it, and ONB-10 validation (which installs in its own validation clone first).
    const timings: Record<string, number> = {};
    const timed = async <T>(name: string, body: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      try {
        return await body();
      } finally {
        timings[name] = Date.now() - t0;
      }
    };
    const prepared = workspace.prepare({ repoPath: clone, workRoot: deps.profile.workRoot, runId: first.runId, pin });
    if (!prepared.ok) {
      problems.push(`the run clone could not be made: ${describeError(prepared.error)}`);
      return 1;
    }
    const runClone = prepared.value.path;
    report['runClone'] = runClone;

    const install = await timed('installRunClone', () => installDependencies(deps, run.value, contract, runClone));
    if (!install.ok) {
      problems.push(`the dependency install could not run: ${describeError(install.error)}`);
      return 1;
    }
    report['install'] = installView(install.value);
    if (install.value.outcome !== 'installed') {
      problems.push(`the dependency install did not succeed: ${install.value.failure?.issue ?? install.value.outcome}`);
      return 1;
    }

    const validationInstall: { result?: InstallResult } = {};
    const validated = await timed('validateChecks', () =>
      validateChecks(deps, run.value, contract, {
        prepared: async (validationClone) => {
          const done = await installDependencies(deps, run.value, contract, validationClone);
          if (done.ok) validationInstall.result = done.value;
          if (!done.ok) return done;
          return done.value.outcome === 'failed'
            ? { ok: false as const, error: { kind: 'conflict' as const, expected: 'the dependencies installed in the validation clone', actual: done.value.failure?.issue ?? 'the install failed' } }
            : { ok: true as const, value: undefined };
        },
      }),
    );
    if (!validated.ok) {
      problems.push(`validation could not run: ${describeError(validated.error)}${validationInstall.result?.failure !== undefined ? ` (${validationInstall.result.failure.issue})` : ''}`);
      return 1;
    }
    if (validationInstall.result !== undefined) report['validationInstall'] = installView(validationInstall.result);
    const verdicts = new Map(validated.value.outcomes.map((o) => [o.name, o]));
    for (const outcome of validated.value.outcomes) {
      if (outcome.verdict !== 'active' && outcome.required) problems.push(`required check ${outcome.name}: ${blockingOf(outcome).issue}`);
      else if (outcome.verdict !== 'active') warnings.push(`optional check ${outcome.name} is ${outcome.verdict} (${JSON.stringify(outcome.detail)}): a real run leaves it out`);
    }

    // 3. the baseline of every declared check at the pin (the optional one included), then the test inventory.
    const attempt = deps.ledger.recordRunAttempt(first.runId, { reason: 'initial', nowMs: deps.clock.nowMs() });
    if (!attempt.ok) {
      problems.push(`the baseline attempt could not be opened: ${describeError(attempt.error)}`);
      return 1;
    }
    const everything: RunContract = { ...contract, verification: { ...contract.verification, targetChecks: contract.execution.checks.map((c) => c.name) } };
    const base = await timed('baseline', () => runRequiredChecks(deps, run.value, everything, { cwd: runClone, attemptId: attempt.value.attemptId, phase: 'base', contractVersion: 1 }));
    if (!base.ok) {
      problems.push(`the baseline could not run: ${describeError(base.error)}`);
      return 1;
    }
    const evidence = deps.ledger.listEvidence(first.runId);
    const rows = evidence.ok ? evidence.value : [];
    const checks: CheckReport[] = contract.execution.checks.map((spec) => {
      const outcome = verdicts.get(spec.name);
      const ran = base.value.find((r) => r.name === spec.name);
      const row = rows.find((r) => r.kind === 'check' && r.name === spec.name && r.environment['label'] === 'base');
      return {
        name: spec.name,
        required: spec.required,
        verdict: outcome?.verdict ?? 'missing',
        verdictDetail: (outcome?.detail ?? {}) as Json,
        baseStatus: ran?.status ?? null,
        exitCode: ran?.exitCode ?? null,
        baseDurationMs: row?.durationMs ?? null,
        validationReused: outcome?.reused ?? false,
        // What a check that did not pass said, so a failure at the pin can be read from the evidence (the artifact is the whole output).
        ...(row !== undefined && row.status !== 'passed' && row.artifactDigest !== null ? { outputTail: outputTailOf(deps, row.artifactDigest) } : {}),
      };
    });
    report['checks'] = checks;
    for (const check of checks) {
      if (check.baseStatus === null) {
        if (check.verdict === 'active') problems.push(`check ${check.name} was active but produced no baseline row`);
        continue;
      }
      const expectedFailure = EXPECTED_BASE_FAILURES.includes(check.name);
      if (expectedFailure && check.baseStatus !== 'failed') warnings.push(`check ${check.name} was expected to fail at the pin (D-12) and ${check.baseStatus}`);
      if (!expectedFailure && check.baseStatus !== 'passed') {
        (check.required ? problems : warnings).push(
          `check ${check.name} is ${check.baseStatus} at the pin (exit ${String(check.exitCode)}); ${check.required ? 'it was expected to pass' : 'it is optional and neither required nor a brief target, so a real run never runs it (it needs a browser and a local server)'}`,
        );
      }
    }
    for (const entry of briefReports) {
      for (const target of entry.targetChecks ?? []) {
        const status = checks.find((c) => c.name === target)?.baseStatus;
        if (status !== 'passed') problems.push(`${entry.path} targets ${target}, which is ${String(status)} at the pin: G2 would stop at checks-delta`);
      }
    }

    const inventory = await timed('inventory', () => measureInventory(deps, run.value, contract, runClone, { phase: 'base', attemptId: attempt.value.attemptId, contractVersion: 1 }));
    if (!inventory.ok) {
      problems.push(`the test inventory could not be measured: ${describeError(inventory.error)}`);
    } else if (inventory.value === null) {
      problems.push('the conventions declare no test inventory');
    } else {
      const ids = inventory.value.snapshot.ids;
      const sample = ids.slice(0, 5);
      report['inventory'] = { status: inventory.value.status, tests: ids.length, files: inventory.value.snapshot.fileCount, markers: inventory.value.snapshot.markers, sample };
      if (inventory.value.status !== 'passed') {
        problems.push(`the inventory command (${(contract.verification.testInventory?.argv ?? []).join(' ')}) ended ${inventory.value.status}`);
        // The measurement keeps only the ID list; one more run of the same command, in the same sandbox, says why it failed.
        const argv = contract.verification.testInventory?.argv;
        const sandbox = sandboxSetup(deps, run.value, runClone);
        if (argv !== undefined && sandbox.ok) {
          const again = await deps.executor.run({ argv, cwd: runClone, env: sandbox.value.env, timeoutMs: 120_000, invocationId: deps.ids.next('inv_'), writePaths: [sandbox.value.scratch], denyReadPaths: sandbox.value.denyReadPaths, allowReadPaths: sandbox.value.allowReadPaths });
          report['inventoryDiagnosis'] = again.ok ? { status: again.value.status, exitCode: again.value.exitCode, stdoutTail: again.value.stdout.slice(-OUTPUT_TAIL_CHARS), stderrTail: again.value.stderr.slice(-OUTPUT_TAIL_CHARS) } : { error: describeError(again.error) };
        }
      } else if (ids.length === 0) problems.push('the inventory command listed no test');
      // The briefs' `test:<text>` criteria are satisfied from the inventory after the unit, so at the pin only the describe blocks they extend can be seen.
      for (const word of ['swipeDirection', 'monthYear']) {
        if (inventory.value.status === 'passed' && !ids.some((id) => id.includes(word))) warnings.push(`no inventory id at the pin contains ${JSON.stringify(word)}: check the id format of the list command`);
      }
    }
    report['timingsMs'] = timings;
    return problems.length === 0 ? 0 : 1;
  }

  function finish(code: number): number {
    // The owner's checkout is read-only here; its status and HEAD must not have moved.
    const sourceAfter = portfolioState(source);
    report['portfolio'] = { before: sourceBefore, after: sourceAfter, unchanged: sourceBefore.status === sourceAfter.status && sourceBefore.head === sourceAfter.head };
    if (sourceBefore.status !== sourceAfter.status || sourceBefore.head !== sourceAfter.head) problems.push('the portfolio status or HEAD changed during the dry run');
    report['problems'] = problems;
    report['warnings'] = warnings;
    report['wallSeconds'] = Math.round((Date.now() - startedAt) / 1000);
    report['spentUsd'] = 0;
    mkdirSync(dirname(resolve(outPath as string)), { recursive: true });
    writeFileSync(resolve(outPath as string), `${JSON.stringify(report, null, 2)}\n`);
    cleanup();
    const checks = (report['checks'] ?? []) as CheckReport[];
    for (const c of checks) out(`${c.verdict === 'active' ? 'ok  ' : 'FAIL'} ${c.name.padEnd(15)} ${c.required ? 'required' : 'optional'}  verdict ${c.verdict}  base ${c.baseStatus ?? '-'}  ${c.baseDurationMs === null ? '' : `${(c.baseDurationMs / 1000).toFixed(1)} s`}\n`);
    const inv = report['inventory'] as { tests: number; files: number } | undefined;
    if (inv !== undefined) out(`inventory: ${inv.tests} tests in ${inv.files} files\n`);
    for (const w of warnings) out(`warning: ${w}\n`);
    for (const p of problems) out(`PROBLEM: ${p}\n`);
    out(`exit-dry-run: ${problems.length} problem(s), ${warnings.length} warning(s); evidence ${resolve(outPath as string)}\n`);
    return code === 0 && problems.length === 0 ? 0 : 1;
  }
}

function installView(result: InstallResult): Json {
  return {
    outcome: result.outcome,
    ...(result.lockfileDigest !== undefined ? { lockfileDigest: result.lockfileDigest } : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    attempts: result.attempts,
    ...(result.failure !== undefined ? { failure: result.failure.issue } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The live exit (plan 02-22): authorize, snapshot, evidence
// ---------------------------------------------------------------------------------------------------------------

const EXIT_CEILING = 75;
const sha256 = (data: string | Buffer): string => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function readJson(path: string): Json | undefined {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return isObject(parsed) ? parsed : undefined;
}

function briefDigest(path: string): string | undefined {
  const parsed = parseBrief(readFileSync(path, 'utf8'), { kind: 'file', id: path.split('/').pop() as string });
  return parsed.ok ? parsed.value.digest : undefined;
}

// The Phase 2 spend recorded for plan 02-22 so far, per run ID (the case name carries the run ID).
function ledgerLines(path: string): Json[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Json);
}

function authorize(argv: readonly string[]): number {
  const { named } = flags(argv);
  const authPath = named['authorization-file'];
  const briefArg = named['brief'];
  const repo = named['repo'];
  const configPath = named['config'];
  if (authPath === undefined || briefArg === undefined || repo === undefined || configPath === undefined) {
    errOut('usage: authorize --authorization-file F --brief B --repo REPO --config F [--evidence F] [--pin SHA]');
    return 2;
  }
  const refuse = (text: string, code = 1): number => {
    errOut(`exit-run: ${text}`);
    return code;
  };
  const auth = readJson(resolve(authPath));
  if (auth === undefined) return refuse(`refusing to spend: ${authPath} is not the owner's authorization file`, 2);
  if (auth['selection'] !== 'approve') return refuse(`the authorization selection is ${JSON.stringify(auth['selection'])}, not "approve"`, 2);
  const approved = Array.isArray(auth['approvedBriefs']) ? (auth['approvedBriefs'] as Json[]) : [];
  const perRun = Number(auth['perRunCapUsd']);
  const cap = Number(auth['capUsd']);
  const maxRuns = Number(auth['maxRuns']);
  if (!(Number.isFinite(perRun) && perRun > 0 && Number.isFinite(cap) && cap > 0 && Number.isFinite(maxRuns) && maxRuns > 0)) return refuse('the authorization names no finite positive per-run cap, ceiling and run count', 2);

  const briefPath = resolve(briefArg);
  const digest = existsSync(briefPath) ? briefDigest(briefPath) : undefined;
  if (digest === undefined) return refuse(`${briefArg} does not parse as a brief`, 2);
  const entry = approved.find((a) => isObject(a) && a['digest'] === digest);
  if (entry === undefined) return refuse(`the brief ${briefArg} (digest ${digest}) is not one of the briefs the owner approved: stop and report`, 2);
  if (entry['path'] !== undefined && resolve(REPO_ROOT, String(entry['path'])) !== briefPath) return refuse(`the approved digest ${digest} belongs to ${String(entry['path'])}, not ${briefArg}`, 2);

  // No run is repeated by hand (the plan's prohibition): a brief that already has a recorded run, and a fourth run, are refused.
  const evidencePath = named['evidence'];
  const existing = evidencePath === undefined ? undefined : readJson(resolve(evidencePath));
  const runs = existing !== undefined && Array.isArray(existing['runs']) ? (existing['runs'] as Json[]) : [];
  if (runs.some((r) => r['briefDigest'] === digest)) return refuse(`the evidence file already records a run of ${briefArg}: a run is never started twice by hand; stop and report`, 2);
  if (runs.length >= maxRuns) return refuse(`the evidence file already records ${runs.length} runs (the owner approved ${maxRuns})`, 2);

  const report = preflight(resolve(repo), resolve(configPath), named['pin'] ?? DEFAULT_PIN, Date.now());
  for (const line of report.lines) out(`${line}\n`);
  if (!report.ok) return refuse('the preflight failed (see above); nothing was started', 1);

  // D-15: the guard every live start goes through; the authorization's own ceiling may lower it and never raises it.
  process.env['AVARICE_PHASE2_PLAN'] = process.env['AVARICE_PHASE2_PLAN'] ?? '02-22';
  const spent = phase2Spent();
  const ceiling = Math.min(phase2Ceiling(), cap);
  if (!fitsPhase2Ceiling(perRun) || spent + perRun > ceiling + 1e-9) {
    return refuse(`stop and ask the owner (D-15): recorded Phase 2 spend ${spent.toFixed(4)} USD plus this run's cap ${perRun.toFixed(2)} USD would pass the ${ceiling} USD ceiling`, EXIT_CEILING);
  }
  out(`authorized: ${briefArg} (${digest.slice(0, 19)}...), spend ${spent.toFixed(4)} USD plus ${perRun.toFixed(2)} fits ${ceiling} USD, run ${runs.length + 1} of ${maxRuns}\n`);
  return 0;
}

interface RefLine {
  ref: string;
  object: string;
}

function snapshot(repo: string): Json {
  const digest = checkoutDigest(repo, [RUN_REF_GLOB]);
  const stage = mustGit(repo, ['ls-files', '--stage', '-z']);
  const refs: RefLine[] = mustGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => ({ ref: l.slice(0, l.indexOf(' ')), object: l.slice(l.indexOf(' ') + 1) }));
  const headRef = mustGit(repo, ['symbolic-ref', '-q', 'HEAD']).trim();
  const composite = sha256(JSON.stringify({ digest, indexDigest: sha256(stage), headRef }));
  return { schema: 1, takenAt: new Date().toISOString(), repo, digest, indexDigest: sha256(stage), headRef, composite, refs };
}

function toolCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(event) || event['type'] !== 'assistant' || !isObject(event['message']) || !Array.isArray(event['message']['content'])) continue;
    for (const part of event['message']['content'] as unknown[]) {
      if (isObject(part) && part['type'] === 'tool_use' && typeof part['name'] === 'string') counts[part['name']] = (counts[part['name']] ?? 0) + 1;
    }
  }
  return counts;
}

function claudeVersionOf(bin: string | undefined): string {
  if (bin === undefined || bin === '') return 'unknown';
  const ran = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  return /^\s*(\d+\.\d+\.\d+)\b/.exec(ran.stdout ?? '')?.[1] ?? 'unknown';
}

function evidenceCommand(argv: readonly string[]): number {
  const { named } = flags(argv);
  const need = ['run-id', 'brief', 'before', 'after', 'start-exit', 'start-out', 'out', 'ledger', 'repo'];
  const missing = need.filter((k) => named[k] === undefined);
  if (missing.length > 0) {
    errOut(`usage: evidence needs --${missing.join(' --')}`);
    return 2;
  }
  const runId = named['run-id'] as string;
  const outPath = resolve(named['out'] as string);
  const ledgerPath = resolve(named['ledger'] as string);
  const briefPath = resolve(named['brief'] as string);
  const repo = resolve(named['repo'] as string);
  const plan = named['plan'] ?? '02-22';
  const before = readJson(resolve(named['before'] as string)) ?? {};
  const after = readJson(resolve(named['after'] as string)) ?? {};
  const startOut = existsSync(resolve(named['start-out'] as string)) ? readFileSync(resolve(named['start-out'] as string), 'utf8') : '';
  const startErr = named['start-err'] !== undefined && existsSync(resolve(named['start-err'])) ? readFileSync(resolve(named['start-err']), 'utf8') : '';
  const problems: string[] = [];

  const entry: Json = {
    runId,
    brief: briefPath.replace(`${REPO_ROOT}/`, ''),
    briefDigest: briefDigest(briefPath) ?? null,
    startExit: Number(named['start-exit']),
    startedAt: named['started-at'] ?? null,
    endedAt: named['ended-at'] ?? new Date().toISOString(),
    startStdoutTail: startOut.slice(-2000),
    ...(startErr !== '' ? { startStderrTail: startErr.slice(-2000) } : {}),
  };

  // ---- the owner's checkout: before and after ----
  const digestBefore = String(before['composite'] ?? '');
  const digestAfter = String(after['composite'] ?? '');
  const refsOf = (snap: Json): RefLine[] => (Array.isArray(snap['refs']) ? (snap['refs'] as RefLine[]) : []);
  const beforeRefs = new Map(refsOf(before).map((r) => [r.ref, r.object]));
  const afterRefs = new Map(refsOf(after).map((r) => [r.ref, r.object]));
  const newRefs = [...afterRefs.keys()].filter((r) => !beforeRefs.has(r));
  const changedRefs = [...beforeRefs].filter(([r, o]) => afterRefs.get(r) !== o).map(([r]) => r);
  entry['digestBefore'] = digestBefore;
  entry['digestAfter'] = digestAfter;
  entry['checkout'] = { before: { ...before, refs: undefined }, after: { ...after, refs: undefined }, newRefs, removedOrChangedRefs: changedRefs };
  if (digestBefore === '' || digestBefore !== digestAfter) problems.push('the checkout digest differs before and after the run (or one is missing)');
  if (changedRefs.length > 0) problems.push(`refs removed or changed: ${changedRefs.join(', ')}`);
  if (newRefs.some((r) => r !== `refs/heads/avarice/${runId}`)) problems.push(`refs added other than the run's own branch: ${newRefs.join(', ')}`);

  // ---- the run, read-only from the owner's profile ----
  const composed = createDeps(process.env);
  let state = 'unknown';
  let costUsd = 0;
  let version = 'unknown';
  if (!composed.ok) {
    problems.push(`cannot read the profile: ${composed.message}`);
  } else {
    const deps = composed.value.deps;
    try {
      const run = deps.ledger.getRun(runId);
      if (!run.ok) {
        problems.push(`the run ${runId} is not in the ledger: ${describeError(run.error)}`);
      } else {
        state = run.value.state;
        const statuses = getRunStatuses(deps.ledger, run.value.projectId, deps.clock.nowMs());
        const status = statuses.ok ? statuses.value.find((s) => s.runId === runId) : undefined;
        const contractRow = deps.ledger.getRunContract(runId);
        const contract = contractRow.ok && contractRow.value !== null ? (contractRow.value.body as RunContract) : undefined;
        const evidenceRows = deps.ledger.listEvidence(runId);
        const gateRows = deps.ledger.listGateResults(runId);
        const attempts = deps.ledger.listRunAttempts(runId);
        const budgets = deps.ledger.getBudgets(runId);
        const decisions = deps.ledger.listDecisions({ runId });
        const costRow = budgets.ok ? budgets.value.find((b) => b.name === 'costUsd') : undefined;
        costUsd = costRow?.used ?? 0;
        entry['state'] = state;
        entry['reason'] = run.value.reason;
        entry['title'] = run.value.title;
        entry['baseRevision'] = run.value.baseRevision;
        entry['branch'] = run.value.branch;
        entry['status'] = status ?? null;
        entry['commit'] = status?.commit ?? null;
        entry['clean'] = status?.clean ?? null;
        entry['costUsd'] = costUsd;
        entry['budgets'] = status?.budgets ?? [];
        entry['attempts'] = attempts.ok ? attempts.value.map((a) => ({ attemptId: a.attemptId, ordinal: a.ordinal, reason: a.reason, outcome: a.outcome })) : [];
        entry['retries'] = attempts.ok ? Math.max(0, attempts.value.length - 1) : null;
        entry['gates'] = gateRows.ok ? gateRows.value.map((g) => ({ gate: g.gate, passed: g.passed, revision: g.revision, failures: g.failures })) : [];

        // the branch the supervisor fetched into the portfolio
        const branchRef = `refs/heads/avarice/${runId}`;
        entry['branchRefCommit'] = afterRefs.get(branchRef) ?? null;
        if (status !== undefined && status.commit !== null && afterRefs.get(branchRef) !== undefined && afterRefs.get(branchRef) !== status.commit) problems.push(`the branch ${branchRef} is at ${afterRefs.get(branchRef)} but the handed-off commit is ${status.commit}`);

        // ---- required checks and the acceptance mapping, from the final revision ----
        const requiredNames = contract?.verification.requiredChecks ?? [];
        const finalChecks = status?.evidence.filter((e) => e.kind === 'check') ?? [];
        entry['requiredChecks'] = requiredNames.map((name) => {
          const row = finalChecks.find((c) => c.name === name);
          return { name, status: row?.status ?? 'missing', revision: row?.revision ?? null, clean: row?.clean ?? null, ...(row?.preExisting === true ? { preExisting: true } : {}) };
        });
        entry['checks'] = finalChecks;
        const finalRevision = finalChecks[0]?.revision;
        const rows = evidenceRows.ok ? evidenceRows.value.filter((e) => e.revision === finalRevision) : [];
        entry['acceptance'] = (contract?.intent.acceptance ?? []).map((a) => {
          const by = rows.filter((e) => e.independence === 'deterministic' && e.status === 'passed' && e.acceptance.includes(a.id)).map((e) => ({ kind: e.kind, name: e.name, status: e.status, independence: e.independence }));
          return { id: a.id, verifiedBy: a.verifiedBy, satisfiedBy: by, satisfied: by.length > 0 };
        });
        entry['evidenceRows'] = (evidenceRows.ok ? evidenceRows.value : []).map((e) => ({ kind: e.kind, name: e.name, status: e.status, independence: e.independence, revision: e.revision, clean: e.clean, acceptance: e.acceptance, ...(e.environment['phase'] !== undefined ? { phase: e.environment['phase'] } : {}), ...(e.environment['preExisting'] === true ? { preExisting: true } : {}) }));
        if (state === 'ready_for_review') {
          for (const c of entry['requiredChecks'] as Array<{ name: string; status: string; preExisting?: true }>) if (c.status !== 'passed' && c.preExisting !== true) problems.push(`required check ${c.name} is ${c.status} at the final revision`);
          for (const a of entry['acceptance'] as Array<{ id: string; satisfied: boolean }>) if (!a.satisfied) problems.push(`acceptance criterion ${a.id} has no passed deterministic evidence at the final revision`);
          if (status?.clean !== true) problems.push('the final evidence was not taken on a clean tree');
          if (status?.commit === null || status?.commit === undefined) problems.push('no handed-off commit');
          if (!gateRows.ok || !gateRows.value.some((g) => g.gate === 'G4' && g.passed)) problems.push('gate G4 did not pass');
        }

        // ---- the transcripts of this run: the model's tool calls (S-12) ----
        const db = new DatabaseSync(join(deps.profile.dataRoot, 'state.db'), { readOnly: true });
        let digests: string[] = [];
        try {
          digests = (db.prepare("SELECT digest FROM artifacts WHERE kind = 'transcript' AND run_id = ? ORDER BY rowid").all(runId) as Array<{ digest: string }>).map((r) => r.digest);
        } finally {
          db.close();
        }
        const totals: Record<string, number> = {};
        for (const digest of digests) {
          const bytes = deps.artifacts.get(digest);
          if (!bytes.ok) {
            problems.push(`transcript ${digest} is not readable: ${bytes.error.kind}`);
            continue;
          }
          for (const [tool, n] of Object.entries(toolCounts(new TextDecoder().decode(bytes.value)))) totals[tool] = (totals[tool] ?? 0) + n;
        }
        entry['transcriptDigests'] = digests;
        entry['toolCounts'] = totals;
        entry['askUserQuestion'] = totals['AskUserQuestion'] ?? 0;
        if (digests.length === 0 && state === 'ready_for_review') problems.push('the run has no transcript artifact');
        if ((totals['AskUserQuestion'] ?? 0) !== 0) problems.push(`the transcript has ${totals['AskUserQuestion']} AskUserQuestion call(s) (S-12)`);

        // ---- a run that did not reach review: the diagnosis ----
        if (state !== 'ready_for_review') {
          entry['diagnosis'] = {
            state,
            reason: run.value.reason,
            decisions: decisions.ok ? decisions.value.map((d) => ({ decisionId: d.decisionId, class: d.class, issue: d.issue, state: d.state, urgency: d.urgency })) : [],
            gateFailures: gateRows.ok ? gateRows.value.filter((g) => !g.passed).map((g) => ({ gate: g.gate, failures: g.failures, revision: g.revision })) : [],
            transcriptDigests: digests,
            statusJson: status ?? null,
          };
          problems.push(`the run ended ${state}${run.value.reason !== null ? ` (${run.value.reason})` : ''}, not ready_for_review`);
        }
        version = claudeVersionOf(process.env['AVARICE_CLAUDE_BIN']);
      }
    } finally {
      composed.value.close();
    }
  }
  if (entry['state'] === undefined) entry['state'] = state;
  entry['askUserQuestion'] ??= 0;
  entry['costUsd'] ??= 0;
  entry['clean'] ??= null;

  // ---- the spend line, once per run (the cost is whatever the run's costUsd budget says, also for a failed run) ----
  const caseName = `exit-${(briefPath.split('/').pop() ?? 'brief').replace(/\.md$/, '')}-${runId}`;
  const lines = ledgerLines(ledgerPath);
  if (composed.ok && state !== 'unknown' && !lines.some((l) => typeof l['case'] === 'string' && l['case'].endsWith(runId))) {
    appendFileSync(ledgerPath, `${JSON.stringify({ plan, case: caseName, costUsd, claudeVersion: version, at: new Date().toISOString() })}\n`);
    entry['spendLine'] = { plan, case: caseName, costUsd, claudeVersion: version };
  } else entry['spendLine'] = 'already recorded or the run could not be read';
  entry['problems'] = problems;

  // ---- the evidence file: this run replaces an earlier record of itself, and the verdict is recomputed ----
  const file = readJson(outPath) ?? {};
  const prior = Array.isArray(file['runs']) ? (file['runs'] as Json[]).filter((r) => r['runId'] !== runId) : [];
  const runs = [...prior, entry];
  const good = runs.filter((r) => r['state'] === 'ready_for_review' && Array.isArray(r['problems']) && (r['problems'] as unknown[]).length === 0);
  const total = Number(named['expected-runs'] ?? 3);
  const allPass = good.length === total && runs.length === total && new Set(runs.map((r) => String(r['digestAfter']))).size >= 1;
  const finalNewRefs = runs.flatMap((r) => (isObject(r['checkout']) && Array.isArray(r['checkout']['newRefs']) ? (r['checkout']['newRefs'] as string[]) : []));
  const spend = phase2Spent();
  const verdict = allPass && finalNewRefs.length === total ? `exit: ${total}/${total} ready_for_review` : `exit: ${good.length}/${total} ready_for_review${runs.length < total ? ` (${total - runs.length} not run yet)` : ''}${runs.some((r) => Array.isArray(r['problems']) && (r['problems'] as unknown[]).length > 0) ? ' (problems recorded)' : ''}`;
  const result = { schema: 1, plan, decision: 'D-05, D-07, D-08', updatedAt: new Date().toISOString(), verdict, phase2SpentUsd: spend, runs };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);

  out(`run ${runId}: state ${String(entry['state'])}, cost ${costUsd.toFixed(4)} USD, ${problems.length} problem(s)\n`);
  for (const p of problems) out(`PROBLEM: ${p}\n`);
  out(`${verdict}; Phase 2 spend now ${spend.toFixed(4)} USD; evidence ${outPath}\n`);
  return problems.length === 0 && state === 'ready_for_review' ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'dry-run') return dryRun(rest);
  if (command === 'authorize') return authorize(rest);
  if (command === 'evidence') return evidenceCommand(rest);
  if (command === 'snapshot') {
    const { named } = flags(rest);
    if (named['repo'] === undefined) {
      errOut('usage: snapshot --repo REPO');
      return 2;
    }
    out(`${JSON.stringify(snapshot(resolve(named['repo'])))}\n`);
    return 0;
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
  errOut('usage: exit-run-phase2-tools.ts (dry-run | preflight | authorize | snapshot | evidence) ...');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
