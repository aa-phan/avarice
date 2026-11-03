// FakeKnowledgeHost: a decorator over FakeAgentHost that also answers the `knowledge` purpose without a model. It writes the
// skill graph of test/fixtures/knowledge.ts to {cwd}/graphify-out/graph.json the way the graphify skill would (cwd is the
// corpus directory), with configurable misbehaviour. Every other purpose goes to the wrapped host, so it composes with
// FakeIntelHost. It lives in test/helpers, so no production path to an "active" record built from fixtures exists; nothing
// under src/ or bin/ may import it.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok } from '../../src/domain/result.ts';
import type { PortError, Result } from '../../src/domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationOutcomeKind, InvocationRequest, ReapRequest } from '../../src/ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { skillGraph } from '../fixtures/knowledge.ts';
import { git } from './scratch-repo.ts';

export interface FakeKnowledgeOptions {
  // The graph the skill leaves: a value, or a function of the request (to read the corpus the pass was given).
  graph?: Record<string, unknown> | ((request: InvocationRequest) => unknown);
  // Written verbatim instead of a graph (for example text that is not JSON).
  rawGraph?: string;
  // Outcome kind to report; default progressed.
  outcomeKind?: InvocationOutcomeKind;
  // Return this error instead of an outcome (the host could not run).
  hostError?: PortError;
  // Write nothing at all.
  writeNothing?: boolean;
  // Extra files to write, relative to cwd (a path outside the corpus directory is written from the cwd's parent chain).
  extraWrites?: Readonly<Record<string, string>>;
  // Files written relative to the staging root (to test a write outside the knowledge write set).
  stagingWrites?: Readonly<Record<string, string>>;
  costUsd?: number;
}

export interface CorpusSeen {
  // Files in the corpus directory (relative paths, without graphify-out), as the pass found them.
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

    if (o.writeNothing !== true) {
      const target = join(req.cwd, 'graphify-out', 'graph.json');
      mkdirSync(dirname(target), { recursive: true });
      const graph = typeof o.graph === 'function' ? (o.graph as (r: InvocationRequest) => unknown)(req) : (o.graph ?? skillGraph());
      writeFileSync(target, o.rawGraph ?? JSON.stringify(graph));
      writeFileSync(join(req.cwd, 'graphify-out', 'GRAPH_REPORT.md'), '# skill report\n');
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

  #look(cwd: string): CorpusSeen {
    const files: string[] = [];
    const texts: Record<string, string> = {};
    const walk = (dir: string, rel: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'graphify-out') walk(join(dir, entry.name), path);
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
