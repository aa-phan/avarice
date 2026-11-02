// Map artifact validation: presence and stamp (docs/repository-onboarding.md "Validation").
// Plan 01-10 adds scope-of-writes, path references, secrets, size and structure, and coverage claims.
import { requiredFilesFor } from './mapping.ts';
import type { Completeness, MappingPlan } from './mapping.ts';

export const VALIDATION_LIMITS = { danglingShare: 0.05, maxBytes: 262144 } as const;
export type ValidationLimits = { danglingShare: number; maxBytes: number };

// H2 headings of the two GSD 1.17.0 templates under gsd-core/templates/codebase/ (stack.md, architecture.md).
export const TEMPLATE_HEADINGS: Readonly<Record<string, readonly string[]>> = {};

export interface MapFileFact {
  path: string;
  // null when the frontmatter has no stamp.
  lastMappedCommit: string | null;
  text: string;
  bytes: number;
  // The file was above the read limit; its text is empty.
  oversize?: boolean;
}

export interface MapArtifactFacts {
  stagingHead: string;
  // One entry per map file found in staging.
  files: ReadonlyArray<MapFileFact>;
  // The staging diff against the pin, as names.
  changes: { modified: readonly string[]; added: readonly string[]; deleted: readonly string[] };
  // Globs the staging diff may touch, and the globs under which a tracked file may be modified.
  allowedWrite: readonly string[];
  trackedWritable: readonly string[];
  // Tracked paths at the pin, and other paths the documents may name.
  knownPaths: readonly string[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface MapValidation {
  accepted: boolean;
  // A secret hit: blocks the onboarding with a decision, no retry.
  block: boolean;
  checks: ValidationCheck[];
  completeness: Completeness;
  scope: string[];
  // Staging paths outside the allowed write sets, and secret hits (pattern and line, never text).
  scopeViolations: string[];
  secretHits: Array<{ path: string; pattern: string; line: number }>;
}

const bare = (commit: string): string => (commit.startsWith('git:') ? commit.slice(4) : commit);

export function validateMapArtifacts(facts: MapArtifactFacts, plan: MappingPlan, _limits: ValidationLimits = VALIDATION_LIMITS): MapValidation {
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

  return {
    accepted: presence.passed && stamp.passed,
    block: false,
    checks: [presence, stamp],
    completeness: 'none',
    scope: [],
    scopeViolations: [],
    secretHits: [],
  };
}
