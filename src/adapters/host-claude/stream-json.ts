// Line parser for the host's stream-json output (01-RESEARCH Pitfall 10, "Stream-json outcome classification
// inputs"). The adapter feeds it every stdout chunk while the process runs; it keeps the facts the classifier
// needs and nothing else: the `system/init` event, every `system/permission_denied` event and the final `result`
// (is_error, subtype, terminal_reason, permission_denials, total_cost_usd, num_turns, duration_ms, session_id,
// subagent_stats).
//
// Model text never leaves this file: assistant messages, tool inputs and the `result` text field are not kept.
// A denied tool is recorded by name only; its input (a command, a path) is dropped. Nothing here throws on
// malformed input: a line that is not a JSON object is counted and skipped.
import { StringDecoder } from 'node:string_decoder';

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
  // Requests the host refused (depth, concurrency or budget limits).
  refused: number;
}

export interface StreamResult {
  // Absent when the result carried no boolean is_error; a classifier treats that as not a success.
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
  // How many result events were printed (the last one is kept).
  resultCount: number;
  // Non-empty lines that were not a JSON object, or were above the line limit.
  malformedLines: number;
  // JSON objects read.
  eventCount: number;
}

export interface StreamJsonOptions {
  // A line longer than this is dropped and counted as malformed; the parser resumes at the next newline.
  maxLineBytes?: number;
}

const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_NAME_CHARS = 128;
const MAX_LIST = 64;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, max = MAX_NAME_CHARS): string | undefined => (typeof value === 'string' && value !== '' ? value.slice(0, max) : undefined);

// A finite number that is not negative; anything else is 0.
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, MAX_LIST).map((v) => v.slice(0, MAX_NAME_CHARS)) : [];
}

function denial(entry: unknown): StreamPermissionDenial | null {
  if (!isObject(entry)) return null;
  const tool = text(entry['tool_name']) ?? text(entry['tool']);
  if (tool === undefined) return null;
  // The host's reason, when it gives a short one: a `reason`, or the `decision_reason_type` code the real 2.1.316
  // `system/permission_denied` event carries (`mode`). The tool input and the long `message` are never read.
  return { tool, reason: text(entry['reason'], 200) ?? text(entry['decision_reason_type'], 64) ?? 'permission_denied' };
}

function subagentStats(value: unknown): SubagentStats | undefined {
  if (!isObject(value)) return undefined;
  const refused = isObject(value['refused']) ? Object.values(value['refused']).reduce<number>((sum, n) => sum + count(n), 0) : 0;
  return { spawned: count(value['spawned']), completed: count(value['completed']), failed: count(value['failed']), refused };
}

export class StreamJsonParser {
  readonly #maxLineBytes: number;
  readonly #decoder = new StringDecoder('utf8');
  #pending = '';
  #skipping = false;
  #init: StreamInit | undefined;
  #permissionDenied: StreamPermissionDenial[] = [];
  #result: StreamResult | undefined;
  #resultCount = 0;
  #malformed = 0;
  #events = 0;

  constructor(options: StreamJsonOptions = {}) {
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  }

  push(chunk: string | Uint8Array): void {
    this.#feed(typeof chunk === 'string' ? chunk : this.#decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  }

  finish(): ParsedStream {
    this.#feed(this.#decoder.end());
    // A final line with no newline is a line like any other.
    if (this.#skipping) this.#skipping = false;
    else if (this.#pending !== '') this.#line(this.#pending);
    this.#pending = '';
    return {
      ...(this.#init !== undefined ? { init: this.#init } : {}),
      permissionDenied: [...this.#permissionDenied],
      ...(this.#result !== undefined ? { result: this.#result } : {}),
      resultCount: this.#resultCount,
      malformedLines: this.#malformed,
      eventCount: this.#events,
    };
  }

  #feed(piece: string): void {
    let rest = piece;
    while (rest !== '') {
      const newline = rest.indexOf('\n');
      if (newline === -1) {
        if (!this.#skipping) {
          this.#pending += rest;
          if (this.#pending.length > this.#maxLineBytes) this.#overflow();
        }
        return;
      }
      const head = rest.slice(0, newline);
      rest = rest.slice(newline + 1);
      if (this.#skipping) {
        // The tail of a dropped line: it ended here.
        this.#skipping = false;
      } else {
        const whole = this.#pending + head;
        this.#pending = '';
        if (whole.length > this.#maxLineBytes) this.#malformed += 1;
        else this.#line(whole);
      }
    }
  }

  // A line that has grown past the limit is counted once and dropped up to its newline.
  #overflow(): void {
    this.#malformed += 1;
    this.#pending = '';
    this.#skipping = true;
  }

  #line(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.#malformed += 1;
      return;
    }
    if (!isObject(value)) {
      this.#malformed += 1;
      return;
    }
    this.#events += 1;
    const type = value['type'];
    const subtype = value['subtype'];
    if (type === 'system' && subtype === 'init') this.#onInit(value);
    else if (type === 'system' && subtype === 'permission_denied') this.#onDenied(value);
    else if (type === 'result') this.#onResult(value);
  }

  #onInit(event: Json): void {
    const sessionId = text(event['session_id']);
    const model = text(event['model']);
    const cwd = text(event['cwd'], 1024);
    const permissionMode = text(event['permissionMode']) ?? text(event['permission_mode']);
    this.#init = {
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      agents: names(event['agents']),
      skills: names(event['skills']),
      toolCount: Array.isArray(event['tools']) ? event['tools'].length : 0,
    };
  }

  #onDenied(event: Json): void {
    const found = denial(event);
    if (found !== null) this.#permissionDenied.push(found);
  }

  #onResult(event: Json): void {
    this.#resultCount += 1;
    const denials = Array.isArray(event['permission_denials']) ? event['permission_denials'].slice(0, 1000).map(denial).filter((d): d is StreamPermissionDenial => d !== null) : [];
    const subtype = text(event['subtype']);
    const terminalReason = text(event['terminal_reason']);
    const sessionId = text(event['session_id']);
    const stats = subagentStats(event['subagent_stats']);
    this.#result = {
      isError: typeof event['is_error'] === 'boolean' ? event['is_error'] : undefined,
      ...(subtype !== undefined ? { subtype } : {}),
      ...(terminalReason !== undefined ? { terminalReason } : {}),
      permissionDenials: denials,
      totalCostUsd: count(event['total_cost_usd']),
      numTurns: count(event['num_turns']),
      durationMs: count(event['duration_ms']),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(stats !== undefined ? { subagentStats: stats } : {}),
    };
  }
}

export function parseStreamJson(chunks: Iterable<string | Uint8Array> | string): ParsedStream {
  const parser = new StreamJsonParser();
  if (typeof chunks === 'string') parser.push(chunks);
  else for (const chunk of chunks) parser.push(chunk);
  return parser.finish();
}
