// Fingerprint of the GSD shim preamble (spike S0-A, 01-RESEARCH "Bash allow-list under dontAsk"). Every GSD workflow
// bash block starts with the same ~2.5 KB first line that locates gsd-tools and defines `gsd_run`. AVARICE's PreToolUse
// hook admits a `gsd_run` read verb only after a command whose first `length` bytes hash to this SHA-256, so the one
// line GSD ships is the identity of "this is GSD's own shim"; a model-written look-alike does not match.
//
// The line is read from the located gsd-core (`workflows/map-codebase.md`, the file the map invocation follows), so a
// GSD whose preamble changed gets its own fingerprint and nothing is trusted that AVARICE did not read from that GSD.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { sha256Hex } from '../../domain/digest.ts';
import type { PreambleFingerprint } from '../host-claude/hook-policy.ts';

const WORKFLOW = join('workflows', 'map-codebase.md');
const PREAMBLE_START = '_GSD_SHIM_NAME=';
const MAX_WORKFLOW_BYTES = 1024 * 1024;

export function fingerprintGsdPreamble(gsdCoreDir: string): Result<PreambleFingerprint> {
  let text: string;
  try {
    const bytes = readFileSync(join(gsdCoreDir, WORKFLOW));
    if (bytes.length > MAX_WORKFLOW_BYTES) return err({ kind: 'invalid', field: 'gsd-preamble', reason: `${WORKFLOW} is larger than ${MAX_WORKFLOW_BYTES} bytes` });
    text = bytes.toString('utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? err({ kind: 'not_found', ref: `gsd-core ${WORKFLOW}` }) : err({ kind: 'internal', cause: `cannot read ${WORKFLOW}: ${code ?? 'unreadable'}` });
  }
  const first = text.split('\n').find((line) => line.startsWith(PREAMBLE_START));
  if (first === undefined) return err({ kind: 'not_found', ref: `the GSD shim preamble in ${WORKFLOW}` });
  const line = first.endsWith('\r') ? first.slice(0, -1) : first;
  return ok({ sha256: sha256Hex(line), length: Buffer.byteLength(line, 'utf8') });
}
