// `gsd-planning` context adapter (plan 04-26; FR-3, FR-18): whole sections of GSD's planning files, read from the staging copy and never from the user's
// checkout. The files are `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, and, in the directory of the phase GSD's `state.json` marks `in_progress`, that
// phase's `CONTEXT.md`, `PLAN.md` and `LEARNINGS.md` files (docs/contracts-and-state.md "ContextSource"). A section runs from one Markdown heading to the next;
// `find` returns a handle for each section that holds every word of the term, with an estimate and no text, and `read` returns the section text, marked untrusted
// so a consumer prints it fenced: planning text is data and never a policy source (T-04-73, S-46).
//
// Freshness is the digest of `state.json`: a reference recorded against one digest is `stale` once GSD has moved the state on. Every read opens the file without
// following a symbolic link, requires a regular file within a size cap, and walks only real directories under the staging copy, so a planted link cannot lead the
// adapter outside it. It writes nothing.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextHandle, ContextItem, ContextQuery, ContextRefreshQuery, ContextSource, ExternalRef, Freshness, TokenBudget } from '../../ports/context-source.ts';
import { estimateTokens, isCitablePath } from './freshness.ts';
import type { ContextAdapterOptions } from './gsd-intel.ts';

const PLANNING_DIR = '.planning';
const PROJECT_FILES = ['PROJECT.md', 'REQUIREMENTS.md'] as const;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_STATE_BYTES = 256 * 1024;
// A section is cut here and says so; a larger one is a file that is not written in sections.
const MAX_SECTION_CHARS = 6000;
const MAX_HANDLES = 50;
const MAX_TERM_CHARS = 200;
const MAX_TERM_WORDS = 8;
const STATE_ABSENT = 'gsd-state:absent';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const PHASE_FILE = /(?:^|-)(?:CONTEXT|LEARNINGS)\.md$|-PLAN\.md$/;

interface Section {
  slug: string;
  heading: string;
  text: string;
}

interface Found {
  handle: ContextHandle;
  excerpt: string;
}

// A regular file of at most `maxBytes`, opened without following a link; undefined when it is absent, a link, not a regular file or too large.
function readRegular(path: string, maxBytes: number): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    return readFileSync(fd, 'utf8');
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

