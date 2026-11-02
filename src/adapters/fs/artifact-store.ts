// LocalArtifactStore: placeholder until the implementation commit.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { ArtifactMeta, ArtifactStore } from '../../ports/artifact-store.ts';

export interface FsOps {
  fsyncSync: (fd: number) => void;
  renameSync: (from: string, to: string) => void;
}

const NOT_YET = { kind: 'internal', cause: 'LocalArtifactStore is not implemented yet' } as const;

export class LocalArtifactStore implements ArtifactStore {
  constructor(_dataRoot: string, _ops: Partial<FsOps> = {}) {}
  put(_bytes: Uint8Array, _meta: ArtifactMeta): Result<{ digest: string; size: number }> { return err(NOT_YET); }
  get(_digest: string): Result<Uint8Array> { return err(NOT_YET); }
  has(_digest: string): Result<boolean> { return err(NOT_YET); }
}
