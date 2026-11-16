// The SEC-6 enforcement map as a code table (docs/enterprise-adaptation.md "Enforcement map"): every control, who enforces it, what AVARICE's
// part is, how it can be bypassed, and the test that proves it or the reason none does. Pure data; test/unit/enforcement-map.test.ts holds
// the table to its shape.

export const ENFORCERS = ['host', 'os-sandbox', 'external-platform', 'avarice'] as const;
export type Enforcer = (typeof ENFORCERS)[number];

// A tracked test file that proves the control, or the reason no test does yet.
export type ControlProof = { kind: 'test'; path: string } | { kind: 'unverified'; reason: string };

export interface EnforcementRow {
  id: string;
  control: string;
  enforcer: Enforcer;
  avariceRole: string;
  bypassLimitation: string;
  test: ControlProof;
  // Set on the rows a host limitation (docs/containment.md "Unresolved host limitations", items 3 and 4) leaves open.
  hostLimitation?: 3 | 4;
  // `not-claimed`: no profile claims the `enforced` strength for this row.
  profileStrength?: 'not-claimed';
}

export const ENFORCEMENT_MAP: readonly EnforcementRow[] = [];
