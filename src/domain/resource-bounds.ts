// Resource bounds (plan 04-30; OPS-5, D-13; docs/operations-and-testing.md "Resource bounds"). The profile config's `limits` section sets how much of each resource one
// profile may use, and every bound degrades the way the document says: the context pack drops its lowest-ranked items, a run past the active-run bound is refused, checks
// queue, check output is truncated, new artifacts past the quota are refused, and debug events past the event bound are refused and counted. This module is the pure part:
// the defaults, the parser and the pack budget. The enforcement is in the layers that own each resource.
//
// Units, so a number is never read in the wrong one: a token is an estimate of four characters of the JavaScript string (`text.length / 4`, as GSD's reader counts); a byte
// cap counts UTF-8 bytes (`Buffer.byteLength`, `TextEncoder`); `artifactQuotaMiB` is mebibytes of stored blobs.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export interface ResourceLimits {
  // The ceiling of the context pack, in tokens. The pack of a run is also bound by the room the 32 KiB prompt leaves (effectivePackBudget); `avarice context` uses it as its default budget.
  contextTokens: number;
  // Checks of one run that may run at once. The checks of a run share one clone, so the default is 1; 2 is the most.
  maxConcurrentChecks: number;
  // Stored artifact bytes per profile, in MiB.
  artifactQuotaMiB: number;
  // Runs per profile that have not ended (not failed, cancelled or closed).
  maxActiveRuns: number;
  // Rows of the events table after which new debug events are refused.
  maxEventRows: number;
  // Bytes of one output stream of one check that are kept.
  checkOutputBytes: number;
}

export const LIMIT_DEFAULTS: Readonly<ResourceLimits> = Object.freeze({
  contextTokens: 24_000,
  maxConcurrentChecks: 1,
  artifactQuotaMiB: 2048,
  maxActiveRuns: 20,
  maxEventRows: 500_000,
  checkOutputBytes: 5 * 1024 * 1024,
});

// The most checks of one run that may run at once, whatever the profile says.
export const MAX_CONCURRENT_CHECKS = 2;

export const LIMIT_KEYS: readonly (keyof ResourceLimits)[] = Object.freeze(Object.keys(LIMIT_DEFAULTS) as Array<keyof ResourceLimits>);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// A key from a hand-edited file goes into a field path that a terminal prints: drop control characters and cap it.
// eslint-disable-next-line no-control-regex
const shownKey = (key: string): string => key.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 40);

// The profile config's `limits` section: an object of limit names to positive whole numbers. An absent section and `{}` are the defaults. An unknown name, a value that is
// not a positive whole number, and a `maxConcurrentChecks` above 2 are refused, naming `limits.<key>`. A profile may raise or lower a limit within that; nothing in a run's
// contract overrides them.
export function parseLimitsSection(raw: unknown): Result<ResourceLimits> {
  const limits: ResourceLimits = { ...LIMIT_DEFAULTS };
  if (raw === undefined) return ok(limits);
  if (!isRecord(raw)) return err({ kind: 'invalid', field: 'limits', reason: `expected an object of limit names (${LIMIT_KEYS.join(', ')}) to numbers` });
  for (const [key, value] of Object.entries(raw)) {
    const field = `limits.${shownKey(key)}`;
    const name = LIMIT_KEYS.find((candidate) => candidate === key);
    if (name === undefined) return err({ kind: 'invalid', field, reason: `unknown limit; expected ${LIMIT_KEYS.join(', ')}` });
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return err({ kind: 'invalid', field, reason: 'expected a whole number above 0' });
    if (name === 'maxConcurrentChecks' && value > MAX_CONCURRENT_CHECKS) return err({ kind: 'invalid', field, reason: `at most ${MAX_CONCURRENT_CHECKS} checks run at once: they share one clone` });
    limits[name] = value;
  }
  return ok(limits);
}

// The tokens of context a run's prompt can carry: the ceiling, or a quarter of the bytes the prompt cap leaves after the contract text and the fixed text around the pack,
// whichever is smaller (D-13). A quarter because a token is four characters and a character is at least one byte, so a pack of this many tokens in one-byte characters fills
// the room exactly; text in a wider encoding is cut by the prompt builder, which counts bytes. Floored, and never below 0: with no room the pack is empty and every handle
// is listed as omitted.
export function effectivePackBudget(ceiling: number, promptMax: number, contractBytes: number, overhead: number): number {
  const room = Math.floor((promptMax - contractBytes - overhead) / 4);
  return Math.max(0, Math.min(ceiling, room));
}
