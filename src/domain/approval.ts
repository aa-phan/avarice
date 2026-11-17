// Parameter-bound approvals (plan 04-16; FR-12, FR-13, FR-15, ADR-005, D-18). An approval authorizes one action with exactly the parameters it was
// granted for, once, inside its window: it is matched on the scope (the run ID, an onboarding ID or `attended:<session id>`), the action and the
// SHA-256 of the canonical JSON of the parameters, and it is consumed in the transaction that records the action's start. Pure.
import { canonicalJson, digestOf, sha256Hex } from './digest.ts';

// An approval granted now stops being usable this long afterwards (docs/contracts-and-state.md "approvals": single use, 30 minutes).
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

// What an approval is shown to the owner as: bounded, so an event never carries a payload.
const MAX_VALUE_CHARS = 80;
const MAX_SUMMARY_CHARS = 400;
const ATTENDED_PREFIX = 'attended:';
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

// The parameters of an action as the approval binds them: SHA-256 of their canonical JSON, so key order never matters and any changed value gives a
// different digest. A value with no canonical form (NaN, a function, a class instance) throws TypeError: it cannot be approved.
export function paramsDigest(params: unknown): string {
  return digestOf(params);
}

// The idempotency key of an approval row: SHA-256 over the scope, the action, the parameter digest and the ordinal, which counts the earlier
// approvals for the same scope, action and digest. Without the ordinal a fresh approval after expiry would collide with the expired one.
export function approvalKey(scope: string, action: string, digest: string, ordinal: number): string {
  return sha256Hex(canonicalJson([scope, action, digest, ordinal]));
}

// What decides whether an approval can still start an action. It expires at `expiresAt` exactly: at that instant it is already expired, one
// millisecond earlier it is valid. A revoked or consumed approval is never usable, and a stored time that is not a time is never usable.
export function isUsable(row: { expiresAt: string; revokedAt: string | null; consumedAt: string | null }, nowMs: number): boolean {
  if (row.revokedAt !== null || row.consumedAt !== null) return false;
  return Date.parse(row.expiresAt) > nowMs;
}

// The events of an attended session carry no run ID; every other scope is the ID of the run or onboarding the action belongs to.
export function scopeRunId(scope: string): string | undefined {
  return scope.startsWith(ATTENDED_PREFIX) ? undefined : scope;
}

function clip(text: string, max: number): string {
  const clean = text.replace(CONTROL, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function show(value: unknown): string {
  if (typeof value === 'string') return clip(value, MAX_VALUE_CHARS);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return clip(canonicalJson(value), MAX_VALUE_CHARS);
  } catch {
    return '[unprintable]';
  }
}

// A one-line `key=value` summary of the parameters in key order, each value cut to 80 characters and the whole to 400, control characters
// replaced. It is shown to the owner next to the action so the approval is given knowingly; the event that carries it is redacted on write, and the
// digest, not the summary, is what the approval binds.
export function paramsSummary(params: unknown): string {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return clip(show(params), MAX_SUMMARY_CHARS);
  const record = params as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${clip(key, MAX_VALUE_CHARS)}=${show(record[key])}`);
  return clip(parts.join(' '), MAX_SUMMARY_CHARS);
}
