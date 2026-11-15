# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Contained Kernel

**Shipped:** 2026-11-15
**Phases:** 3 | **Plans:** 134 (26, 35, 73) | **Sessions:** not recorded

### What Was Built
- Contained onboarding of one existing repository to an active, versioned project record with a code-and-document graph and intel, surviving a kill and resume (Phase 1)
- A contained, unattended run of one work item to `ready_for_review` or a decision record, behind a fail-closed hook, a sandbox and an egress proxy, surviving a kill at any point (Phase 2)
- Decision records, independent work around an open decision, validated answers resuming the paused session, contract amendments and local notification (Phase 3)

### What Worked
- Live exit runs on a real repository (`~/aa-phan-portfolio-v2`) found defects no offline suite showed: the knowledge agent reading originals instead of copies (G-01-154), a `CLAUDE_CONFIG_DIR` mismatch that lost a session on resume, haiku units declining or slipping on small items
- Mechanical live-spend ceilings that an environment variable can only lower: Phase 3 finished at 16.64 of 25 USD despite several halted plans
- The Phase 3 exit discipline (D-26 to D-39): classify every unexpected stop with evidence, owner rules, a correct stop is evidence and not a pass, two failed attempts stop spending, a proven fix resets the counter
- Fail-closed containment proven on each admitted Claude Code version (2.1.312 to 2.1.319) with 0 containment failures before admission
- `docs/system/` written from the code with fresh-eyes review rounds; contradictions went to `findings.md` instead of edits to the proposals

### What Was Inefficient
- Phase 3 grew from its first plan set to 73 plans; 41 of them (03-34 to 03-74) were gap-closure and exit-repair plans after live runs halted
- Several exit attempts stopped on brief or harness defects rather than product defects (planted ambiguity leaking into the independent item, a brief that changed text a protected file asserted), costing spend and owner checkpoints
- Code-review findings accumulated faster than they were dispositioned: 13 Phase 3 findings are still `open` at the close, and Phase 1 and 2 VERIFICATION.md bodies went stale
- Verifications go stale when later phases touch covered files, which forced an override closeout

### Patterns Established
- Every phase ends with a documentation plan that depends on all others and has each changed `docs/system/` document reviewed by a fresh reviewer
- Live behavior is admitted per host version only after a recorded containment run
- Owner decisions are recorded as numbered D-items in the phase CONTEXT and cited by plans and dispositions
- Exit briefs pass a `brief-check` at the pin before the owner authorizes spend

### Key Lessons
1. Run `brief-check` and an offline parity scenario before any live exit attempt; most wasted live spend came from briefs, not product code.
2. Disposition code-review findings in the phase that raised them; deferring them all to the end makes the milestone close an override.
3. Treat small-item model choice (haiku) as a risk to measure early; it caused the longest halt in Phase 3.
4. Record live-session environment assumptions (config directory, admitted host version) in the run contract, not in the operator's shell.

### Cost Observations
- Model mix: not recorded per session
- Live spend: Phase 1 under a 5.80 USD authorization (0.56 USD cumulative at the last recorded total, 2026-11-03, before the exit rehearsals); Phase 2 under its own 25 USD ledger; Phase 3 16.64 of 25 USD
- Notable: offline suites grew to 4037 tests at the Phase 3 close with 0 failures; the full suite takes about 6 minutes

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | not recorded | 3 | Live exit runs with lower-only spend ceilings and owner-ruled stop classification |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 4037 | not measured (Nyquist-compliant on all 3 phases) | 0 runtime dependencies |

### Top Lessons (Verified Across Milestones)

1. (Fills in after v1.1.)
