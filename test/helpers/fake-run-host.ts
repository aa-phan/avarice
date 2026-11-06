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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { reapBySessionId } from '../../src/adapters/host-claude/claude-host.ts';
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
  // Where to write {prompt, cwd, invocationId} (the supervisor is another process).
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
}

export const FAKE_QUICK_ID = '261105-fk1-fix';

interface HookRun {
  denied: string | null;
  // The hook told the host to stop (`continue: false`, a loop limit).
  stopped: boolean;
}

function callHook(policyFile: string, cwd: string, event: 'pre' | 'post', toolName: string, toolInput: Record<string, unknown>): HookRun {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', HOOK_ENTRY, '--event', event, '--policy', policyFile], {
    input: JSON.stringify({ cwd, hook_event_name: event === 'pre' ? 'PreToolUse' : 'PostToolUse', tool_name: toolName, tool_input: toolInput }),
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

  constructor(options: FakeRunOptions = {}) {
    this.options = options;
  }

  async invoke(req: InvocationRequest, _signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    this.calls.push(req);
    if (req.purpose !== 'run') return err({ kind: 'unsupported', capability: `fake-run-host:${req.purpose}` });
    const o: FakeRunOptions = { ...this.options, ...(this.options.perAttempt?.[this.calls.length - 1] ?? {}) };
    if (o.refuse === 'unavailable') return err({ kind: 'unavailable', cause: 'the fake host has no sandbox' });
    if (o.refuse === 'internal') return err({ kind: 'internal', cause: 'the fake host failed' });
    const startedMs = Date.now();
    const cwd = realpathSync(req.cwd);
    if (o.recordTo !== undefined) {
      const observed: Record<string, string | null> = {};
      for (const rel of o.observe ?? []) observed[rel] = existsSync(join(cwd, rel)) ? readFileSync(join(cwd, rel), 'utf8') : null;
      writeFileSync(o.recordTo, JSON.stringify({ prompt: req.prompt, cwd, invocationId: req.invocationId, runId: req.runId, observed }));
    }
    const head = gitHead(cwd);

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
    const tool = (name: string, input: Record<string, unknown>, effect: () => void): boolean => {
      const pre = callHook(policyFile, cwd, 'pre', name, input);
      if (pre.stopped) stopped = true;
      if (pre.denied !== null) {
        denies += 1;
        return false;
      }
      effect();
      callHook(policyFile, cwd, 'post', name, input);
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
    for (const [rel, text] of Object.entries(edits)) edit(rel, text);
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

    const quick = o.quickId ?? FAKE_QUICK_ID;
    const wroteEdits = Object.keys(edits).length > 0;
    if ((o.summary ?? wroteEdits) && !crashed) {
      const base = `.planning/quick/${quick}`;
      tool('Write', { file_path: join(cwd, `${base}/${quick}-PLAN.md`), content: 'plan' }, () => write(`${base}/${quick}-PLAN.md`, '# Plan\n\nFix the slug.\n'));
      tool('Write', { file_path: join(cwd, `${base}/${quick}-SUMMARY.md`), content: 'summary' }, () => write(`${base}/${quick}-SUMMARY.md`, `# Summary\n\nFixed the slug.\n${o.summaryText ?? ''}\n`));
      const status = o.verification ?? 'passed';
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
    // A killed unit: the host waits out the clock, then ends the process group.
    if (o.timeoutMs !== undefined) await new Promise<void>((resolve) => setTimeout(resolve, o.timeoutMs));
    const elapsed = Math.max(Date.now() - startedMs, o.timeoutMs ?? 0);
    return ok({
      sessionId: `fake-run-session-${this.calls.length}`,
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
