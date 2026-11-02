// Mapping modes, the GSD map file sets and completeness labels
// (docs/repository-onboarding.md "Mapping-mode decision table", "Validation").

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
