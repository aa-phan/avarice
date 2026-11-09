// Notification policy as pure functions (D-21 to D-24, AUT-4, AUT-6). Where a notification may go comes only from the
// profile config (D-21): a contract can choose a subset of the profile's destinations and never add one. Every time rule
// works in whole minutes of local time and integer milliseconds from a clock the caller injects. Banner text is built from
// AVARICE-owned words only (counts, IDs, the next command), never from a decision issue or model text. Nothing here returns
// or implies an answer: a notification, a deadline, silence or a failed delivery can never approve a decision (AUT-4).
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export interface ProfileNotify {
  destinations: string[];
  // Sorted ascending, "HH:MM" digits only.
  digestTimes: string[];
  // Minutes of the local day, the range [start, end), wrapping past midnight when start is greater than end. Null is off.
  quietHours: { start: number; end: number } | null;
  batchWindowMinutes: number;
  local: { osascriptPath: string };
}

export const KNOWN_DESTINATIONS: readonly string[] = ['local'];

export const NOTIFY_DEFAULTS: ProfileNotify = {
  destinations: ['local'],
  digestTimes: ['12:30', '17:30'],
  quietHours: null,
  batchWindowMinutes: 10,
  local: { osascriptPath: '/usr/bin/osascript' },
};

export const NOTIFY_LIMITS = {
  digestTimes: 6,
  batchWindowMinutesMin: 1,
  batchWindowMinutesMax: 120,
  osascriptPathChars: 1024,
  bannerBodyChars: 200,
  bannerIdChars: 64,
  bannerListedIds: 3,
} as const;

const NOTIFY_KEYS: readonly string[] = ['destinations', 'digestTimes', 'quietHours', 'batchWindowMinutes', 'local'];
const LOCAL_KEYS: readonly string[] = ['osascriptPath'];
const CLOCK_TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const QUIET_HOURS = /^([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])$/;
// Every C0 control character (tab and newline included), DEL and the C1 controls.
const ANY_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A key from a hand-edited file goes into a field path that a terminal prints: drop control characters and cap it.
function fieldKey(key: string): string {
  return stripText(key).slice(0, 40);
}

function parseDestinations(value: unknown): Result<string[]> {
  if (!Array.isArray(value)) return invalid('notify.destinations', 'expected a list of destinations');
  const seen: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== 'string' || !KNOWN_DESTINATIONS.includes(item)) {
      return invalid(`notify.destinations[${index}]`, `expected one of ${KNOWN_DESTINATIONS.join(', ')}`);
    }
    if (!seen.includes(item)) seen.push(item);
  }
  return ok(seen);
}

function parseDigestTimes(value: unknown): Result<string[]> {
  if (!Array.isArray(value)) return invalid('notify.digestTimes', 'expected a list of HH:MM times');
  if (value.length > NOTIFY_LIMITS.digestTimes) return invalid('notify.digestTimes', `at most ${NOTIFY_LIMITS.digestTimes} times`);
  const times: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== 'string' || !CLOCK_TIME.test(item)) return invalid(`notify.digestTimes[${index}]`, 'expected HH:MM, two digits each, 00:00 to 23:59');
    if (!times.includes(item)) times.push(item);
  }
  return ok(times.sort());
}

function parseQuietHours(value: unknown): Result<ProfileNotify['quietHours']> {
  if (value === null) return ok(null);
  const match = typeof value === 'string' ? QUIET_HOURS.exec(value) : null;
  if (match === null) return invalid('notify.quietHours', 'expected HH:MM-HH:MM, for example 22:00-08:00');
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (start === end) return invalid('notify.quietHours', 'the two ends must differ');
  return ok({ start, end });
}

function parseBatchWindow(value: unknown): Result<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < NOTIFY_LIMITS.batchWindowMinutesMin || value > NOTIFY_LIMITS.batchWindowMinutesMax) {
    return invalid('notify.batchWindowMinutes', `expected a whole number of minutes from ${NOTIFY_LIMITS.batchWindowMinutesMin} to ${NOTIFY_LIMITS.batchWindowMinutesMax}`);
  }
  return ok(value);
}

function parseLocal(value: unknown): Result<ProfileNotify['local']> {
  if (!isRecord(value)) return invalid('notify.local', 'expected an object');
  for (const key of Object.keys(value)) {
    if (!LOCAL_KEYS.includes(key)) return invalid(`notify.local.${fieldKey(key)}`, `unknown key; expected ${LOCAL_KEYS.join(', ')}`);
  }
  const path = value.osascriptPath;
  if (path === undefined) return ok({ osascriptPath: NOTIFY_DEFAULTS.local.osascriptPath });
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > NOTIFY_LIMITS.osascriptPathChars || ANY_CONTROL.test(path)) {
    return invalid('notify.local.osascriptPath', 'expected an absolute path without control characters');
  }
  return ok({ osascriptPath: path });
}

