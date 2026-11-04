// FakeIntelHost: a decorator over FakeAgentHost that also answers the `intel` purpose without a model. It writes the
// five intel documents of test/fixtures/index-fixtures.ts into {cwd}/.planning/intel/ the way gsd-intel-updater would, with
// configurable misbehaviour. Like the real agent under the hook (rehearsal 4: `gsd_run intel snapshot` is denied inside the
// invocation) it writes NO `.last-refresh.json` unless `hostSnapshot` says so: AVARICE takes the snapshot itself. Every other
// purpose goes to the wrapped host. It lives in test/helpers, so no production path to an "active" record built from
// fixtures exists; nothing under src/ or bin/ may import it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok } from '../../src/domain/result.ts';
import type { PortError, Result } from '../../src/domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationOutcomeKind, InvocationRequest, ReapRequest } from '../../src/ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { INTEL_FILE_NAMES, intelDocuments, refreshSnapshot, serializeIntel } from '../fixtures/index-fixtures.ts';
import type { IntelFileName } from '../fixtures/index-fixtures.ts';
import { git } from './scratch-repo.ts';

export interface FakeIntelOptions {
  // Intel files to leave out.
  omit?: readonly IntelFileName[];
  // Complete replacement content for an intel file, written verbatim (the snapshot is taken of the original).
  raw?: Readonly<Partial<Record<IntelFileName, string>>>;
  // The host also writes its own `.last-refresh.json`, a snapshot of the documents as first written (what an agent that could run
  // `gsd_run intel snapshot` would leave). AVARICE's own snapshot replaces it.
  hostSnapshot?: boolean;
  // With `hostSnapshot`: a file changed after the host's snapshot, so it no longer matches what the host hashed.
  changeAfterSnapshot?: IntelFileName;
  // Outcome kind to report; default progressed.
  outcomeKind?: InvocationOutcomeKind;
  // Return this error instead of an outcome (the host could not run).
  hostError?: PortError;
  // Write nothing at all.
  writeNothing?: boolean;
  // Extra files to write, relative to cwd (for example outside the intel write set).
  extraWrites?: Readonly<Record<string, string>>;
  costUsd?: number;
  // Update time of the documents (default: now).
  updatedAt?: string;
}

export class FakeIntelHost implements AgentHost {
  readonly inner: AgentHost;
  readonly options: FakeIntelOptions;
  readonly calls: InvocationRequest[] = [];

  constructor(inner: AgentHost, options: FakeIntelOptions = {}) {
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
    if (req.purpose !== 'intel') return this.inner.invoke(req, signal);
    this.calls.push(req);
    const o = this.options;
    if (o.hostError !== undefined) return err(o.hostError);
    const startedMs = Date.now();
    const head = git(req.cwd, ['rev-parse', 'HEAD']).trim();

    if (o.writeNothing !== true) {
      const files = serializeIntel(intelDocuments(o.updatedAt));
      const omit = new Set<string>(o.omit ?? []);
      const target = (name: string): string => join(req.cwd, '.planning', 'intel', name);
      const write = (name: string, content: string): void => {
        mkdirSync(dirname(target(name)), { recursive: true });
        writeFileSync(target(name), content);
      };
      for (const name of INTEL_FILE_NAMES) {
        if (omit.has(name)) continue;
        write(name, o.raw?.[name] ?? files[name]);
      }
      if (o.hostSnapshot === true) write('.last-refresh.json', refreshSnapshot(files));
      if (o.changeAfterSnapshot !== undefined) write(o.changeAfterSnapshot, `${files[o.changeAfterSnapshot].trimEnd()}\n\n`);
      for (const [rel, content] of Object.entries(o.extraWrites ?? {})) {
        mkdirSync(dirname(join(req.cwd, rel)), { recursive: true });
        writeFileSync(join(req.cwd, rel), content);
      }
    }
    return ok({
      sessionId: `fake-intel-session-${this.calls.length}`,
      kind: o.outcomeKind ?? 'progressed',
      permissionDenials: [],
      costUsd: o.costUsd ?? 0,
      durationMs: Date.now() - startedMs,
      headBefore: head,
      headAfter: head,
    });
  }
}
