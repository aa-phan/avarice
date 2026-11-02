// Mapping modes, the GSD map file sets and completeness labels
// (docs/repository-onboarding.md "Mapping-mode decision table", "Validation").
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import type { ExistingMapClass } from './preflight.ts';

export const MAPPING_MODES = ['skip', 'adopt', 'fast', 'full', 'paths'] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

export type Completeness = 'complete' | 'partial' | 'none';

export interface MappingPlan {
  mode: MappingMode;
  paths?: readonly string[];
  existingMapAnswer?: 'refresh' | 'update' | 'skip';
}

const DIR = '.planning/codebase/';
const file = (name: string): string => `${DIR}${name}.md`;

// GSD 1.17 map completeness is checked by file existence (onboard-projection.cjs:29-35):
// seven files for a complete map, four for a fast map (workflows/scan.md `tech+arch`).
export const FULL_MAP_FILES: readonly string[] = [
  'STACK',
  'ARCHITECTURE',
  'STRUCTURE',
  'CONVENTIONS',
  'TESTING',
  'INTEGRATIONS',
  'CONCERNS',
].map(file);

export const FAST_MAP_FILES: readonly string[] = ['STACK', 'INTEGRATIONS', 'ARCHITECTURE', 'STRUCTURE'].map(file);

// Files a mode must produce. `adopt` takes an existing map, which GSD recognises from four files up;
// plan 01-10 adds the remaining rules. `skip` maps nothing, so nothing is required.
export function requiredFilesFor(mode: MappingMode): readonly string[] {
  switch (mode) {
    case 'skip':
      return [];
    case 'fast':
    case 'adopt':
      return FAST_MAP_FILES;
    case 'full':
    case 'paths':
      return FULL_MAP_FILES;
    default:
      throw new TypeError(`unknown mapping mode ${String(mode)}`);
  }
}

// Completeness is never above what the evidence supports (ONB-7): only a full map is `complete`.
// An adopted map is `complete` only when every full-map file is present; without that
// evidence it is `partial`.
export function completenessFor(mode: MappingMode, filesPresent?: readonly string[]): Completeness {
  switch (mode) {
    case 'full':
      return 'complete';
    case 'fast':
    case 'paths':
      return 'partial';
    case 'skip':
      return 'none';
    case 'adopt': {
      const present = new Set(filesPresent ?? []);
      return FULL_MAP_FILES.every((f) => present.has(f)) ? 'complete' : 'partial';
    }
    default:
      throw new TypeError(`unknown mapping mode ${String(mode)}`);
  }
}

export interface MappingModeInput {
  isBrownfield: boolean;
  requested?: string;
  existingMap?: ExistingMapClass;
}

export interface MappingModeDecision {
  mode: MappingMode;
  completeness: Completeness;
  existingMap: ExistingMapClass;
  reason: string;
}

// The decision table of docs/repository-onboarding.md "Mapping-mode decision table", as far as Phase 1
// implements it. In order:
//   - not brownfield (GSD's own `is_brownfield`): skip mapping, completeness `none`;
//   - requested `paths`: unsupported, reduced mode `fast` (path scope is Phase 4);
//   - requested `adopt`: unsupported, reduced mode `full` (adopting a stamped map is Phase 4);
//   - requested `skip`: skip; requested `fast`: fast (`partial`); otherwise full (`complete`).
// An existing map of any classification does not change the mode: it is regenerated in isolation in the
// staging workspace, and the classification is carried so the caller can pass the contract's existing-map answer.
export function chooseMappingMode(input: MappingModeInput): Result<MappingModeDecision> {
  const existingMap: ExistingMapClass = input.existingMap ?? 'none';
  const requested = input.requested;
  if (requested !== undefined && !(MAPPING_MODES as readonly string[]).includes(requested)) {
    return err({ kind: 'invalid', field: 'mode', reason: `unknown mapping mode ${JSON.stringify(requested)}` });
  }
  const decide = (mode: MappingMode, reason: string): Result<MappingModeDecision> =>
    ok({ mode, completeness: completenessFor(mode), existingMap, reason });

  if (!input.isBrownfield) return decide('skip', 'not brownfield: planning from the brief only');
  switch (requested) {
    case 'paths':
      return err({ kind: 'unsupported', capability: 'map-paths', reducedMode: 'fast', detail: 'path-scoped mapping arrives in Phase 4' });
    case 'adopt':
      return err({ kind: 'unsupported', capability: 'adopt-map', reducedMode: 'full', detail: 'adopting an existing stamped map arrives in Phase 4; the map is regenerated in staging' });
    case 'skip':
      return decide('skip', 'mapping skipped on request');
    case 'fast':
      return decide('fast', 'fast map requested');
    default:
      return decide('full', existingMap === 'none' ? 'brownfield repository, full map' : `existing map (${existingMap}) regenerated in staging, full map`);
  }
}
