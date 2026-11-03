// Line parser for the host's stream-json output (Pitfall 10, "Stream-json outcome classification inputs").
// STUB for the RED commit of plan 01-15: nothing is parsed.
export interface StreamInit {
  sessionId?: string;
  model?: string;
  cwd?: string;
  permissionMode?: string;
  agents: string[];
  skills: string[];
  toolCount: number;
}

export interface StreamPermissionDenial {
  tool: string;
  reason: string;
}

export interface SubagentStats {
  spawned: number;
  completed: number;
  failed: number;
  refused: number;
}

export interface StreamResult {
  isError: boolean | undefined;
  subtype?: string;
  terminalReason?: string;
  permissionDenials: StreamPermissionDenial[];
  totalCostUsd: number;
  numTurns: number;
  durationMs: number;
  sessionId?: string;
  subagentStats?: SubagentStats;
}

export interface ParsedStream {
  init?: StreamInit;
  permissionDenied: StreamPermissionDenial[];
  result?: StreamResult;
  resultCount: number;
  malformedLines: number;
  eventCount: number;
}

export class StreamJsonParser {
  constructor(_options: { maxLineBytes?: number } = {}) {}
  push(_chunk: string | Uint8Array): void {}
  finish(): ParsedStream {
    return { permissionDenied: [], resultCount: 0, malformedLines: 0, eventCount: 0 };
  }
}

export function parseStreamJson(_chunks: Iterable<string | Uint8Array> | string): ParsedStream {
  return new StreamJsonParser().finish();
}
