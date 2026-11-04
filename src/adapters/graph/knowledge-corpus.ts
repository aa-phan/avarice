// Corpus materialization for the knowledge pass (plan 01-18, ONB-14). AVARICE, not the agent, copies the selected
// documents into `{staging}/.avarice-knowledge/` at their repository-relative paths (so node IDs the skill derives from
// paths equal the code graph's), writes a `.graphifyignore` that keeps the skill's own output out of its input, and writes
// the manifest tying each copy to its source path, revision and SHA-256. The manifest lives in the data root, never inside
// the corpus. A source that is a symlink, outside the staging tree, too large or carrying a secret is left out and said so.
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { sha256Hex } from '../../domain/digest.ts';
import { CORPUS_LIMITS, KNOWLEDGE_DIR, copyPathOf } from '../../domain/knowledge-corpus.ts';
import type { CorpusDrop, KnowledgeManifest, KnowledgeManifestEntry } from '../../domain/knowledge-corpus.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { findSecrets } from '../../domain/secret-patterns.ts';
import { CHUNK_LIMITS, CHUNK_PLAN_NAME, EXTRACTION_DIR_NAME } from '../../domain/knowledge-extraction.ts';
import type { ChunkText, ExtractionPlan } from '../../domain/knowledge-extraction.ts';

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const GRAPHIFY_OUT = 'graphify-out';

function inside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

// A repository-relative path: no NUL, no backslash, not absolute, no `.` or `..` segment.
function segmentsOf(relPath: string): string[] | undefined {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0') || relPath.includes('\\') || isAbsolute(relPath)) return undefined;
  const segments = relPath.split('/');
  return segments.some((s) => s === '' || s === '.' || s === '..') ? undefined : segments;
}

// The real path of a regular, non-symlink file inside the staging tree; undefined when it is anything else.
function regularFile(root: string, segments: readonly string[]): { file: string; size: number } | undefined {
  try {
    const parent = realpathSync(join(root, ...segments.slice(0, -1)));
    if (!inside(root, parent)) return undefined;
    const file = join(parent, segments[segments.length - 1] as string);
    const stat = lstatSync(file);
    return stat.isFile() ? { file, size: stat.size } : undefined;
  } catch {
    return undefined;
  }
}

function stagingRoot(stagingPath: string): Result<string> {
  try {
    return ok(realpathSync(stagingPath));
  } catch {
    return err({ kind: 'invalid', field: 'stagingPath', reason: 'cannot be resolved' });
  }
}

// Byte size of each path that is a regular file inside staging (a symlink or a missing file has no entry).
export function fileSizes(stagingPath: string, paths: readonly string[]): Result<Record<string, number>> {
  const root = stagingRoot(stagingPath);
  if (!root.ok) return root;
  const sizes: Record<string, number> = {};
  for (const path of paths) {
    const segments = segmentsOf(path);
    if (segments === undefined) continue;
    const found = regularFile(root.value, segments);
    if (found !== undefined) sizes[path] = found.size;
  }
  return ok(sizes);
}

