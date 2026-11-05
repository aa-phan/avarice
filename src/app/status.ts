// `status`: a read-only view of every registered project (docs/repository-onboarding.md "Project record").
// Takes no lease and writes nothing. Index details come from the active project record, never from a
// scan of the repository.
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { isResumable } from '../domain/onboarding-lifecycle.ts';
import type { BlockedReason, OnboardingState } from '../domain/onboarding-lifecycle.ts';
import type { Ledger } from '../ports/ledger.ts';

// An onboarding that stopped short of a stop state with nobody holding a live lease.
export interface Interrupted {
  state: OnboardingState;
  nextAction: string;
  resumeCommand: string;
}

export interface ProjectStatus {
  projectId: string;
  repoPath: string;
  onboardingId: string | null;
  state: OnboardingState;
  reason: BlockedReason | null;
  // Present only when the latest onboarding was interrupted; never present for an active one.
  interrupted?: Interrupted;
  recordVersion: number | null;
  onboardedRevision: string | null;
  mapping: Readonly<Record<string, unknown>> | null;
  indexes: Readonly<Record<string, unknown>>;
}

function asObject(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function leaseIsLive(lease: { leaseHolder: string | null; leaseExpiresAt: string | null }, nowMs: number): boolean {
  return lease.leaseHolder !== null && lease.leaseExpiresAt !== null && Date.parse(lease.leaseExpiresAt) >= nowMs;
}

// Read-only: the lease is read, never taken. A non-stop state whose lease has expired or was never taken
// is shown as interrupted, with the checkpoint's next action and the command that continues it.
export function getStatus(ledger: Ledger, nowMs: number): Result<ProjectStatus[]> {
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
    let interrupted: Interrupted | undefined;
    if (latest !== null && isResumable(latest.state) && !leaseIsLive(latest, nowMs)) {
      const checkpoint = ledger.latestCheckpoint(latest.onboardingId);
      if (!checkpoint.ok) return checkpoint;
      interrupted = {
        state: latest.state,
        nextAction: checkpoint.value === null ? 'unknown' : checkpoint.value.nextAction,
        resumeCommand: `avarice resume ${latest.onboardingId}`,
      };
    }
    entries.push({
      projectId: project.projectId,
      repoPath: project.repoPath,
      onboardingId: latest ? latest.onboardingId : null,
      state: latest ? latest.state : 'unregistered',
      reason: latest ? latest.reason : null,
      ...(interrupted !== undefined ? { interrupted } : {}),
      recordVersion: record ? record.version : null,
      onboardedRevision: record ? record.onboardedRevision : null,
      mapping: record ? asObject(record.body['mapping']) : null,
      indexes: record ? (asObject(record.body['indexes']) ?? {}) : {},
    });
  }
  return ok(entries);
}
