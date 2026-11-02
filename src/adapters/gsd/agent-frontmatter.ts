// GSD agent markdown reader (STUB: implemented in the GREEN step).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface ParsedAgent {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  effort?: string;
  prompt: string;
}

export function parseAgentFile(_text: string): Result<ParsedAgent> {
  return err({ kind: 'internal', cause: 'not implemented' });
}
