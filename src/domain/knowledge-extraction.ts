// The knowledge pass's extraction contract (plan 01-19 gap fix B, owner decision 2026-11-03). The model no longer runs graphify's
// skill. AVARICE splits the corpus into chunks (this file: deterministic, pure), the model only reads the chunked documents with
// Read, Glob and Grep and writes one extraction JSON file per chunk into ONE output directory (no shell, no skill, no subagent),
// and AVARICE then assembles those files, merges them into the code graph (graph-merge.ts), validates (knowledge-validation.ts),
// has graphify cluster the result and installs it.
//
// Why AVARICE chunks and builds itself, not graphify (graphify 0.9.53): its only chunker, `_pack_chunks_by_tokens`, is private to
// the code path that calls an LLM backend with an API key (`graphify extract`), and the skill's chunking (20 to 25 files, grouped
// by directory) is prose for the model, not a function. Its `detect` and `build_from_json` are Python APIs with no CLI subcommand,
// and `build_from_json` remaps IDs and drops edges before AVARICE could count them, which would defeat the dangling-edge check and
// the merge's "a code node wins an ID collision" rule. The extraction JSON already has the shape the merge consumes (`nodes`, and
// `edges` next to `links`), so no conversion beyond concatenating the chunks is needed; graphify's own deterministic step that
// remains in use is `cluster-only` on the merged graph. See docs/repository-onboarding.md "Knowledge pass".
import type { KnowledgeManifest } from './knowledge-corpus.ts';
import { KNOWLEDGE_DIR } from './knowledge-corpus.ts';

// Where the model's output goes, relative to the corpus directory (its working directory), and relative to staging.
export const EXTRACTION_DIR_NAME = '.extraction';
export const EXTRACTION_DIR = `${KNOWLEDGE_DIR}/${EXTRACTION_DIR_NAME}`;
// The chunk plan the model reads, relative to the corpus directory and to staging. AVARICE writes it; the model only reads it.
export const CHUNK_PLAN_NAME = '.chunks.json';
export const CHUNK_PLAN_FILE = `${KNOWLEDGE_DIR}/${CHUNK_PLAN_NAME}`;

export const CHUNK_LIMITS = {
  // At most this many documents in one chunk, and at most this many bytes of document text: a chunk is one model answer, and one
  // JSON file that answer writes, so both stay small enough for a small model to hold (graphify's skill uses 20 to 25 files).
  maxFiles: 8,
  maxBytes: 64 * 1024,
  // The largest chunk file AVARICE reads back.
  maxOutputBytes: 1024 * 1024,
} as const;

export interface ExtractionChunkFile {
  // Path relative to the corpus directory (the model's working directory): the repository path of the document.
  path: string;
  // Prefix of every node id of this file: the repository path without its extension, lowercased, each run of characters outside
  // [a-z0-9] replaced by `_`, segments joined with `_` (the graphify extraction spec's node id format).
  stem: string;
}

export interface ExtractionChunk {
  // 1-based.
  n: number;
  // The file the model writes this chunk's extraction to, relative to the corpus directory.
  output: string;
  files: ExtractionChunkFile[];
}

export interface ExtractionPlan {
  schema: 1;
  revision: string;
  chunks: ExtractionChunk[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
export const chunkOutputName = (n: number): string => `chunk-${pad(n)}.json`;

// `docs/adr/0001-Use Postgres.md` -> `docs_adr_0001_use_postgres`.
export function stemOf(sourcePath: string): string {
  return sourcePath;
}

// Splits the manifest's documents into chunks: sorted by path (so the documents of one directory sit together), then filled in
// order until a chunk holds `maxFiles` documents or `maxBytes` of text. A document larger than `maxBytes` is a chunk of its own.
// `sizes` is the byte size of each source path (a path without a size counts as `maxBytes`). Deterministic: the same manifest and
// sizes give the same plan.
export function planExtractionChunks(manifest: KnowledgeManifest, _sizes: Readonly<Record<string, number>>, _limits: { maxFiles?: number; maxBytes?: number } = {}): ExtractionPlan {
  return { schema: 1, revision: manifest.revision, chunks: [] };
}

// The staging-relative path of a chunk's output file (what the host judges `progressed` by).
export const outputPathOf = (chunk: ExtractionChunk): string => `${KNOWLEDGE_DIR}/${chunk.output}`;

// ---------------------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------------------

// The prompt carries no repository text at all (not even a file name): it is fixed text and two counts. The file list lives in the
// plan file, which the model reads as data, so a hostile file name cannot become an instruction. The schema and rules follow the
// graphify skill's extraction spec (references/extraction-spec.md of the installed skill), minus what AVARICE does itself: it
// derives nothing from `confidence_score`, never merges hyperedges, and lowers an EXTRACTED edge that touches a document node.
export function knowledgePrompt(_plan: ExtractionPlan): string {
  return '/graphify .';
}

// ---------------------------------------------------------------------------------------------------------
// Assembling the chunk files
// ---------------------------------------------------------------------------------------------------------

export type ChunkText = { text: string } | { problem: 'missing' | 'too-large' | 'unreadable' };

export interface SkippedChunk {
  n: number;
  reason: 'missing' | 'too-large' | 'unreadable' | 'not-json' | 'bad-shape';
}

export interface AssembledExtraction {
  // `{ nodes, edges }`: what mergeKnowledgeGraph reads as the pass's graph.
  graph: { nodes: unknown[]; edges: unknown[] };
  // The chunks that produced usable output, and the documents they cover.
  used: number[];
  usedFiles: string[];
  skipped: SkippedChunk[];
  // How many chunk files were present at all (usable or not).
  present: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Concatenates the usable chunk files in chunk order. A chunk is usable when its file is JSON, an object, with a `nodes` array and an
// `edges` (or `links`) array. Anything else is skipped and counted; no node or edge is invented, repaired or reordered. What the
// nodes and edges say is judged later by the merge and the validation, which see exactly what the model wrote.
export function assembleExtraction(_plan: ExtractionPlan, _texts: Readonly<Record<number, ChunkText>>): AssembledExtraction {
  return { graph: { nodes: [], edges: [] }, used: [], usedFiles: [], skipped: [], present: 0 };
}
