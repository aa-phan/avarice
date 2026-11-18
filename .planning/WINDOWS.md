---
schema_version: 1
open_count: 3
waived_count: 0
fixed_count: 2
total_count: 5
last_updated: 2026-11-18T02:18:08.730Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | src/app/stages/index-intel.ts | 12 | index-intel step reports the index absent (not-built-in-this-build) until plan 01-17 | fixed |  | 2026-11-03T01:01:33.235Z | 2026-11-03T03:15:08.594Z |
| 2 | 01 | stub | src/app/stages/index-knowledge.ts | 12 | index-knowledge step reports the index absent (not-built-in-this-build) until plan 01-18 | open |  | 2026-11-03T01:01:33.322Z |  |
| 3 | 02 | stub | src/app/run-stages/item.ts |  | G2 test inventory is passed as empty and the baseline is taken as passed until plan 02-14 measures both | fixed |  | 2026-11-05T22:11:52.151Z | 2026-11-05T23:37:38.835Z |
| 4 | 04 | unrun-verify | scripts/eval-retrieval.ts |  | live driver (runOne, spendStep, the onboarding and start CLI steps, the sandboxed judge on a real repository) is not exercised by plan 04-31: it spends; plan 04-36's pilot is its first run | open |  | 2026-11-17T14:13:13.140Z |  |
| 5 | 04 | unrun-verify | scripts/test-matrix.sh |  | Node 22.22.3 leg of the two-Node matrix not run (no Node 22 binary, AVARICE_NODE22 unset); assumed by the orchestrator, not stated by the owner | open |  | 2026-11-18T02:18:08.730Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "src/app/stages/index-intel.ts",
    "line": 12,
    "description": "index-intel step reports the index absent (not-built-in-this-build) until plan 01-17",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-11-03T01:01:33.235Z",
    "resolved_at": "2026-11-03T03:15:08.594Z",
    "milestone": "v1.0"
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "src/app/stages/index-knowledge.ts",
    "line": 12,
    "description": "index-knowledge step reports the index absent (not-built-in-this-build) until plan 01-18",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-03T01:01:33.322Z",
    "resolved_at": null,
    "milestone": "v1.0"
  },
  {
    "id": 3,
    "kind": "stub",
    "phase": "02",
    "file": "src/app/run-stages/item.ts",
    "line": null,
    "description": "G2 test inventory is passed as empty and the baseline is taken as passed until plan 02-14 measures both",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-11-05T22:11:52.151Z",
    "resolved_at": "2026-11-05T23:37:38.835Z",
    "milestone": "v1.0"
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "scripts/eval-retrieval.ts",
    "line": null,
    "description": "live driver (runOne, spendStep, the onboarding and start CLI steps, the sandboxed judge on a real repository) is not exercised by plan 04-31: it spends; plan 04-36's pilot is its first run",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-17T14:13:13.140Z",
    "resolved_at": null,
    "milestone": "v1.1"
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "scripts/test-matrix.sh",
    "line": null,
    "description": "Node 22.22.3 leg of the two-Node matrix not run (no Node 22 binary, AVARICE_NODE22 unset); assumed by the orchestrator, not stated by the owner",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-18T02:18:08.730Z",
    "resolved_at": null,
    "milestone": "v1.1"
  },
  {
    "id": 6,
    "kind": "flaky-test",
    "phase": "04",
    "file": "test/integration/resource-degradation.test.ts",
    "line": 293,
    "description": "maxConcurrentChecks overlap case asserts c2 starts while c1 runs; under full-suite load c1 can end before c2 starts. Failed once in the wave-13 full run (5079/5157 pass), passed 30/30 alone. Also recurring under load: 'database is locked' in the test rows() helpers of run-start.test.ts and run-baseline-workflow.test.ts (no busy timeout on the test's own reader).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-18T03:05:00.000Z",
    "resolved_at": null,
    "milestone": "v1.1"
  }
]
````
