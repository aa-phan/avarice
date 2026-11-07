// Attended-session harness (plan 02-25, UAT gap G-02-9): skeleton for the RED step. The verdict functions exist with their signatures
// and return nothing useful, so the unit tests fail on their assertions.
import type { ParsedTranscript } from './live-harness.ts';

export type AttendedBehavior = 'status-first' | 'stop-on-denial' | 'routable-question' | 'control';
export interface AttendedCase {
  name: string;
  behavior: AttendedBehavior;
  withSkill: boolean;
  prompt: string;
}
export type CaseVerdict = 'PASS' | 'FAIL' | 'NOT_EXERCISED';
export interface Judgment {
  verdict: CaseVerdict;
  reason: string;
  reported?: boolean;
}
export interface AttendedTranscript extends ParsedTranscript {
  assistantTexts: string[];
}
export interface AttendedLine {
  case: string;
  behavior: AttendedBehavior;
  verdict: CaseVerdict;
  reason: string;
  notExercised: boolean;
  costUsd: number;
}
export interface BehaviorSummary {
  behavior: string;
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  passed: number;
  failed: number;
  judged: number;
  notRun: number;
  notExercised: number;
  total: number;
}

const stub: Judgment = { verdict: 'FAIL', reason: 'not implemented' };

export const parseAttended = (_text: string): AttendedTranscript => ({ trace: [], eventKinds: {}, permissionDeniedEvents: [], init: undefined, result: undefined, assistantTexts: [] });
export const statusFirstVerdict = (_parsed: ParsedTranscript): Judgment => stub;
export const stopOnDenialVerdict = (_parsed: AttendedTranscript, _digests: { treeBefore: string; treeAfter: string }): Judgment => stub;
export const routableQuestionVerdict = (_parsed: AttendedTranscript, _digests: { slugBefore: string; slugAfter: string }): Judgment => stub;
export const skillListing = (_init: Record<string, unknown> | undefined): { listed: boolean; field: string | null } => ({ listed: false, field: null });
export const behaviorVerdicts = (_cases: readonly AttendedCase[], _lines: readonly AttendedLine[]): BehaviorSummary[] => [];
export const caseSkipReason = (_name: string, _lines: readonly AttendedLine[], _rerun: string | undefined): string | undefined => undefined;
export const diffRecords = (_before: Record<string, string>, _after: Record<string, string>): string[] => [];
export const attendedForecast = (_cases: readonly AttendedCase[], _lines: readonly AttendedLine[], _plan?: string): number => 0;
export const attendedRefusal = (_capUsd?: number): string | undefined => undefined;
