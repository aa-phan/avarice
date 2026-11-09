// The process ancestry reader (plan 03-15; CS-11, D-18). Stub: the tests of this plan are written against these names.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface ProcessEntry {
  pid: number;
  ppid: number;
  command: string;
}

export function cutCommand(command: string): string {
  return command;
}

export function processAncestry(_pid: number): Result<ProcessEntry[]> {
  return err({ kind: 'internal', cause: 'not implemented' });
}

export function inRunProcessTree(_chain: Result<ProcessEntry[]>): boolean {
  return false;
}
