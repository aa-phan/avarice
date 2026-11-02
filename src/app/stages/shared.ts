// Helpers shared by the stages that work on the stored onboarding contract and the staging map files.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { FAST_MAP_FILES, FULL_MAP_FILES, MAPPING_MODES, requiredFilesFor } from '../../domain/mapping.ts';
import type { MappingMode } from '../../domain/mapping.ts';
import type { OnboardingContract } from '../../domain/onboarding-contract.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { StagingWorkspace } from '../../ports/staging-workspace.ts';
import type { AppDeps } from '../deps.ts';
import type { StageContext } from './stage.ts';

export const MAP_DIR = '.planning/codebase';
// Plan 01-10 applies the configurable size cap (256 KiB default) as a validation check.
export const MAX_MAP_DOCUMENT_BYTES = 1024 * 1024;

export interface StoredContract {
  runId: string;
  version: number;
  digest: string;
  body: OnboardingContract;
}

export function loadContract(deps: AppDeps, onboardingId: string): Result<StoredContract> {
  const stored = deps.ledger.getContract(onboardingId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `onboarding ${onboardingId} has no stored contract` });
  return ok({
    runId: stored.value.runId,
    version: stored.value.version,
    digest: stored.value.digest,
    body: stored.value.body as OnboardingContract,
  });
}

export function stagingPathOf(row: OnboardingRow): Result<string> {
  if (row.stagingWorktree === null) {
    return err({ kind: 'internal', cause: `onboarding ${row.onboardingId} has no staging worktree recorded` });
  }
  return ok(row.stagingWorktree);
}

export interface MapDocument {
  path: string;
  text: string;
  lastMappedCommit: string | null;
}

// `last_mapped_commit` from a leading YAML frontmatter block, or null when there is none.
export function frontmatterStamp(text: string): string | null {
  const normalized = text.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return null;
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^last_mapped_commit:\s*(.*)$/.exec(line);
    if (match) {
      const value = (match[1] as string).trim().replace(/^(['"])(.*)\1$/, '$2').trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

// What the workspace stage decided from GSD's probe (step `mapping:plan`): the mode the map stage runs, validation
// checks and the record states. Absent only for an onboarding that never reached the probe.
export interface StoredMappingPlan {
  mode: MappingMode;
  completeness: string;
  existingMap: string;
  existingMapAnswer?: 'refresh' | 'update' | 'skip';
}

export function loadMappingPlan(deps: AppDeps, onboardingId: string): Result<StoredMappingPlan | null> {
  const steps = deps.ledger.getStepResults(onboardingId);
  if (!steps.ok) return steps;
  const found = [...steps.value].reverse().find((s) => s.step === 'mapping:plan');
  if (found === undefined) return ok(null);
  const body = typeof found.result === 'object' && found.result !== null ? (found.result as Record<string, unknown>) : {};
  const mode = body['mode'];
  if (typeof mode !== 'string' || !(MAPPING_MODES as readonly string[]).includes(mode)) {
    return err({ kind: 'internal', cause: `onboarding ${onboardingId} has a mapping:plan step with no valid mode` });
  }
  const answer = body['existingMapAnswer'];
  return ok({
    mode: mode as MappingMode,
    completeness: typeof body['completeness'] === 'string' ? body['completeness'] : '',
    existingMap: typeof body['existingMap'] === 'string' ? body['existingMap'] : 'none',
    ...(answer === 'refresh' || answer === 'update' || answer === 'skip' ? { existingMapAnswer: answer } : {}),
  });
}

// The mode in force: the probe's plan when there is one, else the contract's.
export function effectiveMappingMode(deps: AppDeps, onboardingId: string, contract: OnboardingContract): Result<MappingMode> {
  const plan = loadMappingPlan(deps, onboardingId);
  if (!plan.ok) return plan;
  return ok(plan.value === null ? contract.mapping.mode : plan.value.mode);
}

// GSD must be present and admitted before staging is touched or a host invoked (ONB-12, S-36).
export function stopIncompatible(ctx: StageContext, row: OnboardingRow, found: string, admitted: string): Result<void> {
  ctx.note(`gsd-core is incompatible: ${found}; admitted: ${admitted}`);
  const moved = ctx.transition(row, 'incompatible', 'none', { data: { found: found.slice(0, 500), admitted } });
  return moved.ok ? ok(undefined) : moved;
}

// A fast map is stamped by AVARICE, not by the mapper (ONB-7, spike S0-A): `stamp-codebase-map --files` for the four
// fast-map files, run by GSD in staging. The outcome is recorded as step `gsd:stamp`. A stamp that fails is
// recorded as failed and not raised: the unstamped files fail validation, which owns the retry and the block.
export async function stampFastMap(deps: AppDeps, onboardingId: string, staging: string): Promise<Result<void>> {
  const startedMs = deps.clock.nowMs();
  const stamped = deps.gsd === undefined ? undefined : await deps.gsd.stamp(staging, FAST_MAP_FILES);
  const recorded = deps.ledger.recordStepResult(onboardingId, {
    step: 'gsd:stamp',
    status: stamped?.ok ? 'completed' : 'failed',
    result: stamped === undefined ? { error: 'no gsd adapter' } : stamped.ok ? stamped.value : { error: stamped.error.kind },
    nowMs: startedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  return recorded.ok ? ok(undefined) : recorded;
}

// The map documents present in staging: the files the mode requires plus any other full-map file.
// A file above the read limit counts as present with no stamp, so it fails validation instead of
// aborting the run.
export function readMapDocuments(staging: StagingWorkspace, stagingPath: string, mode: MappingMode): Result<MapDocument[]> {
  const names = [...new Set([...requiredFilesFor(mode), ...FULL_MAP_FILES])];
  const documents: MapDocument[] = [];
  for (const path of names) {
    const read = staging.read(stagingPath, path, MAX_MAP_DOCUMENT_BYTES);
    if (!read.ok) {
      if (read.error.kind === 'invalid' && read.error.field === 'size') {
        documents.push({ path, text: '', lastMappedCommit: null });
        continue;
      }
      return read;
    }
    if (read.value === null) continue;
    documents.push({ path, text: read.value, lastMappedCommit: frontmatterStamp(read.value) });
  }
  return ok(documents);
}
