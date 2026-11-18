// The knowledge corpus (plan 01-18, ONB-14, S-45 corpus rule): which stable repository documents the one contained
// knowledge pass may read (the model reads it with Read, Glob and Grep; plan 01-19 decision B). Pure: paths, sizes and globs arrive as arguments, nothing here touches a file.
//
// The corpus holds the staging codebase map, `.planning/PROJECT.md`, `REQUIREMENTS.md` and `ROADMAP.md` when the
// repository tracks them, every Markdown file under the ADR directories preflight found, and the files the
// contract's `knowledge.documents` globs name (default `docs/**/*.md`). Since plan 04-17 it also holds the GSD phase files and
// `.planning/STATE.md` (KNOWLEDGE_PLANNING_GLOBS): they churn, which is why the knowledge refresh re-extracts only the documents whose content
// changed. It never holds a file above the size cap, a secret-bearing path, or a planning file the contract's read set does not allow. Since plan 04-35 (owner
// ruling 2) it holds no more documents than one knowledge invocation can pay for: the chunk limit `knowledgeChunkLimit` derives from the invocation's cost cap
// keeps the documents of the priority order that fit, and the rest are left out as `cost-cap`, named in the manifest and counted in the record.
import { packDocuments } from './chunk-packing.ts';
import { matchesAny } from './glob.ts';

export const KNOWLEDGE_DIR = '.avarice-knowledge';

export const CORPUS_LIMITS = {
  // The validation cap for a map document (src/domain/validation.ts) applied to every corpus file.
  maxFileBytes: 256 * 1024,
  maxFiles: 200,
} as const;

// Tracked planning documents added when the repository has them. Order is priority order for the cap.
export const PLANNING_DOCUMENTS: readonly string[] = ['.planning/PROJECT.md', '.planning/REQUIREMENTS.md', '.planning/ROADMAP.md'];

export type CorpusDropReason = 'outside-read' | 'too-large' | 'secret-path' | 'cap' | 'cost-cap' | 'missing' | 'secret-content';

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
  // The contract's `files.read`: a planning document (KNOWLEDGE_PLANNING_GLOBS) is in the corpus only when it matches one of these. Absent: no restriction.
  readGlobs?: readonly string[];
  limits?: { maxFileBytes?: number; maxFiles?: number; maxChunks?: number };
}

export interface KnowledgeCorpusSelection {
  // Sorted repository-relative paths.
  paths: string[];
  dropped: CorpusDrop[];
}

// GSD's own planning files: the phase plans, summaries and context documents, and the project state. Documents of the corpus like any other (plan 04-17,
// ONB-15, S-47); the graph holds them as untrusted data, never as policy (T-04-46).
export const KNOWLEDGE_PLANNING_GLOBS: readonly string[] = ['.planning/phases/**/*.md', '.planning/STATE.md'];

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
    [...tracked].filter((path) => matchesAny(path, KNOWLEDGE_PLANNING_GLOBS)).sort(),
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
  const maxChunks = input.limits?.maxChunks;
  const secretGlobs = input.secretGlobs ?? [];
  const kept: string[] = [];
  const dropped: CorpusDrop[] = [];
  // The cost cap keeps a prefix of the priority order: once a document does not fit, it and every document after it that the other rules would keep is left out,
  // so the corpus is never a patchwork of low-priority documents that happened to pack into a chunk with room.
  let full = false;
  for (const path of knowledgeCandidates(input)) {
    if (input.readGlobs !== undefined && matchesAny(path, KNOWLEDGE_PLANNING_GLOBS) && !matchesAny(path, input.readGlobs)) dropped.push({ path, reason: 'outside-read' });
    else if (matchesAny(path, secretGlobs)) dropped.push({ path, reason: 'secret-path' });
    else if (input.sizes[path] === undefined) dropped.push({ path, reason: 'missing' });
    else if ((input.sizes[path] as number) > maxFileBytes) dropped.push({ path, reason: 'too-large' });
    else if (kept.length >= maxFiles) dropped.push({ path, reason: 'cap' });
    else if (full || (maxChunks !== undefined && packDocuments([...kept, path], input.sizes).length > maxChunks)) {
      full = true;
      dropped.push({ path, reason: 'cost-cap' });
    } else kept.push(path);
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

// The documents of `current` a refresh has to extract: those `previous` does not have (new) and those whose content digest differs (changed). A document of
// `previous` that `current` no longer has is gone and is not reported here. Order is that of `current`. Identity is the repository path and the content digest
// decides, never the revision (every entry of a manifest carries the revision it was built at).
export function changedDocuments(previous: KnowledgeManifest, current: KnowledgeManifest): KnowledgeManifestEntry[] {
  const before = new Map(previous.entries.map((entry) => [entry.sourcePath, entry.sha256] as const));
  return current.entries.filter((entry) => before.get(entry.sourcePath) !== entry.sha256);
}

// ---------------------------------------------------------------------------------------------------------
// The corpus is capped by cost (plan 04-35, owner ruling 2 of 2026-11-18, "A"; ONB-14, ONB-15)
// ---------------------------------------------------------------------------------------------------------

// The cost model of one knowledge invocation. The pass is one contained session that reads the chunks and writes one extraction file per chunk, so what it costs
// grows with the chunk count and a corpus bigger than the session can pay for cannot finish: the classifier needs every chunk, and a session that stops early is
// `no_progress`. The AC-14 run on the portfolio (a corpus of 181 documents and 53 chunks) measured it: one session read and wrote 6 chunks for 0.30 USD, its setup
// included, and stopped saying it was short of budget with 0.52 USD of its 0.80 USD cap unspent. So:
//   chunkUsd   0.05 USD a chunk = 0.30 USD / 6 chunks, the setup folded into the chunks (the measured figure is not split, so the estimate errs high);
//   capShare   0.75 of the per-invocation cap is planned for; the rest is the room a session needs because every chunk it reads makes the next turns dearer
//              (the context it carries grows with each document) and because the cap also ends the run.
// The most chunks the corpus may plan to is `floor(costCapUsd x capShare / chunkUsd)`, and never fewer than one: at the 0.8 USD cap of the AC-14 authorization 12 chunks,
// at 1.6 USD 24, at the 3.0 USD default of the onboarding contract 45. The cap is the knowledge invocation's own: the contract's per-invocation cost cap or what is
// left of the run's cost budget, the smaller (src/app/budget.ts), never a constant of any one run.
export const KNOWLEDGE_COST = { chunkUsd: 0.05, capShare: 0.75 } as const;

export function knowledgeChunkLimit(costCapUsd: number): number {
  const fits = Math.floor((costCapUsd * KNOWLEDGE_COST.capShare) / KNOWLEDGE_COST.chunkUsd + 1e-9);
  return Math.max(1, fits);
}
