// Map artifact validation: presence and stamp (docs/repository-onboarding.md "Validation").
// Plan 01-10 adds scope-of-writes, path references, secrets, size and structure, and coverage claims.
import { requiredFilesFor } from './mapping.ts';
import type { MappingPlan } from './mapping.ts';

export interface MapArtifactFacts {
  stagingHead: string;
  // One entry per map file found in staging; lastMappedCommit is null when the frontmatter has no stamp.
  files: ReadonlyArray<{ path: string; lastMappedCommit: string | null }>;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface MapValidation {
  accepted: boolean;
  checks: ValidationCheck[];
}

const bare = (commit: string): string => (commit.startsWith('git:') ? commit.slice(4) : commit);

export function validateMapArtifacts(facts: MapArtifactFacts, plan: MappingPlan): MapValidation {
  const required = requiredFilesFor(plan.mode);

  const stampsByPath = new Map<string, Array<string | null>>();
  for (const f of facts.files) {
    const list = stampsByPath.get(f.path);
    if (list) list.push(f.lastMappedCommit);
    else stampsByPath.set(f.path, [f.lastMappedCommit]);
  }

  const missing = required.filter((p) => !stampsByPath.has(p));
  const presence: ValidationCheck = {
    name: 'presence',
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? `${required.length} required file(s) present`
        : `missing: ${missing.join(', ')}`,
  };

  const head = bare(facts.stagingHead);
  const badStamps: string[] = [];
  for (const path of required) {
    const stamps = stampsByPath.get(path);
    if (!stamps) continue;
    for (const stamp of stamps) {
      const value = stamp === null ? '' : bare(stamp);
      if (head === '' || value === '' || value !== head) {
        badStamps.push(`${path} (${stamp === null || value === '' ? 'no stamp' : `stamped ${value}`})`);
      }
    }
  }
  const stamp: ValidationCheck = {
    name: 'stamp',
    passed: badStamps.length === 0,
    detail:
      badStamps.length === 0
        ? `last_mapped_commit equals the staging HEAD in ${required.length} file(s)`
        : `${head === '' ? 'staging HEAD is empty; ' : ''}not equal to staging HEAD ${head}: ${badStamps.join(', ')}`,
  };

  return { accepted: presence.passed && stamp.passed, checks: [presence, stamp] };
}
