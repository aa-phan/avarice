// The knowledge corpus (plan 01-18, ONB-14, S-45 corpus rule): which stable repository documents the one contained
// `/graphify` pass may read. Pure: paths, sizes and globs arrive as arguments, nothing here touches a file.
//
// The corpus holds the staging codebase map, `.planning/PROJECT.md`, `REQUIREMENTS.md` and `ROADMAP.md` when the
// repository tracks them, every Markdown file under the ADR directories preflight found, and the files the
// contract's `knowledge.documents` globs name (default `docs/**/*.md`). It never holds GSD phase files or
// `.planning/STATE.md` (they churn; slice 3 adds phases), a file above the size cap, or a secret-bearing path.

export const KNOWLEDGE_DIR = '.avarice-knowledge';

export const CORPUS_LIMITS = {
  // The validation cap for a map document (src/domain/validation.ts) applied to every corpus file.
  maxFileBytes: 256 * 1024,
  maxFiles: 200,
  // The graphify skill spawns one subagent per 20 to 25 uncached documents.
  documentsPerSubagent: 20,
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


// Every path the rules would admit before sizes are known, in priority order (map, planning documents, ADRs, other
// documents; each group sorted), without duplicates. The stage stats exactly these.
export function knowledgeCandidates(input: Pick<KnowledgeCorpusInput, 'trackedPaths' | 'mapFiles' | 'adrDirs' | 'documentGlobs'>): string[] {
  void input;
  return []; // RED stub
}

export function selectKnowledgeCorpus(input: KnowledgeCorpusInput): KnowledgeCorpusSelection {
  void input;
  return { paths: [], dropped: [] }; // RED stub
}

// What the record states as the corpus: the map directory and each planning document by name, any other document by its
// directory (`docs/decisions/`), a file at the root by name. Sorted, without duplicates.
export function corpusSummary(paths: readonly string[]): string[] {
  void paths;
  return []; // RED stub
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
