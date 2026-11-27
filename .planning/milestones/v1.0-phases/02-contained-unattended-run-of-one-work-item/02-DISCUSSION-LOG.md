# Phase 2: Contained unattended run of one work item - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-04
**Phase:** 02-contained-unattended-run-of-one-work-item
**Areas discussed:** Run workspace & hand-off, Benchmark target & tasks, Required checks, Routine budgets & spend

---

## Run workspace & hand-off

**Workspace**

| Option | Description | Selected |
|--------|-------------|----------|
| Local clone | Same as onboarding (S0-B); the source .git is never in the sandbox | ✓ |
| Linked worktree + denyWrite | Spec wording; shared objects; reopens the S0-B risk surface | |
| You decide | Research picks under the S0-B constraint | |

**Hand-off of the ready_for_review result**

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch branch into source | Local branch avarice/run_<id> in the source repo, never checked out | ✓ |
| Stay in the clone | Source never written; status prints the clone path | |
| Patch/bundle artifact | Bundle or format-patch in the content store | |

**Who commits (host limitation 8)**

| Option | Description | Selected |
|--------|-------------|----------|
| Supervisor commits | After G2, outside the invocation; the model never writes git metadata | ✓ |
| Spike first, then decide | GSD commits if the sandbox allows it | |
| GSD commits in-sandbox | Required; a limitation-8 failure is a blocker | |

**Base revision**

| Option | Description | Selected |
|--------|-------------|----------|
| Record pin; refuse if stale | Indexes match code; refuse and ask for a re-onboard | ✓ |
| Current source HEAD | Record the gap in the contract | |
| Brief names it explicitly | Pin is only the default | |

---

## Benchmark target & tasks

| Question | Options | Selected |
|----------|---------|----------|
| Target repo | aa-phan-portfolio-v2 / AVARICE itself / Portfolio + one other | aa-phan-portfolio-v2 |
| Briefs | Claude drafts, you approve / You supply them / Replay real history | Claude drafts, you approve |
| Exit shape | Same as Phase 1 (offline, scratch live, then portfolio) / Straight to portfolio | Same as Phase 1 |
| Pass bar | 3/3 one run each / 3/3 re-run allowed / 3/3 plus your review | 3/3, one run each |

---

## Required checks

| Question | Options | Selected |
|----------|---------|----------|
| Declared at | Commit .avarice/config.json / Profile-side override / Discover from package.json | Commit .avarice/config.json |
| Required set | verify's parts, no e2e / npm run verify as one check / Core four only | verify's parts, no e2e |
| Dependencies | Supervisor npm ci pre-run / Link source node_modules / Offline npm cache only | Supervisor npm ci pre-run |
| Check failing at base | Baseline, judge by delta / Block before starting / Strict: all must pass | Baseline, judge by delta |

---

## Routine budgets & spend

| Question | Options | Selected |
|----------|---------|----------|
| Per-run caps | 60 min / 2.00 / 5.00 USD / 30 min / 1 / 2 USD / 120 min / 5 / 12 USD | 60 min / 2.00 / 5.00 USD (tool calls 400, invocations 3) |
| Model | Sonnet default / Haiku default / Brief must state size | Sonnet default |
| Phase spend ceiling | 25 / 10 / 50 USD | 25 USD |

---

## Claude's Discretion

- Staleness threshold and refusal wording for the record pin
- Fetched branch name and clone cleanup after hand-off
- Mechanism that suppresses the GSD unit's own commits
- Draft `.avarice/config.json` and the three R1 briefs (owner approves)
- Shell internals within ADR-013

## Deferred Ideas

None raised. Not settled here (carried in STATE.md): the Node 26.x support statement, and the `CLAUDE_CONFIG_DIR` split validation.
