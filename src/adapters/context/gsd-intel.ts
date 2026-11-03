// `gsd-intel` context adapter: answers from `.planning/intel/*.json` through GSD's own reader (`gsd_run intel query`).
// Freshness is the commit AVARICE recorded at refresh against the repository's current HEAD, plus `gsd_run intel diff`
// (the file hashes since the refresh) while the commits agree. It reads no file itself and writes nothing.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextHandle, ContextItem, ContextQuery, ContextSource, ExternalRef, Freshness, TokenBudget } from '../../ports/context-source.ts';
import type { GsdOnboarding } from '../../ports/gsd-onboarding.ts';
import { currentHead, estimateTokens, freshnessAt, isCitablePath, pathExistsAtHead } from './freshness.ts';

const INTEL_DIR = '.planning/intel';
// An excerpt is bounded; a larger entry is cut and says so.
const MAX_EXCERPT_CHARS = 1500;

export interface ContextAdapterOptions {
  nowMs(): number;
}

interface Found {
  handle: ContextHandle;
  excerpt: string;
}

// The repository path an intel entry cites, when it cites one: the key of a file-roles entry, the `file` of an API entry.
function citedPath(source: string, key: string, value: unknown): string | undefined {
  if (source === 'file-roles.json') return key;
  if (source === 'api-map.json' && typeof value === 'object' && value !== null) {
    const file = (value as Record<string, unknown>)['file'];
    return typeof file === 'string' ? file : undefined;
  }
  return undefined;
}

function excerptOf(value: unknown): string {
  const text = JSON.stringify(value) ?? '';
  return text.length <= MAX_EXCERPT_CHARS ? text : `${text.slice(0, MAX_EXCERPT_CHARS)}…[cut]`;
}

export class GsdIntelContext implements ContextSource {
  readonly descriptor: CapabilityDescriptor;
  readonly #gsd: GsdOnboarding;
  readonly #nowMs: () => number;
  // The entries the latest `find` returned, by handle ID, so `read` answers without a second query.
  #found = new Map<string, Found>();

  constructor(gsd: GsdOnboarding, options: ContextAdapterOptions) {
    this.#gsd = gsd;
    this.#nowMs = () => options.nowMs();
    this.descriptor = {
      port: 'context-source',
      adapter: 'gsd-intel',
      version: '1',
      capabilities: { find: true, read: true, refresh: false },
      offline: true,
    };
  }

  // The freshness of the whole index: the commit it was refreshed at against HEAD, and while those agree, whether any
  // file changed since GSD's snapshot (`changed`).
  async #freshness(query: ContextQuery): Promise<Freshness> {
    const base = freshnessAt(query.indexRevision, currentHead(query.workspace.repoPath));
    if (base !== 'fresh') return base;
    const diff = await this.#gsd.intelDiff(query.workspace.stagingPath);
    if (!diff.ok) return 'unavailable';
    if (diff.value.disabled) return 'unavailable';
    if (diff.value.noBaseline || diff.value.changed.length + diff.value.added.length + diff.value.removed.length > 0) return 'changed';
    return 'fresh';
  }

  async find(query: ContextQuery, _budget: TokenBudget): Promise<Result<ContextHandle[]>> {
    this.#found = new Map();
    const answer = await this.#gsd.intelQuery(query.workspace.stagingPath, query.term);
    if (!answer.ok) return answer;
    if (answer.value.disabled) return err({ kind: 'unavailable', cause: 'intel is disabled in the staging GSD config' });
    const freshness = await this.#freshness(query);
    const retrievedAt = new Date(this.#nowMs()).toISOString();
    const handles: ContextHandle[] = [];
    for (const match of answer.value.matches) {
      for (const entry of match.entries) {
        const excerpt = excerptOf(entry.value);
        const ref: ExternalRef = {
          provider: 'gsd-intel',
          kind: 'intel-entry',
          id: `${match.source}#${entry.key}`,
          revision: query.indexRevision,
          retrievedAt,
          scope: `${INTEL_DIR}/${match.source}`,
          freshness,
        };
        const handle: ContextHandle = {
          ref,
          title: entry.key,
          estTokens: estimateTokens(excerpt) + estimateTokens(entry.key),
          reason: `matched "${query.term}" in ${match.source}`,
          readRule: 'id-only',
        };
        if (freshness !== 'fresh') {
          // A stale or changed index still answers; each cited path is confirmed against the repository as it is now.
          const path = citedPath(match.source, entry.key, entry.value);
          if (path !== undefined && isCitablePath(path)) {
            const confirmed = pathExistsAtHead(query.workspace.repoPath, path);
            if (confirmed !== undefined) handle.confirmed = confirmed;
          }
        }
        this.#found.set(ref.id, { handle, excerpt });
        handles.push(handle);
      }
    }
    return ok(handles);
  }

  async read(handles: readonly ContextHandle[], _budget: TokenBudget): Promise<Result<ContextItem[]>> {
    const items: ContextItem[] = [];
    for (const handle of handles) {
      const found = this.#found.get(handle.ref.id);
      if (found === undefined) return err({ kind: 'invalid', field: 'handle', reason: `${handle.ref.id} was not returned by this source's latest find` });
      items.push({
        ref: handle.ref,
        title: handle.title,
        excerpt: found.excerpt,
        estTokens: handle.estTokens,
        reason: handle.reason,
        ...(handle.confirmed !== undefined ? { confirmed: handle.confirmed } : {}),
      });
    }
    return ok(items);
  }
}
