// The knowledge corpus (plan 01-18, ONB-14, S-45 corpus rule): which stable repository documents the one contained
// knowledge pass may read (the model reads it with Read, Glob and Grep; plan 01-19 decision B). Pure: paths, sizes and globs arrive as arguments, nothing here touches a file.
//
// The corpus holds the staging codebase map, `.planning/PROJECT.md`, `REQUIREMENTS.md` and `ROADMAP.md` when the
// repository tracks them, every Markdown file under the ADR directories preflight found, and the files the
// contract's `knowledge.documents` globs name (default `docs/**/*.md`). It never holds GSD phase files or
// `.planning/STATE.md` (they churn; slice 3 adds phases), a file above the size cap, or a secret-bearing path.
import { matchesAny, matchesGlob } from './glob.ts';

export const KNOWLEDGE_DIR = '.avarice-knowledge';

export const CORPUS_LIMITS = {
  // The validation cap for a map document (src/domain/validation.ts) applied to every corpus file.
  maxFileBytes: 256 * 1024,
  maxFiles: 200,
} as const;

// Tracked planning documents added when the repository has them. Order is priority order for the cap.
export const PLANNING_DOCUMENTS: readonly string[] = ['.planning/PROJECT.md', '.planning/REQUIREMENTS.md', '.planning/ROADMAP.md'];

export type CorpusDropReason = 'phase-file' | 'state-file' | 'too-large' | 'secret-path' | 'cap' | 'missing' | 'secret-content';

export interface CorpusDrop {
  path: string;
  reason: CorpusDropReason;
}

export interface KnowledgeCorpusInput {
  // Files of the pinned tree (`git ls-tree`).
  trackedPaths: readonly string[];
  // UTF-8 byte size of each candidate file that exists as a regular file in staging; a candidate without an entry is
  // dropped as `missing`.
  sizes: Readonly<Record<string, number>>;
  // The generated map files for the mapping mode in force (staging, usually not in `trackedPaths`).
  mapFiles: readonly string[];
  // Directories preflight found ADRs in.
  adrDirs: readonly string[];
  // `knowledge.documents` of the contract.
  documentGlobs: readonly string[];
  // Secret-bearing path globs of the contract.
  secretGlobs?: readonly string[];
  limits?: { maxFileBytes?: number; maxFiles?: number };
}

export interface KnowledgeCorpusSelection {
  // Sorted repository-relative paths.
  paths: string[];
  dropped: CorpusDrop[];
}

const PHASES = '.planning/phases/**';
const STATE_FILE = '.planning/STATE.md';

// Every path the rules would admit before sizes are known, in priority order (map, planning documents, ADRs, other
// documents; each group sorted), without duplicates. The stage stats exactly these.
export function knowledgeCandidates(input: Pick<KnowledgeCorpusInput, 'trackedPaths' | 'mapFiles' | 'adrDirs' | 'documentGlobs'>): string[] {
  const tracked = new Set(input.trackedPaths);
  const adr = (path: string): boolean => path.endsWith('.md') && input.adrDirs.some((dir) => path.startsWith(`${dir.replace(/\/+$/, '')}/`));
  const groups: string[][] = [
    [...input.mapFiles].sort(),
    PLANNING_DOCUMENTS.filter((path) => tracked.has(path)),
    [...tracked].filter(adr).sort(),
    [...tracked].filter((path) => matchesAny(path, input.documentGlobs)).sort(),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const path of group) {
      if (!seen.has(path)) {
        seen.add(path);
        out.push(path);
      }
    }
  }
  return out;
}

export function selectKnowledgeCorpus(input: KnowledgeCorpusInput): KnowledgeCorpusSelection {
  const maxFileBytes = input.limits?.maxFileBytes ?? CORPUS_LIMITS.maxFileBytes;
  const maxFiles = input.limits?.maxFiles ?? CORPUS_LIMITS.maxFiles;
  const secretGlobs = input.secretGlobs ?? [];
  const kept: string[] = [];
  const dropped: CorpusDrop[] = [];
  for (const path of knowledgeCandidates(input)) {
    if (matchesGlob(path, PHASES)) dropped.push({ path, reason: 'phase-file' });
    else if (path === STATE_FILE) dropped.push({ path, reason: 'state-file' });
    else if (matchesAny(path, secretGlobs)) dropped.push({ path, reason: 'secret-path' });
    else if (input.sizes[path] === undefined) dropped.push({ path, reason: 'missing' });
    else if ((input.sizes[path] as number) > maxFileBytes) dropped.push({ path, reason: 'too-large' });
    else if (kept.length >= maxFiles) dropped.push({ path, reason: 'cap' });
    else kept.push(path);
  }
  return { paths: kept.sort(), dropped };
}

// What the record states as the corpus: the map directory and each planning document by name, any other document by its
// directory (`docs/decisions/`), a file at the root by name. Sorted, without duplicates.
export function corpusSummary(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    if (path.startsWith('.planning/codebase/')) out.add('.planning/codebase/');
    else if (path.startsWith('.planning/')) out.add(path);
    else {
      const slash = path.lastIndexOf('/');
      out.add(slash === -1 ? path : `${path.slice(0, slash + 1)}`);
    }
  }
  return [...out].sort();
}

// One copy in the corpus directory, tied to its source and revision (never stored inside the corpus).
export interface KnowledgeManifestEntry {
  // Staging-relative path of the copy: `.avarice-knowledge/{sourcePath}`.
  copyPath: string;
  // Repository-relative path of the source.
  sourcePath: string;
  // `git:{pin}`.
  revision: string;
  sha256: string;
}

export interface KnowledgeManifest {
  schema: 1;
  // `git:{pin}`.
  revision: string;
  entries: KnowledgeManifestEntry[];
  // What the selection or the copy left out, by path and reason.
  excluded: CorpusDrop[];
}

export const copyPathOf = (sourcePath: string): string => `${KNOWLEDGE_DIR}/${sourcePath}`;
