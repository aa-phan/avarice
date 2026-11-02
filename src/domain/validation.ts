import type { MappingPlan } from './mapping.ts';

export interface MapArtifactFacts {
  stagingHead: string;
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
export function validateMapArtifacts(_facts: MapArtifactFacts, _plan: MappingPlan): MapValidation {
  return { accepted: false, checks: [] };
}
