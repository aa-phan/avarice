export type MappingMode = 'skip' | 'adopt' | 'fast' | 'full' | 'paths';
export interface MappingPlan {
  mode: MappingMode;
  paths?: readonly string[];
  existingMapAnswer?: 'refresh' | 'update' | 'skip';
}
export const FULL_MAP_FILES: readonly string[] = [];
export const FAST_MAP_FILES: readonly string[] = [];
export function requiredFilesFor(_mode: MappingMode): readonly string[] {
  throw new Error('not implemented');
}
export function completenessFor(_mode: MappingMode): string {
  throw new Error('not implemented');
}
