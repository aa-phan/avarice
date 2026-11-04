// FakeKnowledgeHost: a decorator over FakeAgentHost that also answers the `knowledge` purpose without a model. Like the real
// pass (plan 01-19 decision B) it reads the chunk plan AVARICE wrote to `{corpus}/.chunks.json` and writes one extraction JSON
// per chunk into `{corpus}/.extraction/`, with configurable misbehaviour. Every other purpose goes to the wrapped host, so it
// composes with FakeIntelHost. It lives in test/helpers, so no production path to an "active" record built from fixtures
// exists; nothing under src/ or bin/ may import it.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok } from '../../src/domain/result.ts';
import type { PortError, Result } from '../../src/domain/result.ts';
import type { ExtractionPlan } from '../../src/domain/knowledge-extraction.ts';
import type { AgentHost, InvocationOutcome, InvocationOutcomeKind, InvocationRequest, ReapRequest } from '../../src/ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { skillGraph } from '../fixtures/knowledge.ts';
import { git } from './scratch-repo.ts';

export interface FakeKnowledgeOptions {
  // The graph the pass extracts, as `{ nodes, links | edges }`: a value, or a function of the request (to read the corpus the
  // pass was given). It is written into chunk 1 as `{ nodes, edges }`; the other chunks get an empty extraction.
  graph?: Record<string, unknown> | ((request: InvocationRequest, plan: ExtractionPlan) => unknown);
  // Written verbatim as chunk 1 instead of a graph (for example text that is not JSON).
  rawGraph?: string;
  // Full control of the chunk files: chunk number -> an object (written as JSON), a string (written as it is) or null (not written).
  // Replaces `graph` and `rawGraph`.
  chunks?: (plan: ExtractionPlan, request: InvocationRequest) => Record<number, unknown>;
  // Outcome kind to report; default progressed.
  outcomeKind?: InvocationOutcomeKind;
  // Return this error instead of an outcome (the host could not run).
  hostError?: PortError;
  // Write nothing at all.
  writeNothing?: boolean;
  // Extra files to write, relative to cwd (the corpus directory).
  extraWrites?: Readonly<Record<string, string>>;
  // Files written relative to the staging root (to test a write outside the knowledge write set).
  stagingWrites?: Readonly<Record<string, string>>;
  costUsd?: number;
}

export interface CorpusSeen {
  // Files in the corpus directory (relative paths, without `.extraction` and `graphify-out`), as the pass found them.
  files: string[];
  // Text of each corpus file.
  texts: Record<string, string>;
}

export class FakeKnowledgeHost implements AgentHost {
  readonly inner: AgentHost;
  readonly options: FakeKnowledgeOptions;
  readonly calls: InvocationRequest[] = [];
  // What the pass found in the corpus directory at the time it ran.
  readonly seen: CorpusSeen[] = [];
  // The chunk plan the pass read, one per call.
  readonly plans: ExtractionPlan[] = [];

  constructor(inner: AgentHost, options: FakeKnowledgeOptions = {}) {
    this.inner = inner;
    this.options = options;
  }

  get descriptor(): CapabilityDescriptor {
    return this.inner.descriptor;
  }

  async reap(request: ReapRequest): Promise<Result<{ terminated: number }>> {
    return this.inner.reap !== undefined ? this.inner.reap(request) : ok({ terminated: 0 });
  }

  async invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    if (req.purpose !== 'knowledge') return this.inner.invoke(req, signal);
    this.calls.push(req);
    const o = this.options;
    if (o.hostError !== undefined) return err(o.hostError);
    const startedMs = Date.now();
    const head = git(req.scope.stagingPath, ['rev-parse', 'HEAD']).trim();
    this.seen.push(this.#look(req.cwd));
    const plan = JSON.parse(readFileSync(join(req.cwd, '.chunks.json'), 'utf8')) as ExtractionPlan;
    this.plans.push(plan);

    if (o.writeNothing !== true) {
      const written: Record<number, unknown> = o.chunks !== undefined ? o.chunks(plan, req) : this.#defaultChunks(plan, req);
      for (const chunk of plan.chunks) {
        const content = written[chunk.n];
        if (content === null || content === undefined) continue;
        const target = join(req.cwd, chunk.output);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
      }
      for (const [rel, content] of Object.entries(o.extraWrites ?? {})) {
        mkdirSync(dirname(join(req.cwd, rel)), { recursive: true });
        writeFileSync(join(req.cwd, rel), content);
      }
      for (const [rel, content] of Object.entries(o.stagingWrites ?? {})) {
        mkdirSync(dirname(join(req.scope.stagingPath, rel)), { recursive: true });
        writeFileSync(join(req.scope.stagingPath, rel), content);
      }
    }
    return ok({
      sessionId: `fake-knowledge-session-${this.calls.length}`,
      kind: o.outcomeKind ?? 'progressed',
      permissionDenials: [],
      costUsd: o.costUsd ?? 0,
      durationMs: Date.now() - startedMs,
      headBefore: head,
      headAfter: head,
    });
  }

  #defaultChunks(plan: ExtractionPlan, req: InvocationRequest): Record<number, unknown> {
    const o = this.options;
    const out: Record<number, unknown> = {};
    for (const chunk of plan.chunks) out[chunk.n] = { nodes: [], edges: [] };
    if (plan.chunks.length === 0) return out;
    if (o.rawGraph !== undefined) {
      out[1] = o.rawGraph;
      return out;
    }
    const graph = (typeof o.graph === 'function' ? o.graph(req, plan) : (o.graph ?? skillGraph())) as Record<string, unknown>;
    const edges = (graph['links'] ?? graph['edges'] ?? []) as unknown[];
    out[1] = { nodes: graph['nodes'] ?? [], edges };
    return out;
  }

  #look(cwd: string): CorpusSeen {
    const files: string[] = [];
    const texts: Record<string, string> = {};
    const walk = (dir: string, rel: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'graphify-out' && entry.name !== '.extraction') walk(join(dir, entry.name), path);
        } else {
          files.push(path);
          texts[path] = readFileSync(join(dir, entry.name), 'utf8');
        }
      }
    };
    walk(cwd, '');
    return { files: files.sort(), texts };
  }
}
