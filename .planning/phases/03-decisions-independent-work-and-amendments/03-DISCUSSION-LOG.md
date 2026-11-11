# Phase 3: Decisions, independent work and amendments - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-08
**Phase:** 3-Decisions, independent work and amendments
**Areas discussed:** Exit benchmark & spend, Work items in the brief, decide & amend, Notifications & check-ins

---

## Exit benchmark & spend

| Question | Options | Selected |
|----------|---------|----------|
| Exit repository | Portfolio at 9f1cd8d / Scratch repo only / Both | Portfolio |
| Provoking a consequential question | Brief-planted ambiguity / Contract `human` class / Both, separate runs | Brief-planted ambiguity |
| Pass bar | 2 runs 2 of 2 / 3 runs 3 of 3 (adds live silence and notifier failure) / 1 run | 3 runs, 3 of 3 |
| Live spend ceiling | 25 USD / 15 USD / 40 USD | 25 USD |

**Notes:** Brief drafting and owner approval follow Phase 2 D-06 (assumed, stated to the user).

---

## Work items in the brief

| Question | Options | Selected |
|----------|---------|----------|
| Item syntax | Items list in frontmatter / Markdown sections / Derived from GSD plan | Items list in frontmatter |
| Spec derivation timing | Two-stage / Before start only / After planning only | Two-stage |
| Routine repair bound | 1 per check / 2 per check / Keep 0 | 1 per check |
| Multi-item budgets | Scale per item / Fixed higher caps / You decide | Scale per item |
| Item to GSD unit | One quick unit per item / One unit for all items | One quick unit per item |
| Item concurrency | Sequential / Parallel independent | Sequential |
| modelBySize | Keep spec map / No haiku | Keep spec map |

---

## decide & amend

| Question | Options | Selected |
|----------|---------|----------|
| decide UX | Option or free text / Options only / Interactive only | Option or free text |
| Identity | OS user + TTY + not in run / Plus confirmation phrase | OS user + TTY + not in run |
| Budget amendments | Yes, new version rows / No, lower only | Yes, new version rows |
| Expansion implied by an answer | Hand off to amend / Apply inline | Hand off to amend |
| Answer pickup | decide starts or nudges / Explicit resume | decide starts or nudges |
| Amend input | Flags + reason / $EDITOR / Both | Flags + reason |
| Shell | Decide action, amend via command line / Both as actions / Neither | Decide action, amend via command line |

---

## Notifications & check-ins

| Question | Options | Selected |
|----------|---------|----------|
| Where notify config lives | Profile config / Contract | Profile config |
| Local notifier | Inbox + macOS banner / Inbox only / Banner + sound for blocking | Inbox + macOS banner |
| Digest | 12:30 and 17:30, opt-in / Morning + evening / No digest yet | 12:30 and 17:30, opt-in |
| Quiet hours and batching | Profile keys with defaults / Batching only | Profile keys with defaults |

---

## Claude's Discretion

Frontmatter field names, the decision-class taxonomy and significance signals, G1 and G3 internals, the invalidation storage form (insert-only), the CON-15 reservation mechanism, ticket revisions in the state digest, the banner retry backoff, the LaunchAgent layout, and multi-item cancellation.

## Deferred Ideas

Parallel item execution; push notifiers and other reply channels (Phase 6); the carried STATE.md items (Node 26.x, the `CLAUDE_CONFIG_DIR` split, backlog 999.4 and 999.5).

---

# Session 2: exit criteria re-discussed

**Date:** 2026-11-10
**Trigger:** plan 03-50 halted by the owner's stop decision after run 1's fifth attempt ended on a brief defect (protected `tests/e2e/copy-email.spec.ts:5`)
**Areas discussed:** Pass bar (D-03), Briefs vs protected paths, Run 1's disposition, Declared non-required checks

---

## Pass bar (D-03)

| Question | Options | Selected |
|----------|---------|----------|
| Cost of an unexpected stop | Classify, then re-run (product: all three; brief: that run) / Keep strict D-03 / Per success criterion | Classify, then re-run |
| Who classifies | Claude proposes, owner rules / Mechanical rule / Owner only | Claude proposes, owner rules |
| Correct stop on a brief defect counts? | No, recorded as evidence / Yes, with a relax record | No, recorded as evidence |
| Stop-loss | Ceiling plus attempt cap (2 more failures of a run) / Ceiling only / Raise the ceiling | Ceiling plus attempt cap |

---

## Briefs vs protected paths

| Question | Options | Selected |
|----------|---------|----------|
| Brief rule | No guarded behavior + hard gate / Rule only, no gate / Allow protected test edits | No guarded behavior + hard gate |
| Run 1 brief fix | Claude redrafts, owner approves / Owner updates the portfolio and moves the pin / Drop item C's text change | Claude redrafts, owner approves |
| Exit target | Keep the portfolio / Move to a controlled repo | Keep the portfolio |
| Gate classification | Reviewed classification file / Teach the tool "keep" / You decide | Reviewed classification file |

**Notes:** Before this area, the protected spec was read at pin `9f1cd8d`. It asserts the fallback toast text itself, so any item C that shows the new wording collides regardless of the option chosen.

---

## Run 1's disposition

| Question | Options | Selected |
|----------|---------|----------|
| Fitting three fresh runs in 13.70 USD | Lower per-run cap to 4.50 / Admit each run only if it fits / Raise the ceiling | Lower per-run cap to 4.50 |
| Run order | Runs 2 and 3 first / Keep 1, 2, 3 | Runs 2 and 3 first |
| Old run 1 and halted plans | Cancel, supersede, keep evidence / Cancel, leave halted | Cancel, supersede, keep evidence |

---

## Declared non-required checks

| Question | Options | Selected |
|----------|---------|----------|
| Phase 3 handling of `test:e2e`-like checks | Say so, don't run / Run once, non-gating / findings.md only | Say so, don't run |

**Notes:** Confirmed in code before asking: `checksToRun` (`src/app/checks.ts:88`) keeps only required and target checks.

## Deferred Ideas (session 2)

Running declared non-required checks as non-gating evidence; a structured `Keep` section read by `brief-check`; letting briefs or amendments write protected test paths.
