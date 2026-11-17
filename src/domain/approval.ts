// Parameter-bound approvals (plan 04-16; FR-12, FR-13, FR-15, ADR-005). Skeleton: the behavior arrives with the GREEN commit.
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

export interface ApprovalUsability {
  expiresAt: string;
  revokedAt: string | null;
  consumedAt: string | null;
}

export function paramsDigest(_params: unknown): string {
  throw new Error('not implemented');
}

export function approvalKey(_scope: string, _action: string, _digest: string, _ordinal: number): string {
  throw new Error('not implemented');
}

export function isUsable(_row: ApprovalUsability, _nowMs: number): boolean {
  throw new Error('not implemented');
}

export function paramsSummary(_params: unknown): string {
  throw new Error('not implemented');
}
