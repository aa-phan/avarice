---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 39
subsystem: documentation
tags: [docs-system, findings, coverage, prose-review, readme]
requires:
  - phase: 04
    provides: plans 04-37 and 04-38, which drafted the four new and twelve changed docs/system documents and the worklist
provides:
  - "findings.md: 18 lines for the phase's code-versus-proposal differences, 10 older lines closed"
  - "README.md tables list the four new documents, ADR-014 and ADR-015, the ninth flow and the extensions counterpart of doctor"
  - "four review groups passed a fresh prose review (A, B, D, E); 13 documents marked reviewed in coverage.md"
  - "coverage.md recounted at 9bf839d with new rows for profile config keys, credential providers, the action table, the enforcement map and doctor finding areas"
affects: []
actuals:
  tokens: 71000
  tasks: 3
  commits: 22
plan_head_before: 926894558b0f7e7e744a05de1a82f2a30845afa1
plan_head_after: c2132ca4e3a5ae38ecacee46da79b5c10a464f78
tech-stack:
  added: []
  patterns: ["a document is marked reviewed only after its group passed a fresh round, with the round files named in the ledger", "a document edited after a failed budget stays changed after review"]
key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-39-reviews/README.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-39-reviews/round-4-dispositions.md
  modified:
    - docs/system/findings.md
    - docs/system/README.md
    - docs/system/coverage.md
    - docs/system/containment.md
    - docs/system/data-model.md
    - docs/system/integrations.md
    - docs/system/unknowns.md
key-decisions:
  - "Group C was reviewed in four rounds (one beyond the plan's three, by the owner's ruling 'round 4') and still failed; the owner then ruled 'close drafted': the three documents stay changed after review"
  - "The status mark under the titles of the four new documents was removed with the status change; no claim changed, as for autonomy-and-decisions.md earlier"
  - "unknowns.md is recorded as changed after review: a group C fix added one entry to a document that belongs to no review group"
requirements-completed: [ONB-11, ONB-15, FR-3, FR-8, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-22, SEC-1, SEC-2, SEC-3, SEC-4, SEC-6, SEC-7, CON-4, CON-10, CON-11, CON-12, OPS-1, OPS-5, OPS-6, NFR-4]
coverage:
  - id: D1
    description: "findings.md records every code-versus-proposal difference the phase decided or found, and the lines the phase resolved are closed"
    requirement: SEC-6
    verification:
      - kind: other
        ref: "findings.md round 1 to 3 group A reviews checked each line against its cited file:line; group A passed round 3"
        status: pass
    human_judgment: false
  - id: D2
    description: "both README tables list the four new documents and ADR-014 and ADR-015"
    requirement: FR-3
    verification:
      - kind: other
        ref: "group B passed round 2 against the files and the proposals"
        status: pass
    human_judgment: false
  - id: D3
    description: "every new or changed document passed a fresh prose review (success criterion 6)"
    requirement: SEC-6
    verification:
      - kind: other
        ref: "13 documents reviewed in coverage.md; containment.md, data-model.md and integrations.md are changed after review (four failed rounds, owner ruling 'close drafted')"
        status: fail
    human_judgment: true
    rationale: "The owner accepted the open items for group C; the next documentation pass reviews those three documents"
  - id: D4
    description: "the coverage denominators are re-run at the final commit and the documented counts match"
    requirement: NFR-4
    verification:
      - kind: other
        ref: "every command of the Denominators table re-run at 9bf839d; npm run check:boundaries passes (132 files); node --test test/unit/footprint.test.ts passes 32 of 32"
        status: pass
    human_judgment: false
duration: not captured
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 39: Findings, README, reviews and the coverage recount Summary

**Thirteen of the sixteen documents the phase wrote or changed passed a fresh prose review and are marked `reviewed`; `containment.md`, `data-model.md` and `integrations.md` did not pass in four rounds and, by the owner's ruling "close drafted", stay `changed after review`, so success criterion 6 is incomplete for those three.**

## Performance

- **Duration:** not captured (the plan ran over several stages and no start time was recorded)
- **Completed:** 2026-11-22
- **Tasks:** 3 (findings and README; review procedure and rounds; recount and status)
- **Commits before this summary:** 22 on top of `9268945`

## Accomplishments

