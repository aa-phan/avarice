// Proposal narrowing (docs/repository-onboarding.md "Project record", ONB-9, T-01-22). A repository's
// `.avarice/config.json` (and GSD's documents) may propose values for `paths` and `commands`. At activation each
// proposed value is checked against the profile policy and a proposal can only narrow authority:
//   - paths.protected: every addition is accepted (it only adds protection);
//   - paths.read: accepted when the policy already grants it (a narrower read scope);
//   - paths.write, paths.generated, paths.artifacts: accepted only when covered by what the policy grants,
//     so a policy of none grants none;
//   - commands: accepted only as `inactive` (validating a command is Phase 2); a claim of any other status
//     is rejected as widening;
//   - anything else is rejected (`unknown`, or `unsupported` for keys Phase 2 will add).
// The input is data: it is parsed, never executed, and never mutated. Rejections carry the field, a clipped
// copy of the value and a reason; they become findings on the record. Pure.
import type { RecordPaths } from './project-record.ts';

export interface PolicyPaths {
  paths: RecordPaths;
}

// The profile policy's path grants in Phase 1: read everything, write nothing, protect the AVARICE and CI
// directories. Defaults for every record; later plans read these from the profile.
export const PROFILE_POLICY: PolicyPaths = {
  paths: { read: ['**'], write: [], protected: ['.avarice/**', '.github/**'], generated: [], artifacts: [] },
};

export interface ProposedCommand {
  name: string;
  argv: string[];
  provenance: string;
  status: 'inactive';
}

export interface RejectedProposal {
  field: string;
  value: string;
  reason: 'widens' | 'unknown' | 'invalid' | 'unsupported';
}

export interface NarrowedProposals {
  accepted: { paths: Partial<RecordPaths>; commands: ProposedCommand[] };
  rejected: RejectedProposal[];
}

const PROVENANCE = '.avarice/config.json';
const PATH_FIELDS = ['read', 'write', 'protected', 'generated', 'artifacts'] as const;
const MAX_ENTRY_CHARS = 256;
const MAX_VALUE_CHARS = 120;
const MAX_COMMANDS = 50;
const MAX_ARGV = 64;
const MAX_ARG_CHARS = 1024;
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function clip(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  return text.length <= MAX_VALUE_CHARS ? text : `${text.slice(0, MAX_VALUE_CHARS - 1)}…`;
}

function validGlob(entry: unknown): entry is string {
  return (
    typeof entry === 'string' &&
    entry.length > 0 &&
    entry.length <= MAX_ENTRY_CHARS &&
    !entry.startsWith('/') &&
    !entry.includes('\0') &&
    !entry.includes('\\') &&
    !entry.split('/').includes('..')
  );
}

// `entry` is inside what `granted` allows: equal, under a `dir/**` grant, or anything under `**`.
function covered(granted: readonly string[], entry: string): boolean {
  return granted.some((g) => {
    if (g === entry || g === '**') return true;
    if (!g.endsWith('/**')) return false;
    const dir = g.slice(0, -3);
    return entry === dir || entry.startsWith(`${dir}/`);
  });
}

const dedupe = (values: readonly string[]): string[] => [...new Set(values)];

export function narrowProposals(policy: PolicyPaths, proposal: unknown): NarrowedProposals {
  const accepted: NarrowedProposals['accepted'] = { paths: {}, commands: [] };
  const rejected: RejectedProposal[] = [];
  const reject = (field: string, value: unknown, reason: RejectedProposal['reason']): void => {
    rejected.push({ field, value: clip(value), reason });
  };

  if (!isObject(proposal)) {
    reject('(root)', proposal, 'invalid');
    return { accepted, rejected };
  }

  for (const [key, value] of Object.entries(proposal)) {
    if (key === 'paths') {
      narrowPaths(policy, value, accepted, reject);
    } else if (key === 'commands') {
      narrowCommands(value, accepted, reject);
    } else if (key === 'verificationByChangeType') {
      // Which commands verify which change types is Phase 2 (active command validation).
      reject(key, value, 'unsupported');
    } else {
      reject(key, value, 'unknown');
    }
  }
  return { accepted, rejected };
}

type Reject = (field: string, value: unknown, reason: RejectedProposal['reason']) => void;

function narrowPaths(policy: PolicyPaths, value: unknown, accepted: NarrowedProposals['accepted'], reject: Reject): void {
  if (!isObject(value)) {
    reject('paths', value, 'invalid');
    return;
  }
  for (const [field, entries] of Object.entries(value)) {
    if (!(PATH_FIELDS as readonly string[]).includes(field)) {
      reject(`paths.${field}`, entries, 'unknown');
      continue;
    }
    const name = field as (typeof PATH_FIELDS)[number];
    if (!Array.isArray(entries)) {
      reject(`paths.${name}`, entries, 'invalid');
      continue;
    }
    const kept: string[] = [];
    for (const entry of entries) {
      if (!validGlob(entry)) {
        reject(`paths.${name}`, entry, 'invalid');
      } else if (name === 'protected' || covered(policy.paths[name], entry)) {
        kept.push(entry);
      } else {
        reject(`paths.${name}`, entry, 'widens');
      }
    }
    if (kept.length > 0) accepted.paths[name] = dedupe(kept);
  }
}

function narrowCommands(value: unknown, accepted: NarrowedProposals['accepted'], reject: Reject): void {
  if (!Array.isArray(value)) {
    reject('commands', value, 'invalid');
    return;
  }
  value.forEach((entry, index) => {
    const field = `commands[${index}]`;
    if (index >= MAX_COMMANDS) {
      reject(field, entry, 'invalid');
      return;
    }
    if (!isObject(entry)) {
      reject(field, entry, 'invalid');
      return;
    }
    const { name, argv, status } = entry;
    const argvOk =
      Array.isArray(argv) && argv.length > 0 && argv.length <= MAX_ARGV && argv.every((a) => typeof a === 'string' && a.length <= MAX_ARG_CHARS && !a.includes('\0'));
    if (typeof name !== 'string' || !COMMAND_NAME.test(name) || !argvOk) {
      reject(field, entry, 'invalid');
      return;
    }
    if (status !== undefined && status !== 'inactive') {
      reject(`${field}.status`, status, 'widens');
      return;
    }
    accepted.commands.push({ name, argv: [...(argv as string[])], provenance: PROVENANCE, status: 'inactive' });
  });
}
