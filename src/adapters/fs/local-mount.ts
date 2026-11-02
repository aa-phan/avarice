// Local-mount check for the data root (ADR-003, NFR-5, research assumption A6). SQLite in WAL mode is unsafe on a
// network filesystem, so the data root must sit on a mount that `mount` reports with the `local` flag (macOS).
// Linux `mount` output has no such flag, so there a mount is local unless its type is a known network type.
// This is a heuristic: a FUSE or synced-folder mount can still report `local`; the limit is recorded in A6.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface MountEntry {
  device: string;
  mountPoint: string;
  fstype: string;
  flags: string[];
  local: boolean;
}

const NETWORK_FSTYPES = new Set(['nfs', 'nfs4', 'cifs', 'smbfs', 'smb3', 'afpfs', 'afs', 'webdav', 'davfs', '9p', 'ncpfs', 'ceph', 'glusterfs', 'fuse.sshfs']);

// macOS:  `device on /mount/point (apfs, local, journaled)`
// Linux:  `device on /mount/point type ext4 (rw,relatime)`
const MACOS_LINE = /^(.+?) on (\/.*?) \(([^()]*)\)$/;
const LINUX_LINE = /^(.+?) on (\/.*?) type (\S+) \(([^()]*)\)$/;

function splitList(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

export function parseMountOutput(text: string): MountEntry[] {
  const entries: MountEntry[] = [];
  for (const line of text.split('\n')) {
    const linux = LINUX_LINE.exec(line);
    if (linux) {
      const fstype = linux[3] as string;
      entries.push({ device: linux[1] as string, mountPoint: linux[2] as string, fstype, flags: splitList(linux[4] as string), local: !NETWORK_FSTYPES.has(fstype) });
      continue;
    }
    const macos = MACOS_LINE.exec(line);
    if (macos) {
      const [fstype, ...flags] = splitList(macos[3] as string);
      if (fstype === undefined) continue;
      entries.push({ device: macos[1] as string, mountPoint: macos[2] as string, fstype, flags, local: flags.includes('local') });
    }
  }
  return entries;
}

function within(path: string, mountPoint: string): boolean {
  if (mountPoint === '/') return true;
  const base = mountPoint.replace(/\/+$/, '');
  return path === base || path.startsWith(base + '/');
}

// The entry with the longest mount point that contains `path`.
export function mountFor(entries: readonly MountEntry[], path: string): MountEntry | undefined {
  let best: MountEntry | undefined;
  for (const entry of entries) {
    if (!within(path, entry.mountPoint)) continue;
    if (best === undefined || entry.mountPoint.length > best.mountPoint.length) best = entry;
  }
  return best;
}

const MOUNT_COMMANDS = ['/sbin/mount', '/bin/mount', '/usr/bin/mount'];

// Runs `mount` with no arguments. Cannot tell -> an error, so the caller refuses (fail closed).
export function isLocalMount(path: string): Result<boolean> {
  const command = MOUNT_COMMANDS.find((c) => existsSync(c));
  if (command === undefined) return err({ kind: 'unavailable', cause: 'no mount command found; cannot tell whether the data root is on local storage' });
  let text: string;
  try {
    text = execFileSync(command, [], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot read the mount table: ${e instanceof Error ? e.message : String(e)}` });
  }
  const entry = mountFor(parseMountOutput(text), path);
  if (entry === undefined) return err({ kind: 'unavailable', cause: `no mount entry contains ${path}; cannot tell whether it is local storage` });
  return ok(entry.local);
}
