// Notification policy as pure functions (D-21 to D-24, AUT-4, AUT-6). Stub: the behavior lands in the next commit.
import { ok } from './result.ts';
import type { Result } from './result.ts';

export interface ProfileNotify {
  destinations: string[];
  digestTimes: string[];
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

export type BannerKind = 'decisions' | 'review' | 'digest' | 'blocked-run';

export interface BannerInput {
  kind: BannerKind;
  runId?: string;
  count?: number;
  reviewCount?: number;
  decisionIds?: readonly string[];
}

export function parseProfileNotify(_raw: unknown): Result<ProfileNotify> {
  return ok(NOTIFY_DEFAULTS);
}

export function effectiveDestinations(contract: readonly string[], _profile: ProfileNotify): string[] {
  return [...contract];
}

export function bannerText(_input: BannerInput): { title: string; body: string } {
  return { title: '', body: '' };
}
