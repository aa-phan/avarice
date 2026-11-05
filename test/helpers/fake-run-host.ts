// FakeRunHost: the offline stand-in for the model in a run (plan 02-13). It plays what a `/gsd-quick --validate` unit does to the clone,
// but every tool call goes through the real hook entry (src/hook/pre-tool-use.ts) under a hook policy built from the invocation's own scope
// by the production code (buildHookPolicy), so the write set, the protected paths, read-before-edit, the loop limits and the budgets are the
// real ones. A call the hook denies is not carried out, as the host would not carry it out. Nothing under src/ imports this file.
//
// What a unit does here: for each edit, PreToolUse and PostToolUse Read, PreToolUse Edit, the write, PostToolUse Edit (a new file: Write);
// then the quick records (`.planning/quick/<id>/<id>-PLAN.md`, `-SUMMARY.md`, `-VERIFICATION.md`) with Write. The misbehaviours the run
// tests need are options: an attempted commit and a moved HEAD, a pause question, an edit outside the write set, a direct write the hook
// never sees (a sandbox gap), and a fix that leaves the check failing.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import { PURPOSE_EXTENSIONS } from '../../src/domain/invocation-scope.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
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
  // Where to write {prompt, cwd, invocationId} (the supervisor is another process).
  recordTo?: string;
  // Quick directory name; default `261105-fk1-fix`.
  quickId?: string;
}

export const FAKE_QUICK_ID = '261105-fk1-fix';

interface HookRun {
  denied: string | null;
}

function callHook(policyFile: string, cwd: string, event: 'pre' | 'post', toolName: string, toolInput: Record<string, unknown>): HookRun {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', HOOK_ENTRY, '--event', event, '--policy', policyFile], {
    input: JSON.stringify({ cwd, hook_event_name: event === 'pre' ? 'PreToolUse' : 'PostToolUse', tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(`the hook exited ${String(result.status)}: ${result.stderr}`);
  if (event === 'post' || result.stdout.trim() === '') return { denied: null };
  const reason = (JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason;
  return { denied: reason.replace(/^avarice: /, '') };
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
    const o = this.options;
    const startedMs = Date.now();
    const cwd = realpathSync(req.cwd);
    if (o.recordTo !== undefined) writeFileSync(o.recordTo, JSON.stringify({ prompt: req.prompt, cwd, invocationId: req.invocationId, runId: req.runId }));
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
    // One tool call: PreToolUse, the effect when allowed, PostToolUse.
    const tool = (name: string, input: Record<string, unknown>, effect: () => void): boolean => {
      const pre = callHook(policyFile, cwd, 'pre', name, input);
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
    if (o.brokenFix === true) {
      const original = readFileSync(join(cwd, 'src/slug.ts'), 'utf8');
      edits['src/slug.ts'] = `${original}// attempted fix\n`;
    }
    for (const [rel, text] of Object.entries(edits)) edit(rel, text);

    if (o.deniedEdit !== undefined) {
      const target = join(cwd, o.deniedEdit);
      tool('Write', { file_path: target, content: 'outside the write set\n' }, () => write(o.deniedEdit as string, 'outside the write set\n'));
    }

    const quick = o.quickId ?? FAKE_QUICK_ID;
    const wroteEdits = Object.keys(edits).length > 0;
    if (o.summary ?? wroteEdits) {
      const base = `.planning/quick/${quick}`;
      tool('Write', { file_path: join(cwd, `${base}/${quick}-PLAN.md`), content: 'plan' }, () => write(`${base}/${quick}-PLAN.md`, '# Plan\n\nFix the slug.\n'));
      tool('Write', { file_path: join(cwd, `${base}/${quick}-SUMMARY.md`), content: 'summary' }, () => write(`${base}/${quick}-SUMMARY.md`, `# Summary\n\nFixed the slug.\n${o.summaryText ?? ''}\n`));
      const status = o.verification ?? 'passed';
      if (status !== 'none') {
        const text = ['---', `status: ${status}`, ...(o.verificationExtra ?? []), '---', '', '# Verification', ''].join('\n');
        tool('Write', { file_path: join(cwd, `${base}/${quick}-VERIFICATION.md`), content: text }, () => write(`${base}/${quick}-VERIFICATION.md`, text));
      }
    }

    if (o.commitAttempt === true) {
      const pre = callHook(policyFile, cwd, 'pre', 'Bash', { command: 'git commit -m bypass' });
      if (pre.denied !== null) denies += 1;
      // The bypass: a commit made behind the hook's back, so the clone HEAD moves.
      execFileSync('git', ['-c', 'user.name=Bypass', '-c', 'user.email=bypass@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'bypass'], { cwd });
    }
    for (const [rel, text] of Object.entries(o.strayWrite ?? {})) write(rel, text);

    const headAfter = gitHead(cwd);
    return ok({
      sessionId: `fake-run-session-${this.calls.length}`,
      kind: denies > 0 && !wroteEdits ? 'denied' : 'progressed',
      permissionDenials: [],
      costUsd: 0,
      durationMs: Date.now() - startedMs,
      headBefore: head,
      headAfter,
      ...(o.question !== undefined ? { question: o.question } : {}),
      details: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        headMoved: head !== headAfter,
        transcriptBytes: 0,
        hookDenies: denies,
        hookBudgetDenies: 0,
        numTurns: 1,
        resultSeen: true,
        isError: false,
      },
    });
  }
}
