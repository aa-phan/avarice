// The seeded fault source of the fake-remote adapters (plan 04-33; NFR-4, AC-7). One seed fixes every latency, every dropped response and
// every duplicated response a fake draws, so a failure of the portability proof reproduces from the seed it names. The module only defines
// the generator, the fault source and the event log; it runs nothing when imported (a bare `node --test` loads every file under test/).
import { appendFileSync } from 'node:fs';

// mulberry32: a 32-bit generator with a one-number state; the same seed gives the same sequence on every machine.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What the fakes did to a call. `inner-call` is one run of the real adapter behind the fake (the executor's call log): the proof that a command whose response
// was dropped is never run twice reads it back.
export type FaultKind = 'drop' | 'duplicate' | 'inner-call';
export interface FaultEvent {
  port: 'executor' | 'artifact-store';
  kind: FaultKind;
  // The invocation key (executor) or the digest (artifact store) the event is about.
  key: string;
  // The call the event belongs to, `<pid>.<n>`: n counts the calls of one fake. A call is one request of the client, retries included, so the invocation key alone
  // cannot tell a retry from a second request that happens to carry the same key (the GSD adapter names every `graphify status` `gsd:graphify`).
  call: string;
}

export interface FaultCounts {
  drop: number;
  duplicate: number;
  innerCall: number;
}

export interface FaultOptions {
  // The share of responses dropped and duplicated (NFR-4: 5% and 2%).
  dropP?: number;
  duplicateP?: number;
  // Latency of one call in milliseconds, drawn uniformly from the range.
  minLatencyMs?: number;
  maxLatencyMs?: number;
  // Receives every event (a test entry writes them to a file so another process can read them back).
  sink?: (event: FaultEvent) => void;
}

export const DEFAULT_DROP_P = 0.05;
export const DEFAULT_DUPLICATE_P = 0.02;

export class SeededFaults {
  readonly seed: number;
  readonly events: FaultEvent[] = [];
  private readonly next: () => number;
  private readonly options: Required<Omit<FaultOptions, 'sink'>> & Pick<FaultOptions, 'sink'>;

  constructor(seed: number, options: FaultOptions = {}) {
    this.seed = seed;
    this.next = mulberry32(seed);
    this.options = {
      dropP: options.dropP ?? DEFAULT_DROP_P,
      duplicateP: options.duplicateP ?? DEFAULT_DUPLICATE_P,
      minLatencyMs: options.minLatencyMs ?? 5,
      maxLatencyMs: options.maxLatencyMs ?? 30,
      ...(options.sink === undefined ? {} : { sink: options.sink }),
    };
  }

  // True with probability `p` (the default is the configured drop share): this response is lost.
  drop(p: number = this.options.dropP): boolean {
    return this.next() < p;
  }

  // True with probability `p` (the default is the configured duplicate share): this response arrives twice.
  duplicate(p: number = this.options.duplicateP): boolean {
    return this.next() < p;
  }

  latencyMs(): number {
    const { minLatencyMs, maxLatencyMs } = this.options;
    return minLatencyMs + Math.floor(this.next() * (maxLatencyMs - minLatencyMs + 1));
  }

  record(event: FaultEvent): void {
    this.events.push(event);
    this.options.sink?.(event);
  }

  counts(): FaultCounts {
    return countFaults(this.events);
  }
}

export function countFaults(events: readonly FaultEvent[]): FaultCounts {
  const counts: FaultCounts = { drop: 0, duplicate: 0, innerCall: 0 };
  for (const event of events) {
    if (event.kind === 'drop') counts.drop += 1;
    else if (event.kind === 'duplicate') counts.duplicate += 1;
    else counts.innerCall += 1;
  }
  return counts;
}

// A sink that appends each event as one JSON line, for a test entry whose events a parent test reads after the process is gone.
// A call id for the next call of a fake: the process that made it and its ordinal.
export function callId(ordinal: number): string {
  return `${process.pid}.${ordinal}`;
}

export function fileSink(path: string): (event: FaultEvent) => void {
  return (event) => appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
