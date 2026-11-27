// Parameter-bound approvals (plan 04-16; FR-12, FR-13, FR-15, ADR-005, D-18). An approval authorizes one action with exactly the parameters it was
// granted for, once, inside its window: it is matched on the scope (the run ID, an onboarding ID or `attended:<session id>`), the action and the
// SHA-256 of the canonical JSON of the parameters, and it is consumed in the transaction that records the action's start. Pure.
import { canonicalJson, digestOf, sha256Hex } from './digest.ts';
import { findSecrets } from './secret-patterns.ts';

// An approval granted now stops being usable this long afterwards (docs/contracts-and-state.md "approvals": single use, 30 minutes).
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

// What an approval is shown to the owner as, and the most it can show whole (G-04-1, GCR-01): a key or a value of at most 80 characters, the entries other than the working
// directory in at most 400 characters together, and the working directory (the `cwd` key the attended hook binds) in at most 512 under its own cap. The directory is the hook's
// canonical path, not text the model writes into the command, so it is shown whole and counts against neither of the other two; 400 + ' cwd=' + 512 is 917 characters, under the
// 1,024 an event string may hold. A set of parameters that exceeds any of these is refused by `unshowableReason` before a request is written, so a request never hides part of a
// value the digest binds.
export const MAX_VALUE_CHARS = 80;
export const MAX_SUMMARY_CHARS = 400;
export const MAX_CWD_CHARS = 512;
const CWD_KEY = 'cwd';
const ATTENDED_PREFIX = 'attended:';
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

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

function show(value: unknown, max: number = MAX_VALUE_CHARS): string {
  if (typeof value === 'string') return clip(value, max);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return clip(canonicalJson(value), max);
  } catch {
    return '[unprintable]';
  }
}

// A one-line `key=value` summary of the parameters in key order, control characters replaced. It is shown to the owner next to the action so the approval is given knowingly;
// the event that carries it is redacted on write, and the digest, not the summary, is what the approval binds. A request is written only for parameters that
// `unshowableReason` accepts, and for those nothing is cut: a key or value is whole, and so is the summary. The clips below are a defence for any other caller: a value is cut
// to 80 characters and the whole to 400, except that the `cwd` value is cut at 512 and the whole is allowed the length of the `cwd` entry and its separating space on top.
export function paramsSummary(params: unknown): string {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return clip(show(params), MAX_SUMMARY_CHARS);
  const record = params as Record<string, unknown>;
  const keys = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined);
  const parts = keys.map((key) => `${clip(key, MAX_VALUE_CHARS)}=${show(record[key], key === CWD_KEY ? MAX_CWD_CHARS : MAX_VALUE_CHARS)}`);
  const cwdAt = keys.indexOf(CWD_KEY);
  const cwdEntry = cwdAt >= 0 ? (parts[cwdAt] as string).length + 1 : 0;
  return clip(parts.join(' '), MAX_SUMMARY_CHARS + cwdEntry);
}

// The text an approval shows for a value, whole: a string as it is, null, a number or a boolean by its text, anything else by its canonical JSON. A value with no canonical form
// (a number that is not finite, a function, a class instance) has none, and the digest cannot bind it either.
function wholeText(value: unknown): string | undefined {
  try {
    const canonical = canonicalJson(value);
    if (typeof value === 'string') return value;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return canonical;
  } catch {
    return undefined;
  }
}

const OWN_TERMINAL = '; the owner can run the command at their own terminal';
const refusal = (detail: string): string => `a bound value cannot be shown whole (${detail})${OWN_TERMINAL}`;

// Why a set of parameters cannot be shown to the owner whole (G-04-1, GCR-01), or undefined when it can. An approval binds the SHA-256 of the whole parameters, so a request whose
// summary hides part of a value would be approved on less than it binds: a padded `-c` option could hide a second one that redirects the push. The parameters cannot be shown
// whole when a key or a value other than `cwd` is longer than 80 characters, the `cwd` value is longer than 512, any key or value holds a control character (it would be shown as a
// space), a value has no canonical form, the `key=value` entries other than `cwd` (keys sorted, undefined values skipped, single spaces) are longer than 400 characters together,
// or the secret patterns match the entries joined (`cwd` included), because the event that carries the summary is redacted on write and would differ from what the digest binds.
// The reason names the key and the length or the cause, never a value, and says the owner can run the command at their own terminal, where the attended hook does not apply.
export function unshowableReason(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return unshowableValue('the parameter value', params, MAX_VALUE_CHARS);
  const record = params as Record<string, unknown>;
  const keys = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined);
  const entries: { key: string; entry: string }[] = [];
  for (const key of keys) {
    if (HAS_CONTROL.test(key)) return refusal('a parameter name holds a control character');
    if (key.length > MAX_VALUE_CHARS) return refusal(`a parameter name is ${key.length} characters; at most ${MAX_VALUE_CHARS} are shown`);
    const text = wholeText(record[key]);
    const cap = key === CWD_KEY ? MAX_CWD_CHARS : MAX_VALUE_CHARS;
    const reason = unshowableText(key, text, cap);
    if (reason !== undefined) return reason;
    entries.push({ key, entry: `${key}=${text as string}` });
  }
  const others = entries.filter((e) => e.key !== CWD_KEY).map((e) => e.entry).join(' ');
  if (others.length > MAX_SUMMARY_CHARS) return refusal(`the parameters other than ${CWD_KEY} take ${others.length} characters to show; at most ${MAX_SUMMARY_CHARS} are shown`);
  const hit = findSecrets(entries.map((e) => e.entry).join(' '))[0];
  if (hit === undefined) return undefined;
  const named = entries.find((e) => findSecrets(e.entry).length > 0);
  return refusal(`${named !== undefined ? named.key : 'the parameters'} hold${named !== undefined ? 's' : ''} text that looks like a credential (${hit.pattern})`);
}

function unshowableValue(label: string, value: unknown, cap: number): string | undefined {
  const reason = unshowableText(label, wholeText(value), cap);
  if (reason !== undefined) return reason;
  const hit = findSecrets(wholeText(value) as string)[0];
  return hit === undefined ? undefined : refusal(`${label} holds text that looks like a credential (${hit.pattern})`);
}

function unshowableText(label: string, text: string | undefined, cap: number): string | undefined {
  if (text === undefined) return refusal(`${label} has no printable canonical form`);
  if (HAS_CONTROL.test(text)) return refusal(`${label} holds a control character`);
  if (text.length > cap) return refusal(`${label} is ${text.length} characters; at most ${cap} are shown`);
  return undefined;
}
