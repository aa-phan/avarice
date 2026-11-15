# Milestones

## v1.0 Contained Kernel (Shipped: 2026-11-15)

**Delivered:** AVARICE onboards one existing repository into an active project record, runs one work item unattended inside enforced containment to `ready_for_review` or a decision record, keeps independent work going around an open decision, and resumes the paused session on a validated owner answer or a contract amendment.

**Phases completed:** 3 phases (1 to 3), 134 plans, 294 tasks
**Timeline:** 2026-11-01 to 2026-11-15 (15 days), 1034 commits, `9858bd0` to `71225b0`
**Code:** 180 source files (35,093 lines of TypeScript), 173 test files (67,378 lines)
**Requirements:** 62/62 v1.0 requirements satisfied (14 in phase 1, 35 in phase 2, 13 in phase 3)

**Key accomplishments:**
- `avarice onboard` takes `~/aa-phan-portfolio-v2` to an active, versioned project record with a code-and-document graph (1010 code and 24 document nodes) and intel built at the onboarded revision, survives `kill -9` plus `avarice resume`, and leaves the checkout byte-identical.
- Containment that does not depend on the model: a fail-closed PreToolUse hook with allow-list read confinement, generated settings, `sandbox-exec` for AVARICE's own subprocesses, and an egress proxy that admits only the npm registry. Live suites held against every scripted bypass on each admitted Claude Code version.
- `avarice start --brief b.md --policy routine` compiles a non-widening run contract and drives the real GSD quick unit to `ready_for_review` with evidence, gates and a create-only run branch; three live R1 tasks finished with no human input.
- An SQLite ledger (migrations 0001 to 0003, hash-chained events, fenced leases) that carries onboarding, runs, decisions, budgets and notifications across kills, with resume reaching the same state as an uninterrupted run.
- Decision records opened only on structural pause signals, independent items finishing while dependents wait, `avarice decide` validated for identity, scope, state and duplication and resuming the paused session through `claude -p --resume`, and stale answers re-opened instead of applied.
- `avarice contract amend` records versioned amendments with authorizer, reason and diff and invalidates evidence by change type; local notifications, digest and launchd scheduling never approve anything on silence.

**Closeout:** override closeout.
- Known verification overrides: 14 newly acknowledged, 0 carried forward from a prior close (see STATE.md Deferred Items).
- Phase 1 and phase 2 verifications read `stale` at close (later phases changed files they covered); the owner chose to proceed on the 2026-11-15 milestone audit, which re-checked cross-phase integration (7/7 seams, 3/3 flows, no blockers).
- Audit status `tech_debt`: 17 items, scheduled as Phase 9 (end-of-roadmap cleanup). See `milestones/v1.0-MILESTONE-AUDIT.md`.

**Archive:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`, `milestones/v1.0-quick/`. Phase directories stay in `.planning/phases/`.

---