// A directory that is a real directory (not a link to one).
function isRealDirectory(path: string): boolean {
  try {
    const info = lstatSync(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

const digestOfState = (text: string): string => `gsd-state:sha256:${createHash('sha256').update(text).digest('hex')}`;

// `4` and `04` and `4.1` name the directories `04-...` and `04.1-...`.
function phasePrefix(number: unknown): string | undefined {
  if (typeof number !== 'string' && typeof number !== 'number') return undefined;
  const [major, ...rest] = String(number).split('.');
  if (major === undefined || !/^[0-9]{1,3}$/.test(major) || rest.some((part) => !/^[0-9]{1,3}$/.test(part))) return undefined;
  return [major.padStart(2, '0'), ...rest].join('.');
}

// The directory under `.planning/phases` of the phase `state.json` marks in progress, or undefined.
function currentPhaseDirectory(root: string, stateText: string | undefined): string | undefined {
  if (stateText === undefined) return undefined;
  let state: unknown;
  try {
    state = JSON.parse(stateText);
  } catch {
    return undefined;
  }
  const phases = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)['phases'] : undefined;
  if (!Array.isArray(phases)) return undefined;
  const current = phases.find((p) => typeof p === 'object' && p !== null && (p as Record<string, unknown>)['status'] === 'in_progress') as Record<string, unknown> | undefined;
  const prefix = current === undefined ? undefined : phasePrefix(current['number']);
  if (prefix === undefined) return undefined;
  const phasesDir = join(root, 'phases');
  if (!isRealDirectory(phasesDir)) return undefined;
  try {
    const names = readdirSync(phasesDir).filter((name) => (name === prefix || name.startsWith(`${prefix}-`)) && isRealDirectory(join(phasesDir, name)));
    return names.sort()[0];
  } catch {
    return undefined;
  }
}

// The planning files this adapter reads, relative to `.planning`: the two project files and the current phase's context, plan and learnings files.
function planningFiles(root: string, stateText: string | undefined): string[] {
  const files: string[] = [...PROJECT_FILES];
  const phase = currentPhaseDirectory(root, stateText);
  if (phase !== undefined) {
    try {
      for (const name of readdirSync(join(root, 'phases', phase)).sort()) {
        if (PHASE_FILE.test(name)) files.push(`phases/${phase}/${name}`);
      }
    } catch {
      // an unreadable phase directory contributes no file
    }
  }
  return files;
}

function slugOf(heading: string): string {
  const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'section' : slug;
}

// A planning line longer than this is body text, never a heading: a crafted line must not cost the supervisor more than a bounded scan (CR-05).
export const MAX_HEADING_LINE_CHARS = 2000;

const isBlank = (char: string | undefined): boolean => char === ' ' || char === '\t';

// The text of an ATX heading line (one to six hashes, then a space or tab), or null when the line is not one. One trailing carriage return and trailing whitespace are
// dropped, and a run of closing hashes only when a space or tab precedes it (or it is the whole text). A hand loop, linear in the line, with no backtracking.
export function headingOf(line: string): string | null {
  if (line.length > MAX_HEADING_LINE_CHARS) return null;
  let start = 0;
  while (start < line.length && line.charCodeAt(start) === 35) start += 1;
  if (start < 1 || start > 6 || !isBlank(line[start])) return null;
  while (isBlank(line[start])) start += 1;
  let end = line.endsWith('\r') ? line.length - 1 : line.length;
  while (end > start && isBlank(line[end - 1])) end -= 1;
  let hashes = end;
  while (hashes > start && line[hashes - 1] === '#') hashes -= 1;
  if (hashes < end && (hashes === start || isBlank(line[hashes - 1]))) {
    end = hashes;
    while (end > start && isBlank(line[end - 1])) end -= 1;
  }
  return end > start ? line.slice(start, end) : null;
}

// Sections delimited by Markdown headings outside code fences. Text before the first heading is the `preamble` section. A slug that repeats gets `-2`, `-3`.
function sectionsOf(text: string, file: string): Section[] {
  const sections: Section[] = [];
  const seen = new Map<string, number>();
  let current: { heading: string; lines: string[]; preamble: boolean } | undefined;
  let fenced = false;
  const close = (): void => {
    if (current === undefined) return;
    const body = current.lines.join('\n').trim();
    if (body !== '') {
      const base = current.preamble ? 'preamble' : slugOf(current.heading);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      sections.push({ slug: count === 1 ? base : `${base}-${count}`, heading: current.heading, text: body });
    }
  };
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : headingOf(line);
    if (heading !== null) {
      close();
      current = { heading, lines: [line], preamble: false };
    } else {
      current ??= { heading: file, lines: [], preamble: true };
      current.lines.push(line);
    }
  }
  close();
  return sections;
}

export class GsdPlanningContext implements ContextSource {
  readonly descriptor: CapabilityDescriptor;
  readonly #nowMs: () => number;
  // The sections the latest `find` returned, by handle ID.
  #found = new Map<string, Found>();

  constructor(options: ContextAdapterOptions) {
    this.#nowMs = () => options.nowMs();
    this.descriptor = {
      port: 'context-source',
      adapter: 'gsd-planning',
      version: '1',
      capabilities: { find: true, read: true, refresh: true },
      offline: true,
    };
  }

  async find(query: ContextQuery, _budget: TokenBudget): Promise<Result<ContextHandle[]>> {
    this.#found = new Map();
    const words = query.term.toLowerCase().split(/\s+/).filter((w) => w !== '');
    if (words.length === 0 || words.length > MAX_TERM_WORDS || query.term.length > MAX_TERM_CHARS || CONTROL.test(query.term)) return ok([]);
    const root = join(query.workspace.stagingPath, PLANNING_DIR);
    if (!isRealDirectory(root)) return ok([]);
    const stateText = readRegular(join(root, 'state.json'), MAX_STATE_BYTES);
    const revision = stateText === undefined ? STATE_ABSENT : digestOfState(stateText);
    // Without a state.json GSD's state cannot be judged, so the sections still answer but say their freshness is unavailable.
    const freshness: Freshness = stateText === undefined ? 'unavailable' : 'fresh';
    const retrievedAt = new Date(this.#nowMs()).toISOString();

    const matched: Array<{ handle: ContextHandle; excerpt: string; inHeading: boolean }> = [];
    for (const file of planningFiles(root, stateText)) {
      const text = readRegular(join(root, file), MAX_FILE_BYTES);
      if (text === undefined) continue;
      for (const section of sectionsOf(text, file)) {
        const haystack = `${section.heading}\n${section.text}`.toLowerCase();
        if (!words.every((w) => haystack.includes(w))) continue;
        const excerpt = section.text.length <= MAX_SECTION_CHARS ? section.text : `${section.text.slice(0, MAX_SECTION_CHARS)}…[cut]`;
        const ref: ExternalRef = { provider: 'gsd-planning', kind: 'section', id: `${file}#${section.slug}`, revision, retrievedAt, scope: `${PLANNING_DIR}/${file}`, freshness };
        const title = `${file}: ${section.heading}`;
        const handle: ContextHandle = { ref, title, estTokens: estimateTokens(excerpt) + estimateTokens(title), reason: `matched "${query.term}" in ${file}`, readRule: 'id-only', untrusted: true };
        matched.push({ handle, excerpt, inHeading: words.every((w) => section.heading.toLowerCase().includes(w)) });
      }
    }
    // A section whose heading holds the term answers before one that only mentions it; the order of the files and sections otherwise.
    const handles: ContextHandle[] = [];
    for (const m of [...matched.filter((x) => x.inHeading), ...matched.filter((x) => !x.inHeading)].slice(0, MAX_HANDLES)) {
      this.#found.set(m.handle.ref.id, { handle: m.handle, excerpt: m.excerpt });
      handles.push(m.handle);
    }
    return ok(handles);
  }

  async read(handles: readonly ContextHandle[], _budget: TokenBudget): Promise<Result<ContextItem[]>> {
    const items: ContextItem[] = [];
    for (const handle of handles) {
      const found = this.#found.get(handle.ref.id);
      if (found === undefined) return err({ kind: 'invalid', field: 'handle', reason: `${handle.ref.id} was not returned by this source's latest find` });
      items.push({ ref: handle.ref, title: handle.title, excerpt: found.excerpt, estTokens: handle.estTokens, reason: handle.reason, untrusted: true });
    }
    return ok(items);
  }

  // A section is judged by the file it came from and GSD's state: a section that is no longer in its file (or a file that is gone) is `deleted`; the state digest the
  // reference recorded against another one than now is `stale`; a state that cannot be read is `unavailable`.
  async refresh(ref: ExternalRef, query: ContextRefreshQuery): Promise<Result<ExternalRef>> {
    const retrievedAt = new Date(this.#nowMs()).toISOString();
    const hash = ref.id.lastIndexOf('#');
    const file = hash < 0 ? '' : ref.id.slice(0, hash);
    const slug = hash < 0 ? '' : ref.id.slice(hash + 1);
    const allowed = (PROJECT_FILES as readonly string[]).includes(file) || (file.startsWith('phases/') && file.split('/').length === 3 && PHASE_FILE.test(file));
    if (!allowed || !isCitablePath(file) || slug === '') return err({ kind: 'invalid', field: 'ref.id', reason: `${ref.id} is not a planning section ID` });
    const root = join(query.workspace.stagingPath, PLANNING_DIR);
    const settled = (freshness: Freshness, revision?: string): Result<ExternalRef> => ok({ ...ref, ...(revision !== undefined ? { revision } : {}), retrievedAt, freshness });
    const text = isRealDirectory(root) ? readRegular(join(root, file), MAX_FILE_BYTES) : undefined;
    if (text === undefined || !sectionsOf(text, file).some((s) => s.slug === slug)) return settled('deleted');
    const stateText = readRegular(join(root, 'state.json'), MAX_STATE_BYTES);
    if (stateText === undefined) return settled('unavailable', STATE_ABSENT);
    const now = digestOfState(stateText);
    return settled(ref.revision === now ? 'fresh' : 'stale', now);
  }
}
