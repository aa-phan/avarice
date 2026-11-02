// Result and error model (docs/contracts-and-state.md "Results and errors").
// Pure: no imports. Ports and domain functions return Result; they never throw across a boundary.

export type Enforcer = 'host' | 'external-platform' | 'avarice';

export type PortError =
  | { kind: 'unsupported'; capability: string; reducedMode?: string }
  | { kind: 'denied'; rule: string; enforcer: Enforcer }
  | { kind: 'unauthenticated'; credentialRef: string; recovery: string }
  | { kind: 'not_found'; ref: string }
  | { kind: 'conflict'; expected: string; actual: string }
  | { kind: 'unavailable'; retryAfterMs?: number; cause: string }
  | { kind: 'timeout'; afterMs: number; sideEffect: 'none' | 'unknown' }
  | { kind: 'cancelled'; sideEffect: 'none' | 'unknown' }
  | { kind: 'invalid'; field: string; reason: string }
  | { kind: 'internal'; cause: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: PortError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(error: PortError): Result<never> {
  return { ok: false, error };
}
