// Digest of what waits for the owner (plan 03-23; D-23, D-24; AUT-6). Stub: filled in by the GREEN commit of the same task.
import { err } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { AppDeps } from './deps.ts';

export interface DigestOutcome {
  posted: boolean;
  decisions: number;
  reviews: number;
  result: 'delivered' | 'failed' | 'held' | 'none';
  errorCode?: string;
}

export function runDigest(_deps: AppDeps, _nowMs: number): Promise<Result<DigestOutcome>> {
  return Promise.resolve(err({ kind: 'internal', cause: 'not implemented' }));
}
