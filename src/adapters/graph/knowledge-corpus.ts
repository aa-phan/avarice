// RED stub (plan 01-18 Task 1).
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CorpusDrop, KnowledgeManifest } from '../../domain/knowledge-corpus.ts';

export function fileSizes(stagingPath: string, paths: readonly string[]): Result<Record<string, number>> {
  void stagingPath;
  void paths;
  return ok({});
}

export function materializeCorpus(stagingPath: string, paths: readonly string[], manifestFile: string, pin: string, dropped: readonly CorpusDrop[] = []): Result<{ manifest: KnowledgeManifest }> {
  void stagingPath;
  void paths;
  void manifestFile;
  void pin;
  void dropped;
  return err({ kind: 'internal', cause: 'RED stub' });
}
