# Phase 4: Profiles, retrieval budgets, restricted mode and the portability proof - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-15
**Phase:** 04-profiles-retrieval-budgets-restricted-mode-and-the-portability-proof
**Areas discussed:** Phase split and spend, Benchmarks and retrieval eval, Spec-vs-code conflicts, Profiles in practice

---

## Phase split and spend

| Option | Description | Selected |
|--------|-------------|----------|
| One phase, grouped waves | One PR, five workstreams, waves by dependency | ✓ |
| Decimal sub-phases (4.1-4.5) | Each discussed, planned, verified and PR'd separately | |
| Two phases | Split at a seam, adoption/retrieval/eval in 4.1 | |

| Option | Description | Selected |
|--------|-------------|----------|
| 40 USD | Eval ~24, onboardings ~8, live cases ~8 | ✓ |
| 25 USD | As in Phases 2 and 3; smaller eval | |
| 60 USD | Headroom for eval re-runs | |

| Option | Description | Selected |
|--------|-------------|----------|
| Foundations first | Profiles/creds/redaction and ports first | ✓ |
| Risk first | Edge spike and eval design first | |
| You decide | Planner orders by dependency | |

| Option | Description | Selected |
|--------|-------------|----------|
| Carry over Phase 3 stop-loss | D-26..D-39 classification, epochs, resets | ✓ |
| Simpler rule | Ceiling plus stop-and-ask | |

**User's choice:** One phase with grouped waves; 40 USD; foundations first; Phase 3 rules carried over.

---

## Benchmarks and retrieval eval

| Option | Description | Selected |
|--------|-------------|----------|
| Mix: yours + pinned OSS | Portfolio + own repos + pinned OSS; >=1 with GSD artifacts | ✓ |
| Only my own repos | Owner names 5 | |
| Only pinned OSS | Reproducible public set | |

| Option | Description | Selected |
|--------|-------------|----------|
| Eval doc's baseline | GSD map + agent discovery; conflict to findings.md | ✓ |
| Literal full repo | Whole repo in context | |

| Option | Description | Selected |
|--------|-------------|----------|
| Replayed commits, checks judge | 20 mined commits, checks + held-out test, owner spot-check | ✓ |
| Fewer tasks, owner judges | 10 tasks scored by hand | |
| Model judge | LLM grader | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep on unless no gain | ADR either way | ✓ |
| Off unless clear gain | Margin e.g. +2 of 20 | |
| Owner decides after | No pre-set rule | |

| Option | Description | Selected |
|--------|-------------|----------|
| Ship doc values, tune from eval | Illustrative caps as defaults | ✓ |
| Measure first | Derive from eval p95 | |

**User's choice:** All recommended options.

---

## Spec-vs-code conflicts

| Question | Options | Selected |
|----------|---------|----------|
| ONB-6 adoption | Build the spec / Keep regenerating + decision | Build the spec |
| ONB-11 refresh | Keep AVARICE merge, path-scoped extract / Spike graphify update | Keep AVARICE merge |
| Unenforceable host | Refuse + explicit --restricted / Auto-enter restricted | Refuse + --restricted |
| Budget and transcripts | Spec on both / Spec budget, keep transcripts / Keep both | Spec on both |
| Promotion default | none + copy/commit opt-ins / copy | none + opt-ins |

**User's choice:** All recommended options.

---

## Profiles in practice

| Question | Options | Selected |
|----------|---------|----------|
| Profile selection | Repo binding + --profile / --profile only | Repo binding + --profile |
| Enterprise and extended | Fixture org, model only / Defer enterprise beyond config | Fixture org |
| Existing personal-local data | Stays in place / Explicit migrate command | Stays in place |
| v1.0 leftovers (host range, moved-root gap) | Fix both / Only AC-6 gap | Free text (below) |
| Host admission policy | Range + self-check, live suite on minor / Exact list with one-command admit / Keep as is | Range + self-check |

**User's choice:** On the leftovers question the owner asked: "does version admission need to happen for every update? throughout the course of the first three phases multiple incremental versions were admitted, but i doubt the diff is significant". Claude explained the exact allowlist at `src/adapters/host-claude/launch-preflight.ts:24` and why it exists, then offered admission policies; the owner chose a patch range within a verified minor guarded by offline launch probes, with a live T3 run only for a new minor or a failed probe. The moved-root gap is fixed in this phase because AC-6 depends on it.

---

## Claude's Discretion

- Plan and wave breakdown within the five workstreams
- Action classification table and approval command UX
- doctor output, exit codes, --repair scope
- graphify relation-to-edge-rule mapping (spike)
- Full-remap drift threshold value
- Fake-remote port coverage beyond CommandExecutor and ArtifactStore; contract-suite shape
- OPS-5 bound keys and degradation
- Boundary lint for adapter isolation
- Manual-equivalent commands

## Deferred Ideas

None.