export function materializeCorpus(
  stagingPath: string,
  paths: readonly string[],
  manifestFile: string,
  pin: string,
  dropped: readonly CorpusDrop[] = [],
): Result<{ manifest: KnowledgeManifest }> {
  if (!FULL_COMMIT.test(pin)) return err({ kind: 'invalid', field: 'pin', reason: 'a full lowercase commit SHA is required' });
  if (!isAbsolute(manifestFile)) return err({ kind: 'invalid', field: 'manifestFile', reason: 'must be an absolute path' });
  const root = stagingRoot(stagingPath);
  if (!root.ok) return root;
  const wanted = [...new Set(paths)].sort();
  for (const path of wanted) {
    if (segmentsOf(path) === undefined) return err({ kind: 'invalid', field: 'paths', reason: `${JSON.stringify(path)} is not a repository-relative path inside the tree` });
  }

  const corpus = join(root.value, KNOWLEDGE_DIR);
  try {
    // A symlink where the corpus directory should be is never followed or kept.
    rmSync(corpus, { recursive: true, force: true });
    mkdirSync(corpus);
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot prepare the corpus directory: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }

  const revision = `git:${pin}`;
  const entries: KnowledgeManifestEntry[] = [];
  const excluded: CorpusDrop[] = [...dropped];
  for (const path of wanted) {
    const segments = segmentsOf(path) as string[];
    const found = regularFile(root.value, segments);
    if (found === undefined) {
      excluded.push({ path, reason: 'missing' });
      continue;
    }
    if (found.size > CORPUS_LIMITS.maxFileBytes) {
      excluded.push({ path, reason: 'too-large' });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(found.file);
    } catch {
      excluded.push({ path, reason: 'missing' });
      continue;
    }
    if (findSecrets(bytes.toString('utf8')).length > 0) {
      excluded.push({ path, reason: 'secret-content' });
      continue;
    }
    try {
      const target = join(corpus, ...segments);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { mode: 0o644 });
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot copy ${path} into the corpus: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
    }
    entries.push({ copyPath: copyPathOf(path), sourcePath: path, revision, sha256: sha256Hex(bytes) });
  }

  try {
    writeFileSync(join(corpus, '.graphifyignore'), `${GRAPHIFY_OUT}/\n`, { mode: 0o644 });
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot write .graphifyignore: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }

  excluded.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  const manifest: KnowledgeManifest = { schema: 1, revision, entries, excluded };
  try {
    mkdirSync(dirname(manifestFile), { recursive: true, mode: 0o700 });
    // Beside the target and renamed, so an existing wider file is replaced, never kept.
    const temp = `${manifestFile}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, manifestFile);
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot write the manifest: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }
  return ok({ manifest });
}

// The chunk plan and the output directory beside the corpus files (decision B). The plan is a corpus file the model reads (paths and
// stems only: no digest, no text); `.extraction` is the one directory it writes. Both are recreated for every attempt.
export function writeExtractionPlan(stagingPath: string, plan: ExtractionPlan): Result<void> {
  const root = stagingRoot(stagingPath);
  if (!root.ok) return root;
  const corpus = join(root.value, KNOWLEDGE_DIR);
  try {
    // The corpus directory is AVARICE's own (materializeCorpus just made it); never write through a link in its place.
    const stat = lstatSync(corpus);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return err({ kind: 'invalid', field: 'corpus', reason: `${KNOWLEDGE_DIR} is a symlink or not a directory` });
    const out = join(corpus, EXTRACTION_DIR_NAME);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out);
    const file = join(corpus, CHUNK_PLAN_NAME);
    const temp = `${file}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
    renameSync(temp, file);
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot write the extraction plan: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }
  return ok(undefined);
}

// The chunk files the model wrote, read only when every directory on the way is a real directory (the model wrote there, so a
// symlink may sit in the way) and the file is a regular one. A file larger than the cap is reported and not read.
export function readExtractionFiles(stagingPath: string, plan: ExtractionPlan): Result<Record<number, ChunkText>> {
  const root = stagingRoot(stagingPath);
  if (!root.ok) return root;
  const result: Record<number, ChunkText> = {};
  const missingAll = (): Result<Record<number, ChunkText>> => {
    for (const chunk of plan.chunks) result[chunk.n] = { problem: 'missing' };
    return ok(result);
  };
  const corpus = join(root.value, KNOWLEDGE_DIR);
  const out = join(corpus, EXTRACTION_DIR_NAME);
  try {
    for (const dir of [corpus, out]) {
      const stat = lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return missingAll();
    }
  } catch {
    return missingAll();
  }
  for (const chunk of plan.chunks) {
    const file = join(corpus, chunk.output);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile()) {
        result[chunk.n] = { problem: 'missing' };
      } else if (stat.size > CHUNK_LIMITS.maxOutputBytes) {
        result[chunk.n] = { problem: 'too-large' };
      } else {
        result[chunk.n] = { text: readFileSync(file, 'utf8') };
      }
    } catch (e) {
      result[chunk.n] = { problem: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' };
    }
  }
  return ok(result);
}
