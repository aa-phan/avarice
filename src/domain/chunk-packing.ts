// How the knowledge pass packs documents into chunks (plan 01-19 gap fix B; shared since plan 04-35). One function decides which documents share a chunk, so the chunk plan the
// model is given (planExtractionChunks) and the count of chunks the corpus rule plans for (selectKnowledgeCorpus, ruling 2 of plan 04-35) can never disagree. Pure.

export const CHUNK_LIMITS = {
  // At most this many documents in one chunk, and at most this many bytes of document text: a chunk is one model answer, and one
  // JSON file that answer writes, so both stay small enough for a small model to hold (graphify's skill uses 20 to 25 files).
  maxFiles: 8,
  maxBytes: 64 * 1024,
  // The largest chunk file AVARICE reads back.
  maxOutputBytes: 1024 * 1024,
} as const;

// The groups of `paths` in chunk order: sorted by path (so the documents of one directory sit together), then filled in order until a group holds `maxFiles`
// documents or `maxBytes` of text. A document larger than `maxBytes` is a group of its own. `sizes` is the byte size of each path (a path without a size counts as
// `maxBytes`). Deterministic: the same paths and sizes give the same groups.
export function packDocuments(paths: readonly string[], sizes: Readonly<Record<string, number>>, limits: { maxFiles?: number; maxBytes?: number } = {}): string[][] {
  const maxFiles = limits.maxFiles ?? CHUNK_LIMITS.maxFiles;
  const maxBytes = limits.maxBytes ?? CHUNK_LIMITS.maxBytes;
  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const groups: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const path of sorted) {
    const size = sizes[path] ?? maxBytes;
    if (current.length > 0 && (current.length >= maxFiles || bytes + size > maxBytes)) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += size;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
