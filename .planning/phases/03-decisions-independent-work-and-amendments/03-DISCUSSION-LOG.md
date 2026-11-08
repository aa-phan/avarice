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
