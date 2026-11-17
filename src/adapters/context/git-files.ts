// `git-files` context adapter (plan 04-26; FR-3, FR-22): a scoped search of the tracked files at one revision of the repository (or of the run's clone), then
// bounded snippets. `find` runs `git grep` for the term as a fixed string inside the read paths and returns one handle per hit (path, line, an estimate) and no
// text; `read` returns at most 40 lines around each picked hit, cut at the excerpt cap. It searches committed objects only (never the working tree, so an
// uncommitted edit or an untracked secret cannot answer), through safe git (hooks, filters and prompts off, no global option accepted), and it returns a hit only
// from a path the read scope allows: a contract's read paths minus its excluded directories and its secret globs. It writes nothing.
import { defaultContextReadScope } from '../../domain/context-adapters.ts';
import type { ContextReadScope } from '../../domain/context-adapters.ts';
import { matchesAny } from '../../domain/glob.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextHandle, ContextItem, ContextQuery, ContextRefreshQuery, ExternalRef, Freshness, GitFilesSource, TokenBudget } from '../../ports/context-source.ts';
import { runGit } from '../git/safe-git.ts';
import { commitOf, currentHead, estimateTokens, isCitablePath, pathExistsAtHead } from './freshness.ts';
import type { ContextAdapterOptions } from './gsd-intel.ts';

// The search's own bounds. Plan 04-28 makes them profile and contract values; these are the documented defaults (docs/containment.md "Retrieval").
const MAX_HITS = 200;
const MAX_HITS_PER_FILE = 5;
const SEARCH_TIMEOUT_MS = 10_000;
const MAX_TERM_CHARS = 200;
const MAX_READ_GLOBS = 100;
// A snippet is the hit line, 20 lines before it and 19 after: 40 lines at most.
const LINES_BEFORE = 20;
const MAX_SNIPPET_LINES = 40;
const MAX_EXCERPT_CHARS = 1500;
// A snippet is never read from a file larger than this.
const MAX_BLOB_BYTES = 1024 * 1024;
// A handle's estimate is the most a snippet can cost: the excerpt cap in tokens.
const SNIPPET_EST_TOKENS = estimateTokens('x'.repeat(MAX_EXCERPT_CHARS));
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

interface Found {
  handle: ContextHandle;
  path: string;
  line: number;
  head: string;
  root: string;
}

const rootOf = (workspace: ContextQuery['workspace']): string => workspace.worktreePath ?? workspace.repoPath;

// Whether `path` may be returned under `scope`: inside a read glob, outside every excluded directory (a directory name or a glob) and every secret glob.
function inScope(path: string, scope: ContextReadScope): boolean {
  if (!matchesAny(path, scope.read)) return false;
  const excluded = [...scope.readExclude, ...scope.readExclude.map((entry) => `${entry}/**`), ...scope.secretGlobs];
  return !matchesAny(path, excluded);
}

// The pathspecs `git grep` is limited to: the read globs as glob pathspecs, or the whole tree when the scope reads everything. The hits are filtered again by
// `inScope`, so the pathspecs only narrow the work.
function pathspecsOf(scope: ContextReadScope): string[] {
  if (scope.read.some((glob) => glob === '**' || glob === '*')) return ['.'];
  return scope.read.slice(0, MAX_READ_GLOBS).map((glob) => `:(glob)${glob}`);
}

// One hit of `git grep -n -z <rev>`: `<rev>:<path> NUL <line> NUL <text>`.
function parseHit(row: string, head: string): { path: string; line: number } | undefined {
  const prefix = `${head}:`;
  if (!row.startsWith(prefix)) return undefined;
  const [path, lineText] = row.slice(prefix.length).split('\0');
  if (path === undefined || lineText === undefined || !/^[1-9][0-9]{0,8}$/.test(lineText) || !isCitablePath(path)) return undefined;
  return { path, line: Number(lineText) };
}

// The window of at most 40 lines around `line` (1-based), each prefixed with its number, narrowed from its far side until it fits the excerpt cap.
function snippetOf(text: string, line: number): string {
  const all = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (all[all.length - 1] === '') all.pop();
  let first = Math.max(1, line - LINES_BEFORE);
  let last = Math.min(all.length, first + MAX_SNIPPET_LINES - 1);
  const render = (): string[] => all.slice(first - 1, last).map((l, i) => `${first + i}: ${l}`);
  let joined = render().join('\n');
  while (joined.length > MAX_EXCERPT_CHARS && (first < line || last > line)) {
    if (first < line && (last === line || line - first >= last - line)) first += 1;
    else last -= 1;
    joined = render().join('\n');
  }
  return joined.length <= MAX_EXCERPT_CHARS ? joined : `${joined.slice(0, MAX_EXCERPT_CHARS)}…[cut]`;
}

export class GitFilesContext implements GitFilesSource {
  readonly descriptor: CapabilityDescriptor;
  readonly #nowMs: () => number;
  // The hits the latest `find` returned, by handle ID, so `read` answers only for handles this source returned.
  #found = new Map<string, Found>();