- **Findings (task 1).** `findings.md` gained 18 lines under "Proposal drift" and one closed limit line: the AC-8 baseline, the evaluation arms, the graph refresh without `graphify update`, the effective pack budget, transcript retention, the concurrent checks default, the event table degradation, artifact eviction, the restricted launch line and end state, derived record incompatibility, the doctor sample output, planning initialization, the missing `export` command, the enforcer vocabulary, adopted provenance and the fixed `files.read`, the scoped map's reads and `git-files` against `Workspace.search`. Nine older lines were closed with "No longer holds at <commit>" and the line that now holds (two adoption lines among them), and the moved-root limit is recorded as closed. Worklist rows `deferred 04-39` and `logged` were closed.
- **README rows (task 1).** Both tables of `docs/system/README.md` list `profiles-and-credentials.md`, `policy-and-approvals.md`, `doctor.md`, `portability.md`, ADR-014 and ADR-015; the `processes.md` row counts nine flows and the `extensions.md` row names `doctor.md` for version compatibility.
- **Reviews (task 2).** Five groups, each reviewed by a fresh `technical-writer:prose-reviewer` per round; every BLOCKER and WARNING was fixed from the code (or answered with code evidence) before the next round. Verdicts below.
- **Recount (task 3).** Every command in the coverage Denominators table was re-run at `9bf839d` (2026-11-22); the Documented table and the per-document statuses follow. Changes are listed below.

## Review rounds per group

| Group | Documents | Rounds and verdicts | Report files |
|---|---|---|---|
| A | `profiles-and-credentials.md`, `policy-and-approvals.md`, `findings.md` | 1 FAIL (0 B, 4 W, 8 N); 2 FAIL (0 B, 1 W, 3 N); 3 PASS (0 B, 0 W, 3 N) | `round-1-A.md`, `round-2-A.md`, `round-3-A.md` |
| B | `doctor.md`, `portability.md`, `overview.md`, `README.md` | 1 FAIL (1 B, 8 W, 9 N); 2 PASS (0 B, 0 W, 2 N) | `round-1-B.md`, `round-2-B.md` |
| C | `containment.md`, `data-model.md`, `integrations.md` | 1 FAIL (0 B, 7 W, 1 N); 2 FAIL (0 B, 1 W, 3 N); 3 FAIL (0 B, 3 W, 2 N); 4 FAIL (0 B, 1 W, 2 N) | `round-1-C.md` to `round-4-C.md` |
| D | `cli-reference.md`, `config-reference.md`, `interactive-shell.md` | 1 FAIL (2 B, 4 W, 4 N); 2 PASS (0 B, 0 W, 2 N) | `round-1-D.md`, `round-2-D.md` |
| E | `indexes-and-context.md`, `onboarding.md`, `runs.md`, `checks-and-evidence.md`, `processes.md` | 1 FAIL (1 B, 3 W, 2 N); 2 PASS (0 B, 0 W, 3 N) | `round-1-E.md`, `round-2-E.md` |

All files are in `04-39-reviews/`, with `README.md` (procedure, digests and the rounds table) and the dispositions `round-1-dispositions.md` to `round-4-dispositions.md`.

## The owner's two rulings

1. **"round 4"** (2026-11-21). Group C was still not clean after the plan's three rounds. The owner allowed one more fix-and-review round for group C only; this is a deviation from the plan's budget of three rounds per group.
2. **"close drafted"** (2026-11-22). Round 4 still failed with one WARNING and two NITs. The owner ruled that the three findings are fixed anyway, verified against the code, but the three documents are not marked reviewed. They are recorded in `coverage.md` as `changed after review`, naming `round-4-C.md` and the reason (review budget exhausted, owner ruling), so the next documentation pass picks them up.

## The three unreviewed group C documents

`containment.md`, `data-model.md` and `integrations.md` are `changed after review`. The three round 4 findings were fixed against the code after the round (`round-4-dispositions.md`) and no fresh reviewer has read the fixes:

- W1, `integrations.md`: the session ID is generated only when the caller gives none; a caller-supplied non-UUID is refused as invalid (now matches `containment.md`).
- N1, `containment.md`: the intel row of the scopes table says "three intel GSD verbs" (`intel validate` writes nothing).
- N2, `data-model.md`: the runtime gate says anything older than 3.44.6 is refused.

Round 4 did not re-verify line by line the event-kind table, the option rules 11 to 13 of the shell identity checks, the proxy IPv6 range list, the git command table rows or the credential-location list; round 3 verified them and their text has not changed.

`unknowns.md` is also recorded as `changed after review`: round 1's group C fix added one entry to it, and it belongs to no review group.

## Deferred NITs

Left unedited so the passing reviews stay valid, and carried to the next documentation pass:

- Group A (round 3): the keychain paragraph of `profiles-and-credentials.md` lost one fact in the Quirks cleanup; several "now at" cites in `findings.md` do not land at HEAD; some `findings.md` entries are very long. Round 2 N3 (module-list openings) was left as written.
- Group B (round 2): `portability.md` should state the executor and store latency ranges the tests configure (5 to 30 ms and 1 to 5 ms); the second NIT (README status in the ledger) is resolved by this plan's status change.
- Group D (round 2): the `cli-reference.md` schedule environment bullet is at the sentence cap; the lease time-to-live is stated in three places.
- Group E (round 2): the project record enumeration in `onboarding.md` and one list item there, and step 2 of the privileged action flow in `processes.md`, are at or over the 35-word cap.
- Group C (round 3 N1, carried): the SQLite version thresholds are listed in both `config-reference.md` and `data-model.md`; `config-reference.md` should link to the data model.
- Found while recounting: `config-reference.md` omits two environment variables the code reads, `XDG_CONFIG_HOME` and `GH_CONFIG_DIR`, which are passed to the vendor CLI that `doctor --online` runs. The ledger records 10 of 12 other variables as documented.

