// `status`: a read-only view of every registered project (docs/repository-onboarding.md "Project record").
// Takes no lease and writes nothing. Index details come from the active project record, never from a
// scan of the repository.
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { BlockedReason, OnboardingState } from '../domain/onboarding-lifecycle.ts';
import type { Ledger } from '../ports/ledger.ts';

export interface ProjectStatus {
  projectId: string;
  repoPath: string;
  onboardingId: string | null;
  state: OnboardingState;
  reason: BlockedReason | null;
  recordVersion: number | null;
  onboardedRevision: string | null;
  mapping: Readonly<Record<string, unknown>> | null;
  indexes: Readonly<Record<string, unknown>>;
}

function asObject(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// nowMs is reserved for lease-aware rendering (plan 01-06); the entries do not depend on it yet.
export function getStatus(ledger: Ledger, _nowMs: number): Result<ProjectStatus[]> {
  const projects = ledger.listProjects();
  if (!projects.ok) return projects;
  const entries: ProjectStatus[] = [];
  for (const project of projects.value) {
    const onboardings = ledger.listOnboardings(project.projectId);
    if (!onboardings.ok) return onboardings;
    const latest = onboardings.value.at(-1) ?? null;
    const active = ledger.getActiveRecord(project.projectId);
    if (!active.ok) return active;
    const record = active.value;
    entries.push({
      projectId: project.projectId,
      repoPath: project.repoPath,
      onboardingId: latest ? latest.onboardingId : null,
      state: latest ? latest.state : 'unregistered',
      reason: latest ? latest.reason : null,
      recordVersion: record ? record.version : null,
      onboardedRevision: record ? record.onboardedRevision : null,
      mapping: record ? asObject(record.body['mapping']) : null,
      indexes: record ? (asObject(record.body['indexes']) ?? {}) : {},
    });
  }
  return ok(entries);
}

export function renderStatus(entries: readonly ProjectStatus[]): string {
  if (entries.length === 0) return 'No projects registered.\n';
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${e.repoPath}  [${e.projectId}]`);
    const reason = e.reason ? ` (${e.reason})` : '';
    lines.push(e.onboardingId ? `  onboarding ${e.onboardingId}: ${e.state}${reason}` : '  not onboarded');
    if (e.recordVersion !== null) {
      const m = e.mapping;
      const mapping = m ? `; mapping ${String(m['mode'])} (${String(m['completeness'])}, ${String(m['freshness'])})` : '';
      const indexes = Object.keys(e.indexes);
      lines.push(`  record v${e.recordVersion} at ${e.onboardedRevision}${mapping}; indexes: ${indexes.length > 0 ? indexes.join(', ') : 'none'}`);
    }
  }
  return lines.join('\n') + '\n';
}
