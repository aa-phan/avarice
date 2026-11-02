// FakeAgentHost: the only host that can produce a map without a model. It writes the generated map documents
// into {cwd}/.planning/codebase/ the way the mapper would, with configurable misbehaviour. It lives in
// test/helpers so that no production path to an "active" record built from fixtures exists (SKELETON.md "Fake
// host"); nothing under src/ or bin/ may import it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationOutcomeKind, InvocationRequest } from '../../src/ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { git } from './scratch-repo.ts';

export const FAKE_DOCUMENT_MARKER = 'FAKE-MAP-DOCUMENT-BODY-TEXT-7f3a91';

export const ALL_MAP_FILES = ['STACK.md', 'ARCHITECTURE.md', 'STRUCTURE.md', 'CONVENTIONS.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONCERNS.md'] as const;

export interface FakeHostOptions {
  // Map files to write, by name; default all seven.
  files?: readonly string[];
  // Value for last_mapped_commit; default `git rev-parse HEAD` of the invocation cwd. `false` writes no
  // frontmatter stamp at all (a mapper that leaves stamping to AVARICE, as a fast map does).
  stamp?: string | false;
  // Map files to leave out.
  omit?: readonly string[];
  // Extra files to write, relative to cwd (for example outside the agent write set).
  extraWrites?: Readonly<Record<string, string>>;
  // Text appended to every document (for example instruction-like text the validator must treat as data).
  inject?: string;
  // Complete replacement content for a map file, by name, written verbatim (no stamp is added).
  rawFiles?: Readonly<Record<string, string>>;
  // Template H2 headings to leave out of a map file, by name.
  omitHeadings?: Readonly<Record<string, readonly string[]>>;
  // Filler appended to every document, in bytes (for the size cap).
  padBytes?: number;
  // Delay before returning.
  sleepMs?: number;
  // SIGKILL this process after writing this many files (mid-invocation kill point).
  killAfterFiles?: number;
  // Outcome kind to report; default progressed.
  outcomeKind?: InvocationOutcomeKind;
  costUsd?: number;
}

// H2 headings the GSD 1.17.0 templates define for the two documents that have a template (stack.md and
// architecture.md under gsd-core/templates/codebase/). Copied here, not imported, so the validator's own constant
// is checked against an independent copy.
const TEMPLATE_H2: Readonly<Record<string, readonly string[]>> = {
  'STACK.md': ['Languages', 'Runtime', 'Frameworks', 'Key Dependencies', 'Configuration', 'Platform Requirements'],
  'ARCHITECTURE.md': ['Pattern Overview', 'Layers', 'Data Flow', 'Key Abstractions', 'Entry Points', 'Error Handling', 'Cross-Cutting Concerns'],
};

function title(file: string): string {
  const name = file.replace(/\.md$/, '');
  return name.charAt(0) + name.slice(1).toLowerCase();
}

function document(file: string, stamp: string | false, trackedPaths: readonly string[], inject: string | undefined, omitHeadings: readonly string[] = [], padBytes = 0): string {
  const paths = trackedPaths.slice(0, 10).map((p) => `- \`${p}\``).join('\n');
  return [
    ...(stamp === false ? [] : ['---', `last_mapped_commit: ${stamp}`, 'last_mapped_at: 2026-01-01T00:00:00.000Z', '---']),
    `# ${title(file)}`,
    '',
    '## Overview',
    '',
    `${FAKE_DOCUMENT_MARKER} describes the ${title(file).toLowerCase()} of this repository.`,
    '',
    ...(TEMPLATE_H2[file] ?? []).filter((h) => !omitHeadings.includes(h)).flatMap((heading) => [`## ${heading}`, '', `Notes on ${heading.toLowerCase()}.`, '']),
    '## Details',
    '',
    paths.length > 0 ? paths : '- (no tracked files)',
    ...(inject !== undefined ? ['', inject] : []),
    ...(padBytes > 0 ? ['', 'x'.repeat(padBytes)] : []),
    '',
  ].join('\n');
}

export class FakeAgentHost implements AgentHost {
  readonly descriptor: CapabilityDescriptor = {
    port: 'agent-host',
    adapter: 'fake',
    version: '0.0.0',
    capabilities: { 'contained-invocation': true },
    attributes: { enforcement: 'enforced' },
    offline: true,
  };
  readonly options: FakeHostOptions;
  readonly calls: InvocationRequest[] = [];

  constructor(options: FakeHostOptions = {}) {
    this.options = options;
  }

  async invoke(req: InvocationRequest, _signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    this.calls.push(req);
    if (req.purpose !== 'map') return err({ kind: 'unsupported', capability: `fake-host:${req.purpose}` });
    const o = this.options;
    const startedMs = Date.now();
    const head = git(req.cwd, ['rev-parse', 'HEAD']).trim();
    const stamp = o.stamp ?? head;
    const tracked = git(req.cwd, ['ls-files']).split('\n').filter((line) => line.length > 0);
    const omit = new Set(o.omit ?? []);
    const files = (o.files ?? ALL_MAP_FILES).filter((f) => !omit.has(f));

    let written = 0;
    for (const file of files) {
      const target = join(req.cwd, '.planning', 'codebase', file);
      mkdirSync(dirname(target), { recursive: true });
      const raw = o.rawFiles?.[file];
      writeFileSync(target, raw ?? document(file, stamp, tracked, o.inject, o.omitHeadings?.[file], o.padBytes));
      written += 1;
      if (o.killAfterFiles !== undefined && written >= o.killAfterFiles) process.kill(process.pid, 'SIGKILL');
    }
    for (const [rel, content] of Object.entries(o.extraWrites ?? {})) {
      const target = join(req.cwd, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    if (o.sleepMs !== undefined) await sleep(o.sleepMs);
    return ok({
      sessionId: `fake-session-${this.calls.length}`,
      kind: o.outcomeKind ?? 'progressed',
      permissionDenials: [],
      costUsd: o.costUsd ?? 0,
      durationMs: Date.now() - startedMs,
      headBefore: head,
      headAfter: head,
    });
  }
}
