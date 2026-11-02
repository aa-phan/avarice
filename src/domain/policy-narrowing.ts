// Proposal narrowing (plan 01-10, ONB-9, T-01-22). STUB for the RED commit; implemented in the GREEN commit.
import type { RecordPaths } from './project-record.ts';

export interface PolicyPaths {
  paths: RecordPaths;
}

export const PROFILE_POLICY: PolicyPaths = { paths: { read: [], write: [], protected: [], generated: [], artifacts: [] } };

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

export function narrowProposals(_policy: PolicyPaths, _proposal: unknown): NarrowedProposals {
  return { accepted: { paths: {}, commands: [] }, rejected: [] };
}