// `raw` is the profile config as read from its JSON file. A missing notify section means the defaults (a hand-edited file
// that never mentions notifications keeps working); a present one is validated key by key, and a missing key takes its default.
export function parseProfileNotify(raw: unknown): Result<ProfileNotify> {
  if (!isRecord(raw)) return invalid('config', 'expected an object');
  const section = raw.notify;
  const value: ProfileNotify = {
    destinations: [...NOTIFY_DEFAULTS.destinations],
    digestTimes: [...NOTIFY_DEFAULTS.digestTimes],
    quietHours: NOTIFY_DEFAULTS.quietHours,
    batchWindowMinutes: NOTIFY_DEFAULTS.batchWindowMinutes,
    local: { ...NOTIFY_DEFAULTS.local },
  };
  if (section === undefined) return ok(value);
  if (!isRecord(section)) return invalid('notify', 'expected an object');
  for (const key of Object.keys(section)) {
    if (!NOTIFY_KEYS.includes(key)) return invalid(`notify.${fieldKey(key)}`, `unknown key; expected ${NOTIFY_KEYS.join(', ')}`);
  }
  if (section.destinations !== undefined) {
    const result = parseDestinations(section.destinations);
    if (!result.ok) return result;
    value.destinations = result.value;
  }
  if (section.digestTimes !== undefined) {
    const result = parseDigestTimes(section.digestTimes);
    if (!result.ok) return result;
    value.digestTimes = result.value;
  }
  if (section.quietHours !== undefined) {
    const result = parseQuietHours(section.quietHours);
    if (!result.ok) return result;
    value.quietHours = result.value;
  }
  if (section.batchWindowMinutes !== undefined) {
    const result = parseBatchWindow(section.batchWindowMinutes);
    if (!result.ok) return result;
    value.batchWindowMinutes = result.value;
  }
  if (section.local !== undefined) {
    const result = parseLocal(section.local);
    if (!result.ok) return result;
    value.local = result.value;
  }
  return ok(value);
}

// D-21: the contract chooses a subset of the profile's destinations. A destination the profile does not list is dropped,
// so a run cannot redirect a notification (T-03-12). The contract's order is kept and a repeated name counts once.
export function effectiveDestinations(contract: readonly string[], profile: ProfileNotify): string[] {
  const chosen: string[] = [];
  for (const destination of contract) {
    if (profile.destinations.includes(destination) && !chosen.includes(destination)) chosen.push(destination);
  }
  return chosen;
}

// Escape sequences and control characters, mirroring the terminal style of the CLI without importing from it: strings
// introduced by OSC, DCS, SOS, PM and APC, CSI in its 7-bit and 8-bit forms, any other ESC sequence, every C0, DEL and C1
// control character (tab and newline included, since a banner is one line), and the invisible formatting characters.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const STRING_INTRODUCERS = /\x1b[PX^_][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\x1b[ -/]*[0-~]/g;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const INVISIBLE_FORMAT = /[؜​-‏‪-‮⁠⁦-⁩﻿]/g;

function stripText(text: string): string {
  return text.replace(OSC, '').replace(STRING_INTRODUCERS, '').replace(CSI, '').replace(OTHER_ESCAPE, '').replace(CONTROL, '').replace(INVISIBLE_FORMAT, '');
}

export type BannerKind = 'decisions' | 'review' | 'digest' | 'blocked-run';

export interface BannerInput {
  kind: BannerKind;
  runId?: string;
  // Open decisions: the number waiting. Absent, the length of decisionIds.
  count?: number;
  // Digest: runs ready for review.
  reviewCount?: number;
  decisionIds?: readonly string[];
}

function safeId(text: string): string {
  return stripText(text).slice(0, NOTIFY_LIMITS.bannerIdChars);
}

function wholeCount(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : 0;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// The banner posted by the local adapter (D-22). Title and body hold only AVARICE's own words: counts, the run ID, decision
// IDs and the next command. The body is at most 200 characters; when the IDs would push it over, the part before the
// command is shortened so the command always survives.
export function bannerText(input: BannerInput): { title: string; body: string } {
  const prefix = input.runId === undefined ? '' : `${safeId(input.runId)}: `;
  const command = input.kind === 'blocked-run' ? 'avarice status' : 'avarice inbox';
  let head: string;
  if (input.kind === 'decisions') {
    const ids = (input.decisionIds ?? []).map(safeId);
    const count = input.count !== undefined ? wholeCount(input.count) : ids.length;
    const listed = ids.slice(0, NOTIFY_LIMITS.bannerListedIds);
    const rest = ids.length - listed.length;
    const list = listed.length === 0 ? '' : ` (${listed.join(', ')}${rest > 0 ? `, +${rest} more` : ''})`;
    head = `${prefix}${plural(count, 'decision')} waiting${list}`;
  } else if (input.kind === 'review') {
    head = `${prefix}ready for review`;
  } else if (input.kind === 'blocked-run') {
    head = `${prefix}blocked`;
  } else {
    head = `${prefix}${plural(wholeCount(input.count), 'decision')} waiting, ${plural(wholeCount(input.reviewCount), 'run')} ready for review`;
  }
  const tail = `. Run: ${command}`;
  const room = NOTIFY_LIMITS.bannerBodyChars - tail.length;
  if (head.length > room) {
    let cut = head.slice(0, room - 1);
    // Do not leave half of a surrogate pair at the cut.
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    head = `${cut}…`;
  }
  return { title: 'AVARICE', body: `${head}${tail}` };
}
