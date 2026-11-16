// FakeRunHost: the offline stand-in for the model in a run (plan 02-13). It plays what a `/gsd-quick --validate` unit does to the clone,
// but every tool call goes through the real hook entry (src/hook/pre-tool-use.ts) under a hook policy built from the invocation's own scope
// by the production code (buildHookPolicy), so the write set, the protected paths, read-before-edit, the loop limits and the budgets are the
// real ones. A call the hook denies is not carried out, as the host would not carry it out. Nothing under src/ imports this file.
//
// What a unit does here: for each edit, PreToolUse and PostToolUse Read, PreToolUse Edit, the write, PostToolUse Edit (a new file: Write);
// then the quick records (`.planning/quick/<id>/<id>-PLAN.md`, `-SUMMARY.md`, `-VERIFICATION.md`) with Write. The misbehaviours the run
// tests need are options: an attempted commit and a moved HEAD, a pause question, an edit outside the write set, a direct write the hook
// never sees (a sandbox gap), a fix that leaves the check failing, and (plan 02-16) a crash or a wall-clock kill after some files were written,
// a loop of denied calls, a flood of tool calls, and a different behaviour per attempt.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { assertLaunchArgsSafe, buildLaunchArgs } from '../../src/adapters/host-claude/launch-args.ts';
import { reapBySessionId } from '../../src/adapters/host-claude/claude-host.ts';
import { buildInvocationEnv } from '../../src/adapters/host-claude/env.ts';
import { buildHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import { PURPOSE_EXTENSIONS } from '../../src/domain/invocation-scope.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest, ReapRequest } from '../../src/ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { HOOK_ENTRY } from './fake-agent-host.ts';

export interface FakeRunOptions {
  // Clone-relative path -> the file's new content. An existing file is read and edited, a missing one is created.
  edits?: Readonly<Record<string, string>>;
  // Write the quick SUMMARY (default true when there are edits).
  summary?: boolean;
  // The `status:` of the quick VERIFICATION (default `passed`); `none` writes no VERIFICATION.
  verification?: 'passed' | 'gaps_found' | 'human_needed' | 'none';
  // Plan 03-61. The status of the quick VERIFICATION depends on the prompt the unit was given: `passed` when the prompt holds a line equal to `marker` followed
  // by a bullet line `- <check>` (a bullet list of the lines that start `- `), `otherwise` when it does not. It stands in for the 03-57 unit, which escalated a
  // required check it was never told was pre-existing. When present it takes precedence over `verification`. JSON-serializable, like every option here.
  verificationByPrompt?: { marker: string; check: string; otherwise: 'human_needed' | 'gaps_found' };
  // Plan 03-64. The fake unit stands in for the 03-63 unit, which ran `npm run build` exactly as its prompt listed it and without VITE_SITE_ORIGIN. It takes the first bullet
  // under the prompt line 'Commands you may run, exactly as written:' whose text equals `command` or ends with a space and `command` (a check command carries its environment
  // first), calls the real hook with that bullet as a Bash command and, when the hook admits it, runs it in the clone under the environment the real host adapter builds
  // (buildInvocationEnv, with this node's directory appended to PATH so the fixture's `node` is found). The VERIFICATION status is `passed` when it exits 0 and `otherwise` when
  // it exits non-zero, is refused, or no bullet matches. It takes precedence over `verification` and `verificationByPrompt`. With `recordTo`, the record gains
  // `listed: { command, denied, exitCode }` (exitCode null when the command did not run). JSON-serializable, like every option here.
  runListedCommand?: { command: string; otherwise: 'human_needed' | 'gaps_found' };
  // Plan 03-64. Shell lines the unit tries through the real hook, in order, before `runListedCommand`. A line the hook admits is run as `runListedCommand` runs its command
  // and its exit code is recorded, never judged; a refused line is not run. With `recordTo`, the record gains `shell: [{ command, denied, exitCode }]` (exitCode null
  // when the line did not run). It is how a test shows that an environment other than the listed one is refused and never runs. JSON-serializable.
  shellAttempts?: readonly string[];
  // Plan 03-69 (D-26, D-27). The fake unit stands in for run 3's attempt-1 verifier, which could not search because the host had removed Grep. After the edits the unit
  // starts its verifier (one Agent call, subagent_type gsd-verifier, through the real hook) and the verifier searches for `pattern` under the clone-relative `path`.
  // Whether its session has the Grep tool is decided from the production launch line (buildLaunchArgs for this request) by `hostKeepsSearchTools`. When it has not, the
  // Grep call fails as the host fails it (the hook never sees it) and the verifier tries `grep -rn <pattern> <path>` through the real hook; the status is `otherwise`.
  // When it has, each `outside` path is first tried as a Grep through the real hook (a refused call never searches), then the Grep of `path` goes through the hook and,
  // when admitted, the fake searches the files under `path` in the clone (skipping `.git`, one regular expression match per line); the status is `passed` when the sorted
  // matched files equal the sorted `expect` and `gaps_found` otherwise. Takes precedence over `verification`, `verificationByPrompt` and `runListedCommand`. With
  // `recordTo`, the record gains `search: { available, outside: [{ path, denied }], denied, matched, shell }` (shell null, or { command, denied }). JSON-serializable.
  verifierSearch?: { pattern: string; path: string; expect: readonly string[]; outside?: readonly string[]; otherwise: 'human_needed' | 'gaps_found' };
  // Plan 03-71 (D-26, D-27). The fake unit stands in for run 3's attempt-2 unit, whose planner made a gate of a declared check because its prompt listed the command, and whose
  // verifier wrote human_needed when that command could not pass as written. It decides only from the prompt the real code produced. After the edits and after `shellAttempts`,
  // for each entry: `named` is whether the prompt holds a line equal to `notJudgedMarker` followed by the bullet `- <name>` (promptNames); `listed` is whether the prompt's
  // 'Commands you may run, exactly as written:' bullets hold one equal to `command` or ending with a space and `command`. Only an entry that is listed and not named becomes a gate:
  // its bullet goes through the real hook and, when admitted, runs as `runListedCommand` runs its command. The status is `passed` when every gate it made exited 0 (which includes
  // making none) and `otherwise` when a gate exited non-zero or was refused. Takes precedence over `verificationByPrompt` and `verification`, after `verifierSearch` and
  // `runListedCommand`. With `recordTo`, the record gains `gates: [{ name, listed, named, denied, exitCode }]` (denied false and exitCode null for an entry that made no gate).
  // JSON-serializable, like every option here.
  planGates?: { checks: ReadonlyArray<{ name: string; command: string }>; notJudgedMarker: string; otherwise: 'human_needed' | 'gaps_found' };
  // Run `git commit` through the hook (denied), then move the clone HEAD with a direct git call, as a containment bypass would.
  commitAttempt?: boolean;
  // The pause text the host captured: the unit stopped to ask.
  question?: string;
  // An edit to a path outside the write set (the hook denies it).
  deniedEdit?: string;
  // Direct writes the hook never sees, as a sandbox gap would allow: clone-relative path -> content.
  strayWrite?: Readonly<Record<string, string>>;
  // A fix that leaves the check failing: only a comment is added to src/slug.ts.
  brokenFix?: boolean;
  // Extra text for the SUMMARY (for example a node-repair PRUNE line).
  summaryText?: string;
  // Extra lines for the VERIFICATION frontmatter (for example `overrides_applied: 1`).
  verificationExtra?: readonly string[];
  // The host refuses to run the unit at all and returns this error kind (no sandbox, a failed launch self-test, an internal fault).
  refuse?: 'unavailable' | 'internal';
  // Test-file options (plan 02-14, AUT-9). `deleteTest` removes `test('<name>', ...)` from the file, `addSkip` turns it into `test.skip(...)`, `addTest`
  // appends a new test (body defaults to a slugify assertion), `editPackageJson` rewrites the `test` script of package.json directly (a protected path),
  // `addOverride` writes `overrides_applied: 1` into the VERIFICATION.
  deleteTest?: { file: string; name: string };
  addSkip?: { file: string; name: string };
  addTest?: { file: string; name: string; body?: string };
  editPackageJson?: boolean;
  addOverride?: boolean;
  // Where to write {prompt, cwd, invocationId, runId, sessionId, resumeSessionId, observed} (the supervisor is another process).
  recordTo?: string;
  // Quick directory name; default `261105-fk1-fix`.
  quickId?: string;
  // Plan 02-16 (CON-16). The unit writes these clone-relative files (an existing one gets a trailing line, a missing one is created, both
  // through the hook) and then dies: exit 1, no result event, no quick records. `costUsd` is what the host reports it spent.
  crash?: { afterFiles: readonly string[]; costUsd?: number };
  // The unit runs past the wall clock: it is killed after this many milliseconds (SIGKILL, timedOut, no result). Combines with `crash`
  // (the files it wrote before the kill) or stands alone.
  timeoutMs?: number;
  // The unit makes this many denied calls in a row (a Write outside the write set). The real hook turns the third into `continue: false`
  // and a loop.limit event; the host stops making calls at that point, as the real one ends the session.
  denyLoop?: number;
  // The unit makes this many Read calls of src/slug.ts (each is a tool call the hook charges to the toolCalls budget).
  toolCallFlood?: number;
  // Clone-relative files whose content (null when absent) is recorded under `observed` in the `recordTo` file at the start of the invocation:
  // what the clone looked like when the unit began.
  observe?: readonly string[];
  // The n-th invocation of this host (1-based; index n-1) plays these options over the base ones. Lets one test script attempt 1 and attempt 2.
  perAttempt?: readonly FakeRunOptions[];
  // Plan 02-17 (FR-7). The supervisor dies inside the unit, as a kill of the supervisor would: the unit writes these clone-relative files (as
  // `crash.afterFiles` does) and, when `survivorPidFile` is given, leaves a process carrying the invocation's session ID in its command line
  // running (the host the supervisor's death orphaned; its PID is written to the file), then the supervisor process is SIGKILLed.
  killInUnit?: { afterFiles?: readonly string[]; survivorPidFile?: string };
  // The host's `reap` fails with an internal error (it could not search for processes), so a resume must not go on.
  reapFails?: boolean;
  // Plan 02-19. The unit waits this many milliseconds (asynchronously, so the supervisor's timers keep running) before it touches the clone: a run an
  // observer can watch in `running`, with the `launch:run` checkpoint committed, while its supervisor is still working.
  delayMs?: number;
  // Plan 02-30 (R-IN-06). After its edits the unit starts a sleeper in its own process group (its command line carries the session ID), calls `onStart`,
  // and then hangs: until its abort signal fires (it ends the group, records `abortedAtMs`, and reports a SIGTERM end with no result), or until `maxMs`
  // passes (it ends the group and finishes normally). The host's own process group is what a real host's abort ends.
  hangUntilAbort?: { maxMs: number; onStart?: (request: InvocationRequest) => void };
  // Plan 03-11 (D-06, D-08). One host script for several work items and a resumed session. The item of an invocation is the `Work item <ID>:` line of
  // its prompt (the line the production unit and resume prompts write); a fresh call of item B plays the base options, then `perItem.B`, then
  // `perItem.B.perAttempt[n]` for the n-th fresh call of B (0-based; resumed calls are not counted). A call that carries `resumeSessionId` plays the
  // base options and `perItem.B.resume`, or `resume` when B has no entry of its own: it does not replay the options that paused it. An item with no
  // entry, and a prompt with no item line, play the base options and the base `perAttempt[n]` (Phase 2's script, unchanged). Every option here must
  // stay JSON-serializable: the options travel to the supervisor as AVARICE_FAKE_HOST.
  perItem?: Readonly<Record<string, FakeRunOptions>>;
  resume?: FakeRunOptions;
  // A resumed call (one that carries `resumeSessionId`) ends as the real CLI ends for a session it does not know (spike S3-A, plan 03-13): a result event of
  // subtype `error_during_execution` with `is_error` true, no turns, no cost and exit 1, nothing written to the clone, kind `failed`. Only a resumed call is
  // affected, so it belongs in a `resume` entry; a fresh call ignores it. It lets a test reach the fresh-unit fallback.
  missingSession?: boolean;
  // The unit makes this many Agent calls through the real hook, before its edits, each with its own tool_use_id and a completion after it (so each is
  // charged to subagentsTotal and none stays in flight). The outcome reports how many the hook admitted as `details.subagentsSpawned`.
  subagents?: number;
  // The text of the quick PLAN.md the unit leaves (written through the hook like the SUMMARY). It is written even when the unit writes no SUMMARY, as a
  // unit that stopped to ask after it planned would leave it. Absent: the default plan, written only together with the SUMMARY.
  planText?: string;
  // Plan 03-43. The host keeps each session it starts under `<effective config dir>/fake-sessions/<session id>`, where the effective directory is the
  // CLAUDE_CONFIG_DIR of the process the host runs in (else HOME/.claude), and a resumed call whose session is not under the launching process's directory
  // ends as a missing session. This is how the real host behaves: it does not look across configuration directories. Off by default, so a test that runs
  // the host in this process never writes under the real home.
  sessionsPerConfigDir?: boolean;
}

// The item line of a unit or resume prompt: a line that starts `Work item <ID>:`, or the first line of the quoted task text. A phrase of that shape
// in the middle of a line (a brief title) is not an item line.
const ITEM_LINE = /(?:^|--text ")Work item ([A-Z][A-Za-z0-9_-]{0,31}):/m;

const COMMANDS_LINE = 'Commands you may run, exactly as written:';

// The bullets (without the `- `) of the run of `- ` lines right after the 'Commands you may run, exactly as written:' line.
export function listedCommandsOf(prompt: string): string[] {
  const lines = prompt.split('\n');
  const at = lines.indexOf(COMMANDS_LINE);
  const out: string[] = [];
  if (at < 0) return out;
  for (let i = at + 1; i < lines.length && (lines[i] as string).startsWith('- '); i += 1) out.push((lines[i] as string).slice(2));
  return out;
}

export const itemOfPrompt = (prompt: string): string | undefined => ITEM_LINE.exec(prompt)?.[1];

// Whether the prompt has a line equal to `marker` and, right after it, a run of bullet lines (`- ...`) that holds `- <check>`.
export function promptNames(prompt: string, marker: string, check: string): boolean {
  const lines = prompt.split('\n');
  const at = lines.indexOf(marker);
  if (at < 0) return false;
  for (let i = at + 1; i < lines.length && (lines[i] as string).startsWith('- '); i += 1) {
    if (lines[i] === `- ${check}`) return true;
  }
  return false;
}

// Whether the host keeps its Glob and Grep tools in a session launched with `argv`. This is the pinned 2.1.319 host's rule as host-search-tools.test.ts measures it on the
// real binary: without a `--tools`, `--allowedTools` or `--allowed-tools` flag that names Glob or Grep, the host removes both tools from a session that has a shell and from
// every agent it resolves. The flag's value is split on commas and spaces, and a parenthesized suffix (`Grep(src/**)`) is cut before the name is compared.
export function hostKeepsSearchTools(argv: readonly string[]): boolean {
  const flags = new Set(['--tools', '--allowedTools', '--allowed-tools']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    const equals = token.startsWith('--') ? token.indexOf('=') : -1;
    const flag = equals === -1 ? token : token.slice(0, equals);
    if (!flags.has(flag)) continue;
    const value = equals === -1 ? (argv[i + 1] ?? '') : token.slice(equals + 1);
    for (const entry of value.split(/[,\s]+/)) {
      const name = entry.replace(/\(.*$/, '');
      if (name === 'Glob' || name === 'Grep') return true;
    }
  }
  return false;
}

// The options without the keys that select options: what a selected layer contributes to the merged options.
function withoutSelectors(options: FakeRunOptions | undefined): FakeRunOptions {
  if (options === undefined) return {};
  const { perItem: _perItem, resume: _resume, perAttempt: _perAttempt, ...rest } = options;
  return rest;
}

// The options one invocation plays (plan 03-11): see `FakeRunOptions.perItem`. `perItemCallIndex` is the 0-based number of fresh calls of the
// same item (or of no item) before this one. The result carries none of the selecting keys.
export function selectFakeOptions(base: FakeRunOptions, request: Pick<InvocationRequest, 'prompt' | 'resumeSessionId'>, perItemCallIndex: number): FakeRunOptions {
  const item = itemOfPrompt(request.prompt);
  const entry = item !== undefined && base.perItem !== undefined && Object.hasOwn(base.perItem, item) ? base.perItem[item] : undefined;
  const own = withoutSelectors(base);
  if (request.resumeSessionId !== undefined) return { ...own, ...withoutSelectors(entry?.resume ?? base.resume) };
  if (entry !== undefined) return { ...own, ...withoutSelectors(entry), ...withoutSelectors(entry.perAttempt?.[perItemCallIndex]) };
  return { ...own, ...withoutSelectors(base.perAttempt?.[perItemCallIndex]) };
}

export const FAKE_QUICK_ID = '261105-fk1-fix';

// The configuration directory of the process the fake host runs in: CLAUDE_CONFIG_DIR when set and not empty, else HOME/.claude (the real host's rule).
function effectiveConfigDir(): string {
  const set = process.env['CLAUDE_CONFIG_DIR'];
  if (set !== undefined && set !== '') return set;
  return join(process.env['HOME'] !== undefined && process.env['HOME'] !== '' ? process.env['HOME'] : homedir(), '.claude');
}

interface HookRun {
  denied: string | null;
  // The hook told the host to stop (`continue: false`, a loop limit).
  stopped: boolean;
}

// `extra` carries the top-level fields of the hook input beside the tool call (`tool_use_id`).
function callHook(policyFile: string, cwd: string, event: 'pre' | 'post', toolName: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}): HookRun {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', HOOK_ENTRY, '--event', event, '--policy', policyFile], {
    input: JSON.stringify({ cwd, hook_event_name: event === 'pre' ? 'PreToolUse' : 'PostToolUse', tool_name: toolName, tool_input: toolInput, ...extra }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(`the hook exited ${String(result.status)}: ${result.stderr}`);
  if (event === 'post' || result.stdout.trim() === '') return { denied: null, stopped: false };
  const out = JSON.parse(result.stdout) as { continue?: boolean; hookSpecificOutput: { permissionDecisionReason: string } };
  return { denied: out.hookSpecificOutput.permissionDecisionReason.replace(/^avarice: /, ''), stopped: out.continue === false };
}

const gitHead = (cwd: string): string => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();

export class FakeRunHost implements AgentHost {
  readonly descriptor: CapabilityDescriptor = {
    port: 'agent-host',
    adapter: 'fake-run',
    version: '0.0.0',
    capabilities: { 'contained-invocation': true },
    attributes: { enforcement: 'enforced' },
    offline: true,
  };
  readonly options: FakeRunOptions;
  readonly calls: InvocationRequest[] = [];
  // `hangUntilAbort`: the sleeper's PID (its process group ID), when the abort was observed, and when the sleeper was started.
  sleeperPid: number | undefined;
  abortedAtMs: number | undefined;
  hangStartedAtMs: number | undefined;
  // Fresh calls so far by item ID ('' for a prompt with no item line): the index `selectFakeOptions` takes.
  private readonly freshCalls = new Map<string, number>();

  constructor(options: FakeRunOptions = {}) {
    this.options = options;
  }

  async invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    this.calls.push(req);
    if (req.purpose !== 'run') return err({ kind: 'unsupported', capability: `fake-run-host:${req.purpose}` });
    let freshIndex = 0;
    if (req.resumeSessionId === undefined) {
      const key = itemOfPrompt(req.prompt) ?? '';
      freshIndex = this.freshCalls.get(key) ?? 0;
      this.freshCalls.set(key, freshIndex + 1);
    }
    const o = selectFakeOptions(this.options, req, freshIndex);
    // The session the unit runs under: a resumed session wins over a fresh one (as the real adapter does), else the caller's, else a made-up one.
    const sessionId = req.resumeSessionId ?? req.sessionId ?? `fake-run-session-${this.calls.length}`;
    // The session store of this process's configuration directory (plan 03-43): a session is kept where it was started, and only there.
    const sessionsDir = o.sessionsPerConfigDir === true ? join(effectiveConfigDir(), 'fake-sessions') : undefined;
    const unknownHere = sessionsDir !== undefined && req.resumeSessionId !== undefined && !existsSync(join(sessionsDir, req.resumeSessionId));
    if (sessionsDir !== undefined && !unknownHere) {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, sessionId), '');
    }
    if (o.refuse === 'unavailable') return err({ kind: 'unavailable', cause: 'the fake host has no sandbox' });
    if (o.refuse === 'internal') return err({ kind: 'internal', cause: 'the fake host failed' });
    // Plan 03-69: the production launch line for this request, judged as the real adapter judges it (the placeholders stand for the generated files).
    let launchArgs: string[] = [];
    if (o.verifierSearch !== undefined) {
      launchArgs = buildLaunchArgs({
        prompt: req.prompt,
        settingsFile: '/avarice-fake-run/host-settings.json',
        pluginDir: '/avarice-fake-run/plugin',
        agentsFile: '/avarice-fake-run/agents.json',
        mcpFile: '/avarice-fake-run/mcp.json',
        model: req.model,
        costCapUsd: req.costCapUsd,
        sessionId: req.sessionId ?? `fake-run-session-${this.calls.length}`,
        ...(req.resumeSessionId !== undefined ? { resumeSessionId: req.resumeSessionId } : {}),
        ...(req.agentName !== undefined ? { agent: req.agentName } : {}),
      });
      const safe = assertLaunchArgsSafe(launchArgs);
      if (!safe.ok) return err({ kind: 'denied', rule: `enforcement_failure:${safe.error.kind === 'denied' ? safe.error.rule.replace(/^launch_args:/, 'launch-args:') : 'launch-args'}`, enforcer: 'avarice' });
    }
    const startedMs = Date.now();
    const cwd = realpathSync(req.cwd);
    let record: Record<string, unknown> | undefined;
    if (o.recordTo !== undefined) {
      const observed: Record<string, string | null> = {};
      for (const rel of o.observe ?? []) observed[rel] = existsSync(join(cwd, rel)) ? readFileSync(join(cwd, rel), 'utf8') : null;
      record = { prompt: req.prompt, cwd, invocationId: req.invocationId, runId: req.runId, sessionId, resumeSessionId: req.resumeSessionId, observed };
      writeFileSync(o.recordTo, JSON.stringify(record));
    }
    if (o.delayMs !== undefined) await new Promise<void>((resolve) => setTimeout(resolve, o.delayMs));
    const head = gitHead(cwd);

    // A session the CLI does not know: spike S3-A measured that it prints a result event (`error_during_execution`, an error, no turns, no cost) and exits 1,
    // before it touches anything. The adapter reports it as kind `failed` and drops the host's own message.
    if (req.resumeSessionId !== undefined && (o.missingSession === true || unknownHere)) {
      return ok({
        sessionId,
        kind: 'failed',
        permissionDenials: [],
        costUsd: 0,
        durationMs: Date.now() - startedMs,
        headBefore: head,
        headAfter: head,
        details: { exitCode: 1, signal: null, timedOut: false, headMoved: false, transcriptBytes: 0, hookDenies: 0, hookBudgetDenies: 0, numTurns: 0, resultSeen: true, isError: true, subtype: 'error_during_execution' },
      });
    }

    const built = buildHookPolicy(
      req.scope,
      { onboardingId: req.onboardingId, runId: req.runId, invocationId: req.invocationId, subagentTypes: [...PURPOSE_EXTENSIONS.run.agents] },
      join(realpathSync(req.scope.dataRoot), 'state.db'),
    );
    if (!built.ok) return err({ kind: 'internal', cause: `the fake host could not build a hook policy: ${built.error.kind}` });
    const dir = mkdtempSync(join(tmpdir(), 'avarice-fake-run-hook-'));
    const policyFile = join(dir, 'hook-policy.json');
    writeFileSync(policyFile, JSON.stringify(built.value), { mode: 0o600 });

    let denies = 0;
    let stopped = false;
    // One tool call: PreToolUse, the effect when allowed, PostToolUse.
    const tool = (name: string, input: Record<string, unknown>, effect: () => void, extra: Record<string, unknown> = {}): boolean => {
      const pre = callHook(policyFile, cwd, 'pre', name, input, extra);
      if (pre.stopped) stopped = true;
      if (pre.denied !== null) {
        denies += 1;
        return false;
      }
      effect();
      callHook(policyFile, cwd, 'post', name, input, extra);
      return true;
    };
    const write = (rel: string, text: string): void => {
      const target = join(cwd, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    };
    const edit = (rel: string, text: string): void => {
      const target = join(cwd, rel);
      if (existsSync(target)) {
        const seen = callHook(policyFile, cwd, 'pre', 'Read', { file_path: target });
        if (seen.denied === null) callHook(policyFile, cwd, 'post', 'Read', { file_path: target });
        tool('Edit', { file_path: target, old_string: readFileSync(target, 'utf8').slice(0, 8), new_string: 'edited' }, () => write(rel, text));
      } else {
        tool('Write', { file_path: target, content: text }, () => write(rel, text));
      }
    };

    const edits: Record<string, string> = { ...(o.edits ?? {}) };
    // The content a file will have once the edits so far are in, for the test-file options below.
    const current = (rel: string): string => edits[rel] ?? readFileSync(join(cwd, rel), 'utf8');
    if (o.deleteTest !== undefined) {
      // Removes `test('<name>', ...)` through its closing `});` line.
      const lines = current(o.deleteTest.file).split('\n');
      const start = lines.findIndex((line) => line.includes(`test('${o.deleteTest?.name}'`));
      const end = lines.findIndex((line, index) => index > start && line === '});');
      if (start === -1 || end === -1) throw new Error(`the fake host found no test ${o.deleteTest.name} in ${o.deleteTest.file}`);
      lines.splice(start, end - start + 1);
      edits[o.deleteTest.file] = lines.join('\n');
    }
    if (o.addSkip !== undefined) {
      const text = current(o.addSkip.file);
      if (!text.includes(`test('${o.addSkip.name}'`)) throw new Error(`the fake host found no test ${o.addSkip.name} in ${o.addSkip.file}`);
      edits[o.addSkip.file] = text.replace(`test('${o.addSkip.name}'`, `test.skip('${o.addSkip.name}'`);
    }
    if (o.addTest !== undefined) {
      edits[o.addTest.file] = `${current(o.addTest.file).replace(/\n*$/, '\n')}\ntest('${o.addTest.name}', () => {\n  ${o.addTest.body ?? "assert.equal(slugify('a--b'), 'a-b');"}\n});\n`;
    }
    if (o.brokenFix === true) {
      const original = readFileSync(join(cwd, 'src/slug.ts'), 'utf8');
      edits['src/slug.ts'] = `${original}// attempted fix\n`;
    }
    // Agent calls through the hook, one after another (each completes before the next starts, so none holds a concurrency slot).
    let subagentsAdmitted = 0;
    for (let i = 0; i < (o.subagents ?? 0) && !stopped; i += 1) {
      const admitted = tool(
        'Agent',
        { subagent_type: 'gsd-executor', description: `fake subagent ${i + 1}`, prompt: 'work' },
        () => {},
        { tool_use_id: `toolu_fake_${i + 1}` },
      );
      if (admitted) subagentsAdmitted += 1;
    }
    for (const [rel, text] of Object.entries(edits)) edit(rel, text);
    // Plan 03-69: the verifier the unit starts, searching the clone (see `verifierSearch`).
    let searchStatus: 'passed' | 'human_needed' | 'gaps_found' | undefined;
    if (o.verifierSearch !== undefined && !stopped) {
      const v = o.verifierSearch;
      const verifier = { agent_id: 'agent-fake-verifier', agent_type: 'gsd-verifier' };
      const started = tool('Agent', { subagent_type: 'gsd-verifier', description: 'verify the work', prompt: 'verify' }, () => {}, { tool_use_id: 'toolu_fake_verifier' });
      const available = hostKeepsSearchTools(launchArgs);
      const outside: Array<{ path: string; denied: boolean }> = [];
      let matched: string[] = [];
      let searchDenied = false;
      let shell: { command: string; denied: boolean } | null = null;
      if (started && available) {
        for (const path of v.outside ?? []) {
          if (stopped) break;
          outside.push({ path, denied: !tool('Grep', { pattern: v.pattern, path }, () => {}, verifier) });
        }
        const found = new Set<string>();
        const expression = new RegExp(v.pattern);
        const walk = (dir: string): void => {
          for (const name of readdirSync(dir).sort()) {
            if (name === '.git') continue;
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (readFileSync(full, 'utf8').split('\n').some((line) => expression.test(line))) found.add(relative(cwd, full));
          }
        };
        const admitted = tool('Grep', { pattern: v.pattern, path: v.path }, () => walk(join(cwd, v.path)), verifier);
        searchDenied = !admitted;
        matched = [...found].sort();
        searchStatus = admitted && JSON.stringify(matched) === JSON.stringify([...v.expect].sort()) ? 'passed' : 'gaps_found';
      } else if (started) {
        // The host answers the Grep call with its own error and the hook never sees it; the verifier then tries the shell.
        const command = `grep -rn ${v.pattern} ${v.path}`;
        shell = { command, denied: !tool('Bash', { command }, () => {}, verifier) };
        searchStatus = v.otherwise;
      } else {
        searchStatus = v.otherwise;
      }
      if (o.recordTo !== undefined) {
        record = { ...record, search: { available, outside, denied: searchDenied, matched, shell } };
        writeFileSync(o.recordTo, JSON.stringify(record));
      }
    }
    const crashed = o.crash !== undefined || o.timeoutMs !== undefined;
    for (const rel of o.crash?.afterFiles ?? []) {
      const marker = '// partial write of a unit that stopped before it finished\n';
      edit(rel, existsSync(join(cwd, rel)) ? `${readFileSync(join(cwd, rel), 'utf8')}${marker}` : marker);
    }
    for (let i = 0; i < (o.toolCallFlood ?? 0); i += 1) tool('Read', { file_path: join(cwd, 'src/slug.ts') }, () => {});

    if (o.killInUnit !== undefined) {
      const marker = '// partial write of a unit whose supervisor was killed\n';
      for (const rel of o.killInUnit.afterFiles ?? []) edit(rel, existsSync(join(cwd, rel)) ? `${readFileSync(join(cwd, rel), 'utf8')}${marker}` : marker);
      if (o.killInUnit.survivorPidFile !== undefined) {
        // stdio must be `ignore`: the process that waits on this supervisor's pipes would otherwise wait for the survivor too.
        // Long-lived: a suite that builds several killed runs before its first test runs (a loaded machine) must still find it alive; every suite ends
        // its survivors in `after`.
        const survivor = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1800000)', '--', '--session-id', req.sessionId ?? ''], { detached: true, stdio: 'ignore' });
        survivor.unref();
        if (survivor.pid !== undefined) writeFileSync(o.killInUnit.survivorPidFile, String(survivor.pid));
        // Start-up margin: the process must have parsed its arguments before the supervisor dies, or the reap cannot find it.
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
      }
      process.kill(process.pid, 'SIGKILL');
    }

    if (o.deniedEdit !== undefined) {
      const target = join(cwd, o.deniedEdit);
      tool('Write', { file_path: target, content: 'outside the write set\n' }, () => write(o.deniedEdit as string, 'outside the write set\n'));
    }

    // Plan 03-64: the command the prompt lists for a check, run as the unit would run it (see `runListedCommand`). Plan 03-71: the gates the unit makes of the commands its prompt
    // lists and does not name as judged by no gate (see `planGates`).
    let listedStatus: 'passed' | 'human_needed' | 'gaps_found' | undefined;
    let gatesStatus: 'passed' | 'human_needed' | 'gaps_found' | undefined;
    if (o.runListedCommand !== undefined || o.shellAttempts !== undefined || o.planGates !== undefined) {
      const hostEnv = buildInvocationEnv(process.env, {
        gsdCoreBin: join(tmpdir(), 'avarice-fake-run-no-such-gsd-core-bin'),
        onboardingId: req.onboardingId,
        marker: req.runId,
        ...(req.scope.scratchDir !== undefined ? { scratchDir: req.scope.scratchDir } : {}),
        extraPath: [dirname(process.execPath)],
      });
      // One Bash call through the real hook; an admitted line runs under the environment the real host adapter builds, a refused one never runs.
      const runShell = (command: string): { command: string; denied: boolean; exitCode: number | null } => {
        const seen: { command: string; denied: boolean; exitCode: number | null } = { command, denied: false, exitCode: null };
        const admitted = tool('Bash', { command }, () => {
          seen.exitCode = spawnSync('/bin/sh', ['-c', command], { cwd, env: hostEnv, encoding: 'utf8', timeout: 60_000 }).status;
        });
        seen.denied = !admitted;
        return seen;
      };
      const attempted: Array<{ command: string; denied: boolean; exitCode: number | null }> = [];
      for (const line of o.shellAttempts ?? []) {
        if (stopped) break;
        attempted.push(runShell(line));
      }
      let listed: { command: string; denied: boolean; exitCode: number | null } | undefined;
      if (o.runListedCommand !== undefined) {
        const wanted = o.runListedCommand.command;
        const bullet = listedCommandsOf(req.prompt).find((b) => b === wanted || b.endsWith(` ${wanted}`));
        listed = bullet === undefined ? { command: wanted, denied: false, exitCode: null } : runShell(bullet);
        listedStatus = listed.exitCode === 0 ? 'passed' : o.runListedCommand.otherwise;
      }
      let gates: Array<{ name: string; listed: boolean; named: boolean; denied: boolean; exitCode: number | null }> | undefined;
      if (o.planGates !== undefined) {
        const plan = o.planGates;
        gates = [];
        let failed = false;
        for (const entry of plan.checks) {
          const named = promptNames(req.prompt, plan.notJudgedMarker, entry.name);
          const bullet = listedCommandsOf(req.prompt).find((b) => b === entry.command || b.endsWith(` ${entry.command}`));
          const made = bullet !== undefined && !named && !stopped ? runShell(bullet) : undefined;
          if (made !== undefined && (made.denied || made.exitCode !== 0)) failed = true;
          gates.push({ name: entry.name, listed: bullet !== undefined, named, denied: made?.denied ?? false, exitCode: made?.exitCode ?? null });
        }
        gatesStatus = failed ? plan.otherwise : 'passed';
      }
      if (o.recordTo !== undefined) {
        writeFileSync(
          o.recordTo,
          JSON.stringify({ ...record, ...(listed !== undefined ? { listed } : {}), ...(o.shellAttempts !== undefined ? { shell: attempted } : {}), ...(gates !== undefined ? { gates } : {}) }),
        );
      }
    }

    const quick = o.quickId ?? FAKE_QUICK_ID;
    const wroteEdits = Object.keys(edits).length > 0;
    const base = `.planning/quick/${quick}`;
    const writesSummary = (o.summary ?? wroteEdits) && !crashed;
    if (!crashed && (o.planText !== undefined || writesSummary)) {
      const plan = o.planText ?? '# Plan\n\nFix the slug.\n';
      tool('Write', { file_path: join(cwd, `${base}/${quick}-PLAN.md`), content: plan }, () => write(`${base}/${quick}-PLAN.md`, plan));
    }
    if (writesSummary) {
      tool('Write', { file_path: join(cwd, `${base}/${quick}-SUMMARY.md`), content: 'summary' }, () => write(`${base}/${quick}-SUMMARY.md`, `# Summary\n\nFixed the slug.\n${o.summaryText ?? ''}\n`));
      const status = searchStatus ?? listedStatus ?? gatesStatus ?? (o.verificationByPrompt !== undefined ? (promptNames(req.prompt, o.verificationByPrompt.marker, o.verificationByPrompt.check) ? 'passed' : o.verificationByPrompt.otherwise) : (o.verification ?? 'passed'));
      if (status !== 'none') {
        const extra = [...(o.verificationExtra ?? []), ...(o.addOverride === true ? ['overrides_applied: 1'] : [])];
        const text = ['---', `status: ${status}`, ...extra, '---', '', '# Verification', ''].join('\n');
        tool('Write', { file_path: join(cwd, `${base}/${quick}-VERIFICATION.md`), content: text }, () => write(`${base}/${quick}-VERIFICATION.md`, text));
      }
    }

    // A loop of denied calls: after the third the hook asks the host to stop, and the host makes no further call.
    for (let i = 0; i < (o.denyLoop ?? 0) && !stopped; i += 1) {
      tool('Write', { file_path: join(cwd, 'outside-the-write-set.txt'), content: 'x\n' }, () => write('outside-the-write-set.txt', 'x\n'));
    }

    if (o.commitAttempt === true) {
      const pre = callHook(policyFile, cwd, 'pre', 'Bash', { command: 'git commit -m bypass' });
      if (pre.denied !== null) denies += 1;
      // The bypass: a commit made behind the hook's back, so the clone HEAD moves.
      execFileSync('git', ['-c', 'user.name=Bypass', '-c', 'user.email=bypass@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'bypass'], { cwd });
    }
    for (const [rel, text] of Object.entries(o.strayWrite ?? {})) write(rel, text);
    // A package.json script edit made behind the hook's back (the hook denies a protected path, so the change must come as a sandbox gap would
    // let it): G2 sees a changed protected path.
    if (o.editPackageJson === true) {
      const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      manifest.scripts['test'] = 'node --test --test-name-pattern=nothing test/';
      write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    }

    const headAfter = gitHead(cwd);
    let abortedByCaller = false;
    if (o.hangUntilAbort !== undefined) {
      const hang = o.hangUntilAbort;
      // stdio must be `ignore` (see killInUnit above); detached makes the sleeper the leader of its own process group.
      const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1800000)', '--', '--session-id', req.sessionId ?? ''], { detached: true, stdio: 'ignore' });
      sleeper.unref();
      this.sleeperPid = sleeper.pid;
      // Start-up margin: the process must exist before the unit starts to hang.
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      this.hangStartedAtMs = Date.now();
      hang.onStart?.(req);
      abortedByCaller = await new Promise<boolean>((resolve) => {
        if (signal.aborted) return resolve(true);
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(false);
        }, hang.maxMs);
        const onAbort = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
      if (abortedByCaller) this.abortedAtMs = Date.now();
      // SIGTERM to the group, then SIGKILL after a short grace, as the real adapter does.
      if (sleeper.pid !== undefined) {
        const groupAlive = (): boolean => {
          try {
            process.kill(-(sleeper.pid as number), 0);
            return true;
          } catch {
            return false;
          }
        };
        try {
          process.kill(-sleeper.pid, 'SIGTERM');
        } catch {
          // already gone
        }
        const deadline = Date.now() + 500;
        while (groupAlive() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 25));
        if (groupAlive()) {
          try {
            process.kill(-sleeper.pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
      }
    }
    // A killed unit: the host waits out the clock, then ends the process group.
    if (o.timeoutMs !== undefined) await new Promise<void>((resolve) => setTimeout(resolve, o.timeoutMs));
    const elapsed = Math.max(Date.now() - startedMs, o.timeoutMs ?? 0);
    if (abortedByCaller) {
      return ok({
        sessionId,
        kind: 'inconclusive',
        permissionDenials: [],
        costUsd: 0,
        durationMs: elapsed,
        headBefore: head,
        headAfter,
        details: {
          exitCode: null,
          signal: 'SIGTERM',
          timedOut: false,
          headMoved: head !== headAfter,
          transcriptBytes: 0,
          hookDenies: denies,
          hookBudgetDenies: 0,
          numTurns: 1,
          resultSeen: false,
        },
      });
    }
    return ok({
      sessionId,
      kind: crashed ? 'inconclusive' : denies > 0 && !wroteEdits ? 'denied' : 'progressed',
      permissionDenials: [],
      costUsd: o.crash?.costUsd ?? 0,
      durationMs: elapsed,
      headBefore: head,
      headAfter,
      ...(o.question !== undefined ? { question: o.question } : {}),
      details: {
        exitCode: o.timeoutMs !== undefined ? null : crashed ? 1 : 0,
        signal: o.timeoutMs !== undefined ? 'SIGKILL' : null,
        timedOut: o.timeoutMs !== undefined,
        headMoved: head !== headAfter,
        transcriptBytes: 0,
        hookDenies: denies,
        hookBudgetDenies: 0,
        numTurns: 1,
        resultSeen: !crashed,
        ...(crashed ? {} : { isError: false }),
        ...(o.subagents !== undefined ? { subagentsSpawned: subagentsAdmitted } : {}),
      },
    });
  }

  // The production reaper, so a resume that reaps through this host ends survivors the way the real adapter does (plan 02-17).
  readonly reaped: string[] = [];
  async reap(request: ReapRequest): Promise<Result<{ terminated: number }>> {
    if (this.options.reapFails === true) return err({ kind: 'internal', cause: 'the fake host could not search for processes' });
    const ended = await reapBySessionId(request.sessionId);
    if (ended.ok && ended.value.terminated > 0) this.reaped.push(request.sessionId);
    return ended;
  }
}
