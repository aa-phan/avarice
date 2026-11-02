// Helpers shared by the stages that work on the stored onboarding contract and the staging map files.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { FULL_MAP_FILES, requiredFilesFor } from '../../domain/mapping.ts';
import type { OnboardingContract } from '../../domain/onboarding-contract.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { StagingWorkspace } from '../../ports/staging-workspace.ts';
import type { AppDeps } from '../deps.ts';

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

// The map documents present in staging: the files the mode requires plus any other full-map file.
// A file above the read limit counts as present with no stamp, so it fails validation instead of
// aborting the run.
export function readMapDocuments(staging: StagingWorkspace, stagingPath: string, contract: OnboardingContract): Result<MapDocument[]> {
  const names = [...new Set([...requiredFilesFor(contract.mapping.mode), ...FULL_MAP_FILES])];
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
