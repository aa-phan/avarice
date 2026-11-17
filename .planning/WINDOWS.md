---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 2
total_count: 4
last_updated: 2026-11-17T14:13:13.140Z
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
  }
]
````
