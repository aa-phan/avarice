# Round 3, group C: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator and given only the document, the code and the house rules. It read the round 2 report only after its own review. Document: checks-and-evidence.md. Working tree at HEAD 13a7267.

---

VERDICT: pass-with-nits. No BLOCKER and no WARNING remains, so no further round is forced. One OBS is left.

Reviewed: /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/checks-and-evidence.md at HEAD 13a7267.
sha256: 7c9c0005eb6960b7bb75833d80d712c1533ead7e33e8ed5993c3ebd00f2a51b8

Severity terms: BLOCKER cannot proceed. WARNING is likely rework and blocks under this gate. OBS is worth noting and does not block.

## Findings

### OBS-1: opening sentence over the cap (confidence medium)
- **Location:** line 3, the second sentence: "This document describes how those commands become evidence and how four gates judge it: the dependency install, the validation of each declared check, ... and gates G1, G2, G3 and G4 with the integrity gates they enforce."
- **Claim:** The sentence runs about 55 words against the 35-word hard cap. It is an enumeration of subjects, so the reference-list carve-out may cover it, but it is prose rather than a list.
- **Evidence:** I measured it with a script that excludes bold markers, code fences, table rows and headings. Every other prose sentence outside lines 1-3 is 35 words or fewer.
- **Fix:** Split after "judge it", or turn the topics into a short list.

No code-behaviour finding.

## Behaviour claims checked against src/ (V = verified)
- V, the changed text: the G1 line, "outside the contract or outside the item's spec files opens a `scope_expansion` decision".
  - `g1Decision` sends both `plan-within-write-scope` and `plan-within-spec` to `g1-scope` (`src/app/run-stages/item.ts:1709-1710`).
  - `g1-scope` classifies as `scope_expansion`, withdraw only (`src/domain/decision-policy.ts:213-214`).
  - The other G1 routes:
    - A checkpoint is `g1-checkpoint`, with plan options (`item.ts:1712-1714`).
    - An owner choice is `g1-owner-choice`, with free text (`item.ts:1716-1723`, `decision-policy.ts:195-196`).
    - An absent plan is a `pause` (`item.ts:1726`).
    - A `pause` becomes class `acceptance` via `humanDecision` (`decision-policy.ts:152-158`, `:189-193`).
  - G1 runs on every unit, a repair included, before G3 and G2 (`item.ts:1385-1403`). It parks the delta and G2 never runs.
- V, the changed text: the repair paragraph (line 237).
  - A scope or deletion failure becomes a run-wide `enforcement_failure` (`item.ts:1540-1547`).
  - Otherwise `blockItem` gets signal `repeated-failure` when `checksOnly || isRepair`, and `pause` (class `acceptance`) when neither holds (`item.ts:1549-1552`).
  - So a non-repair unit with other failures opens `acceptance`. Any other failure of a repair unit opens `repeated_failure`. Checks-only failures that get no repair open `repeated_failure`. All three match the text.
  - `repeated-failure` maps to `repeated_failure` (`decision-policy.ts:215-216`).
- V, when a repair is offered:
  - The conditions are `!g3Failed && checksOnly`, blocking checks all `regressed`, and every blocking check run and failed (`item.ts:1503-1512`).
  - Each check needs fewer repairs than `repairAttemptsPerCheck` (`item.ts:1808-1812`).
  - The invocations budget needs room for one more (`item.ts:1814-1827`). A spent budget calls `blockRun` with signal `budget`, which the document calls a `budget` decision naming `invocations`.
  - Both `repair:reproducer` cases match the code (`item.ts:1519-1536`).
- V, G2 and G3:
  - The three-stage order and the failure naming match: G2 rule names are unprefixed, and a G3 failure adds `G3:<rule>` and `G2:<rule>` (`item.ts:1496-1499`). Both verdicts are stored.
  - The scope and deletion routing matches (`item.ts:1540-1547`).
- V, unchanged text, spot-checked: the PLAN read limit, where a plan over 64 KiB makes the merged plan absent (`item.ts:1600-1605`). I did not re-derive the rest; round 2 verified it and the diff since 3e5e7d6 changes only the two paragraphs above.
- Not re-derived: the baseline and pre-existing rules, the check, install and list environments, the not-run reporting and the records table. These lines are unchanged since round 2, which verified them, and nothing I read in `item.ts` contradicts them.

## Mechanical sweep
- No em dash, en dash or ` -- ` (grep by code point).
- Sentence length: only the opening sentence in OBS-1 exceeds the cap.
- Delivery history: no phase numbers, plan IDs, `src/` paths or `.ts` names after the opening (grep). The opening is the only place that names modules, so the CLAUDE.md rule holds.
- Headings are in sentence case, with no question headings.
- No frontmatter.
- No embedded instructions in the text.
- I did not re-follow the cross-reference anchors this round, because the diff touches none of them. The round 2 reviewer confirmed that they resolve.

## Round 2 report (round-2-C.md), item by item
- W1 (repair-unit route misdescribed, behaviour): **resolved.** Line 237 now limits the `acceptance` route to a unit that is not a repair, and says any other failure of a repair unit opens `repeated_failure`. This matches `item.ts:1549-1552`.
- OBS, G1 text "outside the contract": **resolved.** Line 210 now reads "outside the contract or outside the item's spec files".
- OBS, opening sentence over 35 words (checks-and-evidence.md): **partly resolved.** The first sentence is now 15 words. The second sentence is 55 words, listed above as OBS-1.
- OBS, items on containment.md: out of scope for this document and not assessed.
- Round 1 W2 (the repair-unit route) is also closed by the W1 resolution above.

## Read-only sweep
`git status --short` shows only `?? .planning/milestone.lock`, which was there at the start. I wrote no file. The digest above was recomputed at the end and is unchanged.
