// The files behind policy ranks 1 and 4 (SEC-4, D-17). The organization file is read from a path the profile names; the repository's
// `.avarice/policy.json` is read from git objects at the pin, never from the working tree, so an uncommitted edit (or an edit made by a
// run in the user's checkout) cannot change an answer. Both are parsed by `parsePolicyFile` and nothing else produces a file the
// evaluator accepts. The organization file is opened without following a symbolic link and read only when it is a regular file of at
// most 64 KiB. A repository policy must be a regular blob of at most 64 KiB; a symbolic link or submodule entry in its place is refused.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { parsePolicyFile } from '../../domain/policy.ts';
import type { PolicyFile } from '../../domain/policy.ts';
import { runGit } from '../git/safe-git.ts';

export const MAX_POLICY_BYTES = 64 * 1024;
export const REPOSITORY_POLICY_PATH = '.avarice/policy.json';
const FULL_SHA = /^[0-9a-f]{40}$/;

// The organization file. A missing file is `not_found` (the caller passes `'absent'` to the evaluator); a link, a file that is not
// regular, an oversized file, text that is not JSON and a file that does not parse are `invalid`; any other failure to read is `unavailable`.
export function readOrganizationPolicy(path: string): Result<PolicyFile> {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 'ENOENT') return err({ kind: 'not_found', ref: 'the organization policy file' });
    if (code === 'ELOOP') return err({ kind: 'invalid', field: 'organization policy', reason: 'the file is a symbolic link, which is refused' });
    return err({ kind: 'unavailable', cause: `cannot read the organization policy file: ${typeof code === 'string' ? code : 'open failed'}` });
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return err({ kind: 'invalid', field: 'organization policy', reason: 'the file is not a regular file' });
    if (info.size > MAX_POLICY_BYTES) return err({ kind: 'invalid', field: 'organization policy', reason: `the file is larger than ${MAX_POLICY_BYTES} bytes` });
    return parsePolicyFile(readFileSync(fd, 'utf8'), 'organization');
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return err({ kind: 'unavailable', cause: `cannot read the organization policy file: ${typeof code === 'string' ? code : 'read failed'}` });
  } finally {
    closeSync(fd);
  }
}

// The repository's policy at `pin`, a full lowercase commit SHA. `null` when the pinned tree has no such file; `invalid` for a pin that is
// not a SHA, an entry that is not a regular blob, an oversized blob or content that does not parse; `not_found` for a pin the repository
// does not contain.
export function readRepositoryPolicy(repoPath: string, pin: string): Result<PolicyFile | null> {
  if (!FULL_SHA.test(pin)) return err({ kind: 'invalid', field: 'pin', reason: 'a full lowercase commit SHA is required' });
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd: repoPath });
  if (!top.ok) return top;
  const root = top.value.stdout.trim();
  if (!runGit(['cat-file', '-e', `${pin}^{commit}`], { cwd: root }).ok) return err({ kind: 'not_found', ref: pin });
  // `ls-tree` answers with an entry or with nothing, so a path the pin lacks is a plain null.
  const listed = runGit(['ls-tree', '-z', '-l', pin, '--', REPOSITORY_POLICY_PATH], { cwd: root, literalPathspecs: true });
  if (!listed.ok) return listed;
  for (const entry of listed.value.stdout.split('\0')) {
    const match = /^(\d+) (\w+) ([0-9a-f]{40})\s+(\S+)\t(.*)$/s.exec(entry);
    if (match === null || match[5] !== REPOSITORY_POLICY_PATH) continue;
    const [, mode = '', type = '', sha = '', size = ''] = match;
    if (type !== 'blob' || !mode.startsWith('100')) return err({ kind: 'invalid', field: 'repository policy', reason: `${REPOSITORY_POLICY_PATH} is not a regular file in the pinned tree` });
    if (!/^\d+$/.test(size) || Number(size) > MAX_POLICY_BYTES) return err({ kind: 'invalid', field: 'repository policy', reason: `${REPOSITORY_POLICY_PATH} is larger than ${MAX_POLICY_BYTES} bytes` });
    const blob = runGit(['cat-file', 'blob', sha], { cwd: root });
    if (!blob.ok) return blob;
    const parsed = parsePolicyFile(blob.value.stdout, 'repository');
    return parsed.ok ? ok(parsed.value) : parsed;
  }
  return ok(null);
}