## The recount (coverage.md at `9bf839d`)

| Surface | Before (`187409e`) | Now |
|---|---|---|
| CLI commands | 15 | 20 |
| `AVARICE_*` names | 17 (9 read, 8 constants) | 19 (11 read, 8 constants; 5 set) |
| Other environment variables read | 10 | 12 |
| Profile config keys | 9 | 14 (2 dead) |
| Event kinds | 39 | 50 (counted by a command that excludes action names sharing a prefix) |
| Schema migrations | 3 | 4 |
| Tables | 24 (2 without a writer) | 24 (all with a writer) |
| Ports | 13 files, 12 ports | 15 files, 12 adapter ports with a descriptor |
| External systems | 17 rows | 20 rows (19 used) |
| Diagram sources | 8 | 9 |
| Source lines | 35,093 (180 files) | 46,639 (240 files) |
| Test files | 173 | 239 |
| Import-boundary lint | 99 files | 132 files, passes |

New rows: credential providers (3), action table (22: 3 read, 4 local-write, 15 privileged), enforcement map (18), doctor finding areas (11), ID prefixes (11), and test tooling (live-spend ledgers, the footprint guard, the benchmark inputs). Unchanged and re-run: hook rules 38, onboarding 14 and 29, run lifecycle 11 and 37, blocked reasons 7, step statuses 6, work item states 6, gate rules 6, 8, 3 and 7, index steps 3. The values cross-check with the hand-off of plan 04-38. Its note that the event-kind command over-matches is resolved: the command now excludes the 15 action names and its output equals the data model's kind list. The six worklist rows that were counts for this recount (2, 18, 51, 114, 145, 150) are `closed 04-39`.

## Task Commits

All commits are `docs(04-39)`; the first three are task 1 (findings, README, the enforcement map proof column), the review procedure and rounds follow, and the close-out is:

1. **Round 4 report and the owner's ruling** - `5e47112`
2. **Group C round 4 fixes** - `9bf839d`
3. **Thirteen documents marked reviewed** - `8dbacaf`
4. **Recount and worklist rows** - `32f4c93`
5. **unknowns.md recorded as changed after review** - `c2132ca`

The earlier commits of the plan run from `0469dc6` (findings) to `f20b39e` (round 3 fixes for group C).

## Decisions Made

- The status mark "drafted, not yet reviewed" under the titles of the four new documents was removed with the status change. It is an edit to a reviewed document; no claim changed, so no new review is needed (the same treatment as `autonomy-and-decisions.md` in an earlier phase).
- The ledger names the final code state as `9bf839d`; later commits change documents and planning records only.
- Requirements were marked complete per `requirements.ready-ids` (27 of the plan's 28 IDs; `ONB-6` was not ready).

## Deviations from Plan

**1. [Owner ruling] Fourth review round for group C.** The plan allows three rounds per group; the owner allowed a fourth for group C.

**2. [Owner ruling] Group C closed unreviewed.** The plan's acceptance criterion "every document new or changed in plans 04-37 and 04-38 shows status reviewed" is not met for three documents. See above.

**3. [Rule 1 - Bug] unknowns.md ledger status.** The ledger listed `unknowns.md` as `reviewed` although a round 1 fix had added an entry after its review; corrected to `changed after review`.

## Must-haves

| Must-have | Result |
|---|---|
| Findings for every phase deviation, with `file:line` | Met (18 lines) |
| Resolved findings closed per the file's convention | Met (9 older lines, the moved-root limit) |
| README tables list the four new documents and every changed one; coverage denominators re-run at the final commit with matching documented counts | Met (counts at `9bf839d`; two environment variables are known to be undocumented, recorded in the ledger) |
| Every new or changed document had a fresh review and is marked reviewed only after its group passed, with the files named | Partly met: 13 documents passed and name their round files; `containment.md`, `data-model.md` and `integrations.md` did not pass and are not marked reviewed (honest status, owner ruling) |
| One branch, one pull request, no proposal document edited | Branch state met: the docs diff against the merge base lists only `docs/system/` and ADR-014 and ADR-015. The pull request is not opened by this plan |

Success criterion 6 (every new or changed document passed a fresh review) is incomplete for the three group C documents, and `/gsd-verify-work` will show it.

## Gate

`node --test test/unit/footprint.test.ts` passes (32 of 32) and `npm run check:boundaries` passes (132 files), both after the last change to the code-adjacent files.

## Known Stubs

None.

## Threat Flags

None. No code or surface changed.

## Self-Check: PASSED

The documents and review files named above exist; the commits `5e47112`, `9bf839d`, `8dbacaf`, `32f4c93` and `c2132ca` are ancestors of HEAD.
