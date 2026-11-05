// Writes hook-policy.json for one invocation: the vendor-neutral InvocationScope turned into the policy the hook
// entry (src/hook/pre-tool-use.ts) reads on every tool call. Every path is canonical (symlinks resolved, on-disk
// case on a case-insensitive volume), because the hook compares canonical paths. The file lives in the invocation
// directory under the data root with mode 0600 and is written by temp-and-rename, so a reader never sees half of it.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { HookPolicy } from '../../domain/hook-decision.ts';
import type { InvocationScope } from '../../domain/invocation-scope.ts';
import { canonicalAbsolute } from '../fs/canonical-path.ts';

export const HOOK_POLICY_FILE = 'hook-policy.json';

export interface HookPolicyIdentity {
  onboardingId: string;
  runId: string;
  invocationId: string;
  // Agent types the invocation may start: the names in its --agents file (none for intel).
  subagentTypes: readonly string[];
}

// SHA-256 and byte length of the GSD preamble's first line, fingerprinted at gsd inspect.
export interface PreambleFingerprint {
  sha256: string;
  length: number;
}

export function buildHookPolicy(scope: InvocationScope, ids: HookPolicyIdentity, ledgerPath: string, preamble?: PreambleFingerprint): Result<HookPolicy> {
  const canonical = (path: string): string | null => canonicalAbsolute(path);
  // The run's scratch directory is a write root beside the clone: the file tools may write there as the shell may.
  const writeRoots = [...scope.writeRoots, ...(scope.scratchDir !== undefined ? [scope.scratchDir] : [])];
  const all = [scope.stagingPath, ledgerPath, ...writeRoots, ...scope.denyRead, ...scope.allowRead, ...(scope.readConfine ?? []), ...scope.readRoots];
  const resolved = new Map<string, string>();
  for (const path of all) {
    const c = canonical(path);
    if (c === null) return err({ kind: 'invalid', field: 'hookPolicy', reason: `cannot canonicalize ${path}` });
    resolved.set(path, c);
  }
  const at = (path: string): string => resolved.get(path) as string;
  const sha = preamble?.sha256 ?? scope.commands.preambleSha256;
  return ok({
    schema: 1,
    onboardingId: ids.onboardingId,
    runId: ids.runId,
    invocationId: ids.invocationId,
    purpose: scope.purpose,
    ledgerPath: at(ledgerPath),
    stagingPath: at(scope.stagingPath),
    writeRoots: writeRoots.map(at),
    denyRead: scope.denyRead.map(at),
    allowRead: scope.allowRead.map(at),
    readRoots: scope.readRoots.map(at),
    denyReadGlobs: [...scope.denyReadGlobs],
    ...(scope.readConfine !== undefined ? { readConfine: scope.readConfine.map(at) } : {}),
    commands: {
      strategy: scope.commands.strategy,
      readOnly: [...scope.commands.readOnly],
      gsdReadVerbs: [...scope.commands.gsdReadVerbs],
      deniedPrefixes: [...scope.commands.deniedPrefixes],
      ...(sha !== undefined && preamble !== undefined ? { preambleSha256: sha, preambleLength: preamble.length } : {}),
    },
    subagentTypes: [...ids.subagentTypes],
    subagentsConcurrent: scope.subagents.concurrent,
    // The run purpose's fields, present only when the scope has them, so an onboarding policy file is byte-identical to Phase 1's.
    ...(scope.writeGlobs !== undefined ? { writeGlobs: [...scope.writeGlobs], protectedGlobs: [...(scope.protectedGlobs ?? [])] } : {}),
    ...(scope.commands.agentCommands !== undefined ? { agentCommands: scope.commands.agentCommands.map((c) => ({ words: [...c.words], paths: c.paths })) } : {}),
    ...(scope.deniedTools !== undefined ? { deniedTools: [...scope.deniedTools] } : {}),
    ...(scope.denyBackgroundShell !== undefined ? { denyBackgroundShell: scope.denyBackgroundShell } : {}),
    ...(scope.readBeforeEdit !== undefined ? { readBeforeEdit: scope.readBeforeEdit } : {}),
    ...(scope.escalation !== undefined ? { loopLimits: { consecutiveDenials: scope.escalation.consecutiveDenials, consecutiveSearches: scope.escalation.consecutiveSearches } } : {}),
  });
}

export function writeHookPolicy(invDir: string, scope: InvocationScope, ids: HookPolicyIdentity, ledgerPath: string, preamble?: PreambleFingerprint): Result<{ file: string; policy: HookPolicy }> {
  const built = buildHookPolicy(scope, ids, ledgerPath, preamble);
  if (!built.ok) return built;
  const file = join(invDir, HOOK_POLICY_FILE);
  try {
    mkdirSync(invDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(built.value, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
    return ok({ file, policy: built.value });
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot write ${file}: ${e instanceof Error ? e.message : String(e)}` });
  }
}
