// LocalArtifactStore: content-addressed blobs at {dataRoot}/artifacts/{sha[0:2]}/{sha}. A write goes to a
// temporary file in the same directory, is fsynced, then renamed, so a partial write never appears under
// its digest (docs/contracts-and-state.md "ArtifactStore"). put of content that is already stored is a
// no-op. Files are 0600 and directories 0700.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { ArtifactMeta, ArtifactStore } from '../../ports/artifact-store.ts';

// Seams for fault injection in tests; production uses the node:fs functions.
export interface FsOps {
  fsyncSync: (fd: number) => void;
  renameSync: (from: string, to: string) => void;
}

const DIGEST = /^sha256:([0-9a-f]{64})$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function mapFsError(action: string, error: unknown): PortError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOSPC') return { kind: 'unavailable', cause: 'ENOSPC' };
  return { kind: 'internal', cause: `${action}: ${code ?? (error instanceof Error ? error.message : String(error))}` };
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly root: string;
  private readonly ops: FsOps;

  constructor(dataRoot: string, ops: Partial<FsOps> = {}) {
    this.root = join(dataRoot, 'artifacts');
    this.ops = { fsyncSync: ops.fsyncSync ?? fsyncSync, renameSync: ops.renameSync ?? renameSync };
  }

  private pathFor(hex: string): { dir: string; file: string } {
    const dir = join(this.root, hex.slice(0, 2));
    return { dir, file: join(dir, hex) };
  }

  private parse(digest: string): Result<string> {
    const match = DIGEST.exec(digest);
    if (!match) return err({ kind: 'invalid', field: 'digest', reason: 'expected sha256: followed by 64 lowercase hex characters' });
    return ok(match[1] as string);
  }

  put(bytes: Uint8Array, _meta: ArtifactMeta): Result<{ digest: string; size: number }> {
    const hex = sha256Hex(bytes);
    const result = { digest: `sha256:${hex}`, size: bytes.length };
    const { dir, file } = this.pathFor(hex);
    try {
      if (statSync(file).size === bytes.length) return ok(result);
    } catch {
      // Not stored yet.
    }

    const temp = join(dir, `.tmp-${hex.slice(0, 12)}-${process.pid}-${randomUUID()}`);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const fd = openSync(temp, 'wx', 0o600);
      try {
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        this.ops.fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.ops.renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      return err(mapFsError('artifact put', error));
    }
    // Make the rename durable; a failure here cannot undo a published blob, so it is not an error.
    try {
      const dirFd = openSync(dir, 'r');
      try {
        this.ops.fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Best effort.
    }
    return ok(result);
  }

  get(digest: string): Result<Uint8Array> {
    const hex = this.parse(digest);
    if (!hex.ok) return hex;
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.pathFor(hex.value).file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return err({ kind: 'not_found', ref: digest });
      return err(mapFsError('artifact get', error));
    }
    if (sha256Hex(bytes) !== hex.value) return err({ kind: 'internal', cause: `artifact ${digest} is corrupt: content does not match its digest` });
    return ok(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  has(digest: string): Result<boolean> {
    const hex = this.parse(digest);
    if (!hex.ok) return hex;
    try {
      return ok(statSync(this.pathFor(hex.value).file).isFile());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ok(false);
      return err(mapFsError('artifact has', error));
    }
  }
}