  constructor(options: ContextAdapterOptions) {
    this.#nowMs = () => options.nowMs();
    this.descriptor = {
      port: 'context-source',
      adapter: 'git-files',
      version: '1',
      capabilities: { find: true, read: true, refresh: true },
      offline: true,
    };
  }

  async find(query: ContextQuery, _budget: TokenBudget): Promise<Result<ContextHandle[]>> {
    this.#found = new Map();
    const root = rootOf(query.workspace);
    const head = currentHead(root);
    if (head === null) return err({ kind: 'unavailable', cause: `the revision of ${root} cannot be read` });
    const term = query.term;
    // A term that is empty, long or not one line cannot be a search for a name; it finds nothing rather than being cut or reinterpreted.
    if (term.trim() === '' || term.length > MAX_TERM_CHARS || CONTROL.test(term)) return ok([]);
    const scope = query.readScope ?? defaultContextReadScope();
    // The term follows `-e` and the search is `--fixed-strings`, so it is a pattern and never an option or a regular expression; the paths follow `--`.
    const ran = runGit(['grep', '-n', '-z', '--fixed-strings', '-I', '--no-color', '--max-count', String(MAX_HITS_PER_FILE), '-e', term, head, '--', ...pathspecsOf(scope)], {
      cwd: root,
      timeoutMs: SEARCH_TIMEOUT_MS,
      acceptExit: [1],
    });
    if (!ran.ok) return ran.error.kind === 'internal' ? err({ kind: 'unavailable', cause: 'the search could not run in the repository' }) : ran;
    const retrievedAt = new Date(this.#nowMs()).toISOString();
    const handles: ContextHandle[] = [];
    for (const row of ran.value.stdout.split('\n')) {
      if (handles.length >= MAX_HITS) break;
      const hit = parseHit(row, head);
      if (hit === undefined || !inScope(hit.path, scope)) continue;
      const id = `${hit.path}:${hit.line}`;
      if (this.#found.has(id)) continue;
      const ref: ExternalRef = { provider: 'git-files', kind: 'snippet', id, revision: `git:${head}`, retrievedAt, scope: hit.path, freshness: 'fresh' };
      const handle: ContextHandle = { ref, title: id, estTokens: SNIPPET_EST_TOKENS, reason: `matched "${term}" in ${hit.path}`, readRule: 'id-only', untrusted: true, citedPath: hit.path };
      this.#found.set(id, { handle, path: hit.path, line: hit.line, head, root });
      handles.push(handle);
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
        excerpt: this.#snippet(found),
        estTokens: handle.estTokens,
        reason: handle.reason,
        untrusted: true,
        citedPath: found.path,
      });
    }
    return ok(items);
  }

  // The lines around a hit at the revision the search ran at; a file that is too large, not a blob or gone says so instead of a snippet.
  #snippet(found: Found): string {
    const object = `${found.head}:${found.path}`;
    const size = runGit(['cat-file', '-s', object], { cwd: found.root, timeoutMs: SEARCH_TIMEOUT_MS });
    if (!size.ok) return '[the file cannot be read at this revision]';
    if (!/^[0-9]+$/.test(size.value.stdout.trim()) || Number(size.value.stdout.trim()) > MAX_BLOB_BYTES) return `[the file is larger than ${MAX_BLOB_BYTES} bytes; no snippet is read from it]`;
    const blob = runGit(['cat-file', 'blob', object], { cwd: found.root, timeoutMs: SEARCH_TIMEOUT_MS });
    if (!blob.ok) return '[the file cannot be read at this revision]';
    return snippetOf(blob.value.stdout, found.line);
  }

  // A snippet is judged by the tree it was found in and the repository as it is now: the path gone at HEAD is `deleted`, HEAD still the revision it was found at is
  // `fresh`, any other HEAD is `stale`, and a HEAD that cannot be read is `unavailable`. The path is the ID up to its last colon (a path may hold colons).
  async refresh(ref: ExternalRef, query: ContextRefreshQuery): Promise<Result<ExternalRef>> {
    const retrievedAt = new Date(this.#nowMs()).toISOString();
    const root = rootOf(query.workspace);
    const settled = (freshness: Freshness, head: string | null): Result<ExternalRef> => ok({ ...ref, ...(head !== null ? { revision: `git:${head}` } : {}), retrievedAt, freshness });
    const head = currentHead(root);
    if (head === null) return settled('unavailable', null);
    const cut = ref.id.lastIndexOf(':');
    const path = cut < 0 ? ref.id : ref.id.slice(0, cut);
    if (pathExistsAtHead(root, path) === false) return settled('deleted', head);
    return settled(ref.revision !== undefined && commitOf(ref.revision) === head ? 'fresh' : 'stale', head);
  }

  pathExists(workspace: ContextQuery['workspace'], path: string): boolean | undefined {
    return pathExistsAtHead(rootOf(workspace), path);
  }
}
