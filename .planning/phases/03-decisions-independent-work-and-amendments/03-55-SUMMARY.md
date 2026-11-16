---
phase: 03-decisions-independent-work-and-amendments
plan: 55
subsystem: exit-preparation-briefs
tags: [exit, brief-gate, d-30, d-31, d-32, d-34, brief-redraft, dry-run, supersede]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-52 brief-check --all and brief-gate (D-31)
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-54 default evidence file 03-57-evidence-exit.json and the verdict and supplement subcommands
provides:
  - "run 1 redrafted under D-32: item C shows copyFallback(email) in the Contact section and touches nothing a protected spec asserts"
  - "03-55-brief-classification.json: all 148 findings of an uncapped check of the three briefs at the pin, each kept, with run 1's surface assessment; brief-gate passes (D-31)"
  - "03-55-dry-run.json: the no-spend dry run with the three new digests"
  - "03-57-evidence-exit.json seeded with exitRules D-26..D-35, no runs and a supersedes block naming old run 1 (D-34)"
  - "03-29, 03-42, 03-45, 03-48 and 03-50 SUMMARYs marked superseded (D-34)"
affects: [03-56, 03-57, 03-58, 03-59, 03-60]

actuals:
  tokens: 60000
  tasks: 2
  commits: 2
plan_head_before: 91ec903769363bd68d50df6961d56f8ad9be69b8
plan_head_after: c956443e0e150179318c2062ed07bec531133794

tech-stack:
  added: []
  patterns:
    - "A classification file is written per finding after reading each line; the generator used to type it lived outside the repository and holds a reading for every finding, not a keep rule"
    - "A test that needs a brief's old needles reads a frozen copy under test/fixtures, not the live brief the exit plans may redraft"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-55-brief-classification.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-55-dry-run.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
    - test/fixtures/exit-gate-run1-brief.md
  modified:
    - test/benchmark/phase3/p3-run1-copy-fallback.md
    - test/unit/exit-drafts.test.ts
    - test/unit/exit-evidence.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-29-SUMMARY.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-42-SUMMARY.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-45-SUMMARY.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-48-SUMMARY.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-50-SUMMARY.md

key-decisions:
  - "Run 1's new surface is a visible paragraph in the Contact section, last child of the section's grid after the links list; a mailto subject or body was rejected because the wording would be the body of an email to the owner and no visitor reads the hand-off in the spec browser"
  - "Run 1 keeps COPY_FALLBACK, COPY_SUCCESS, the toast, the live region and useCopyEmail untouched, so the protected spec at tests/e2e/copy-email.spec.ts:5 holds for either wording"
  - "Runs 2 and 3 pass the D-31 gate unchanged: digests f0c9395b... and fe8742f4... are those of plan 03-49"
  - "The old halted SUMMARYs change only their status line (plus added superseded_by, superseded_note and one appended section)"

requirements-completed: [AUT-1, AUT-2, AUT-3]

duration: about 1h 15min
completed: 2026-11-10
status: complete

coverage:
  - id: D1
    description: "Run 1 is redrafted: expectedDecisions 1, one decision:fallback-wording criterion in item B, item A independent, item C depending on B; it compiles against the conventions at 9f63d91 with every Write entry inside src/**, tests/unit/** and none protected"
    requirement: AUT-1
    verification:
      - kind: unit
        ref: "test/unit/exit-drafts.test.ts#the three Phase 3 exit briefs (plan 03-28, D-02 to D-04)"
        status: pass
    human_judgment: true
    rationale: "Whether the Contact paragraph is a good surface for the planted wording is the owner's call at the D-04 checkpoint (plan 03-56)"
  - id: D2
    description: "Every finding of an uncapped brief-check of the three briefs at the pin is classified kept or changed with assertedAt and a reason, and brief-gate passes"
    requirement: AUT-2
    verification:
      - kind: command
        ref: "node scripts/exit-run-phase3-tools.ts brief-gate --classification .planning/phases/03-decisions-independent-work-and-amendments/03-55-brief-classification.json --source ~/aa-phan-portfolio-v2 -> brief-gate: pass: 148 finding(s) classified in 3 brief(s); repository unchanged"
        status: pass
    human_judgment: true
    rationale: "The owner reviews the classification file at the D-04 checkpoint; the gate checks completeness and placement, not the judgment that each line is kept"
  - id: D3
    description: "The dry run records three compiled briefs, 0 USD, no host launched, promptScope 0 and only write-set problems; exit-drafts reads it"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-drafts.test.ts#the recorded dry run (03-55-dry-run.json) names the digest of each brief file as it is now"
        status: pass
      - kind: command
        ref: "the plan's node -e check over 03-55-dry-run.json -> dry-run-ok"
        status: pass
    human_judgment: false
  - id: D4
    description: "The five halted SUMMARYs read status: superseded with superseded_by and the appended section, every original line is as at 4525c27 except the status line, and phase-plan-index reports none halted"
    requirement: AUT-3
    verification:
      - kind: command
        ref: "the plan's byte-identity node -e check (run against copies of the 4525c27 files) -> summaries-ok; phase-plan-index -> index-ok, no halted plan"
        status: pass
    human_judgment: false
  - id: D5
    description: "03-57-evidence-exit.json is seeded with exitRules D-26..D-35, runs [] and the supersedes block naming run_01M73RX3RF0ZJETYWVF52WFZ5B; the offline exit suite passes"
    requirement: AUT-3
    verification:
      - kind: command
        ref: "the plan's evidence-file node -e check -> evidence-ok"
        status: pass
      - kind: integration
        ref: "test/integration/phase3-exit-offline.test.ts (10 tests)"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 55: The replanned exit's preparation Summary

**Run 1's item C now shows `copyFallback(email)` in a paragraph in the Contact section and leaves the toast, the live region and both constants alone, so no protected spec is touched; all 148 findings of the three briefs at the pin are classified and pass the D-31 gate, the dry run is recorded at 0 USD, the five halted exit SUMMARYs are superseded, and the replanned exit's evidence file is seeded.**

## Performance

- **Duration:** about 1 h 15 min
- **Tasks:** 2 of 2 (Task 1 a tracer, Task 2 auto)
- **Files:** 8 modified or created in the repository's tracked tree (plus the three records and the fixture)
- **No file under `src/` of AVARICE changed; no live run, no spend, no call to the Claude host; the portfolio was read through git objects only and its checkout was equal before and after (the brief-check, the gate and the dry run each compare it: `portfolio unchanged`, `repository unchanged`, `portfolio before and after: equal`).**

## Accomplishments

- **Task 1 (tracer).** Run 1 redrafted; uncapped `brief-check --all` of the three briefs; `03-55-brief-classification.json` written from that report; `brief-gate` passes; the dry run recorded in `03-55-dry-run.json`; `test/unit/exit-drafts.test.ts` reads it and names the file item C creates; `03-57-evidence-exit.json` seeded. The tracer's four verifies re-ran green before Task 2 started (`⚡ Tracer verified end-to-end — expanding`).
- **Task 2.** The five SUMMARYs superseded; the offline exit suite (10 of 10) passes against the code of plans 03-51 to 03-54.

## Run 1's new item C, verbatim

Item C of `test/benchmark/phase3/p3-run1-copy-fallback.md` (title `Show copyFallback in src/sections/Contact/Contact.tsx`, depends on B, small, acceptance AC4):

> Item C: the Contact section shows the wording item B chose, so a visitor sees it on the page. In `src/sections/Contact/Contact.tsx`, import `copyFallback` from `@/lib/copy` and add one paragraph, in the muted small text style the hero facts use, as the last child of the section's grid element, after the links list, so the copy button and the links keep their row. The paragraph renders `copyFallback(email)` with the section's own email prop. It has no role and no aria-live attribute, so it is not a second status region. Add `tests/unit/contact-fallback.test.tsx` with a test named `contact shows the copy fallback` that renders the section with an address and finds `copyFallback(address)` in it. Nothing else changes: `COPY_FALLBACK` and `COPY_SUCCESS` stay exactly as they are, the toast, the live-region text and `useCopyEmail` are not touched, and the copy button keeps its accessible name and its markup.

AC4: *the Contact section renders copyFallback(email) in a paragraph with no status role, COPY_FALLBACK and COPY_SUCCESS are unchanged, and the change typechecks and lints clean | verifiedBy: check:typecheck, check:lint, check:test, test:contact shows the copy fallback.*

The Write list is now `src/lib/dates.ts`, `tests/unit/dates.test.ts`, `src/lib/copy.ts`, `tests/unit/copy.test.ts`, `src/sections/Contact/Contact.tsx` and `tests/unit/contact-fallback.test.tsx` (created by the run); `src/components/ui/useCopyEmail.ts` left the list. Items A and B and AC1 to AC3 keep their text except the one sentence recorded under Deviations.

## The surface assessment (run 1)

The planted wording must be visible to a visitor, and the protected spec `tests/e2e/copy-email.spec.ts:5` asserts the toast and status text equal `COPY_FALLBACK`'s value, so the toast cannot carry the new wording. Two surfaces were read at the pin:

- **A visible paragraph in the Contact section (chosen).** It is in no spec's text, role or selector set. Greps over `tests` at 9f1cd8d (twelve, with their hits recorded in the `assessment.greps` of the classification file):
  - the wording of both options and their fragments: only the two old-wording lines `tests/e2e/copy-email.spec.ts:5` and `tests/unit/copy.test.ts:69` (the constant's value, unchanged);
  - the wording of either option with the address: no hit;
  - the Contact section's selectors and lead line: `#contact`, `.contact-address`, `#contact-heading` and the substring `The fastest way to reach me is email.` (the new paragraph does not contain it);
  - the status role: five `getByRole('status')` assertions that expect the one Toast live region (`src/components/ui/Toast.tsx:43`); the new paragraph has no role;
  - text queries on the address, paragraph queries, unit tests that mention Contact (none render it), tests of the hook or `copyFallback` (none), and full-text comparisons of main (`wordmark.spec.ts:148` compares light and dark, and the line is identical in both).
- **The mailto hand-off (rejected).** The wording would be the subject or body of an email to the owner, which reads wrongly, and the spec browser treats the hand-off as a no-op.

Conclusions: option 1 (`Couldn’t copy. Email me at <address>.`) and option 2 (`Couldn’t copy the address. Opening your mail app to <address>.`) each collide with 0 protected specs and 0 unit tests. Option 2 shares a prefix with `COPY_FALLBACK`'s value but the specs match the whole value and the visual toast through an `aria-hidden` element; the new paragraph is neither.

Placement note for the owner: the paragraph goes after the links list so the copy button and the links keep their row in the grid (an earlier position would push the list to a second row on desktop).

## Classification counts per brief

Uncapped `brief-check --all` at pin 9f1cd8d, conventions 9f63d91:

| Brief | Findings | kept | changed | Protected or outside the conventions (listed as problems by the tool) |
|---|---|---|---|---|
| run 1 (`p3-run1-copy-fallback`) | 15 | 15 | 0 | 4 (all protected specs asserting COPY_FALLBACK's or COPY_SUCCESS's value) |
| run 2 (`p3-run2-graduation-label`) | 4 | 4 | 0 | 0 |
| run 3 (`p3-run3-theme-toggle`) | 129 | 129 | 0 | 73 (specs and scripts that keep `data-theme`, `aria-pressed` and the name `Dark theme`, plus 404.html and index.html) |
| total | 148 | 148 | 0 | 77 |

Every finding was read (its `text` printed and the reason typed per needle, path and line pattern, then the generated reasons read back before the gate ran). `brief-gate` prints `brief-gate: pass: 148 finding(s) classified in 3 brief(s); repository unchanged`. The earlier capped check hid 56 of run 3's `data-theme` lines; the uncapped check lists them, and all assert the attribute name and light/dark values that item A keeps.

## Changes to run 2 and run 3

None. Both pass the D-31 gate as plan 03-49 left them.

## The three digests and the dry run

| Brief | Digest |
|---|---|
| run 1 (redrafted) | `sha256:2183c31788bce25a7b14e5b961e6ec3518c50b6a5f0b4240151ae54bdd4eeb55` (was `sha256:1a30e04c...`) |
| run 2 | `sha256:f0c9395bc0fddda5ef7e3b7c0844c5f0ae38444a9b8a27a4f4f716694abc7823` (unchanged) |
| run 3 | `sha256:fe8742f43a9b1bfd2a01c8f1fbce1e6bccfa361807ae38b0906b20133f4052bd` (unchanged) |

Dry run (`EXIT_DRY_RUN_OUT=...03-55-dry-run.json bash scripts/exit-run-phase3.sh --dry-run`): exit 1 as designed, `51 problem(s), 44 warning(s); spent 0 USD`. All three briefs compiled; preflight, staleness (HEAD descends from the pin, 0 commits past it outside `.avarice/` and `.planning/`) and conventions (revision 9f63d91, checks digest equal to the draft's, 13 checks) ok; prompt scope 0 for every item; the 51 problems are all write-set findings (4 for run 1, 0 for run 2, 47 for run 3); `modelHostLaunched: false`. Run 1's item files are A `src/lib/dates.ts`, B `src/lib/copy.ts`, C `src/sections/Contact/Contact.tsx`; the planted item and the independent item share none. Budgets as before: 10 USD per run at the routine cap, and the dry run's own advice that three routine caps do not fit the 13.7014 USD headroom (the owner's 4.50 USD per-run cap, D-33, is applied at the authorization in plan 03-56).

## Evidence file

`03-57-evidence-exit.json`: `schema 1`, `plan "03-55"`, `exitRules "D-26..D-35"`, `decision "D-26 to D-35"`, `runs []`, and `supersedes { runId: run_01M73RX3RF0ZJETYWVF52WFZ5B, evidenceFile: 03-48-evidence-exit.json, reason }`. Per plan 03-52 and the existing `supersededRunRefusal`, `authorize` refuses every start until the owner has cancelled that run in their own terminal; this plan did not cancel it and ran no `avarice` command on any portfolio run.

## What plan 03-56 needs from this plan

- The owner reviews the redrafted run 1 and `03-55-brief-classification.json`, then `write-authorization` (plan 03-52) writes the authorization from the gated classification. 03-54's guidance applies: the real authorization names run 3's expectation `silence` and run 2's `amend-stale`, with the order 2, 3, 1.
- The owner cancels old run 1 first (D-34), so `authorize` stops refusing on the `supersedes` block.
- Run 1's item C is a design choice the owner may want to see once: the paragraph shows the fallback wording permanently under the copy controls, which is how a planted wording becomes visible without touching the toast. If the owner prefers another surface, the brief changes and the classification and dry run repeat.

## Deviations from Plan

**1. [Rule 1 - Bug] Item B's first sentence contradicted item C**
- **Found during:** Task 1, redrafting
- **Issue:** The kept sentence "when copying the email fails, the toast must name the address so a visitor can copy it by hand" told the run to put the address in the toast, while the new item C says the toast keeps its text. A brief that contradicts itself is the kind of brief defect this plan exists to remove.
- **Fix:** Changed that one sentence to "when copying the email fails, the wording a visitor reads must name the address so they can copy it by hand. B only adds the wording function; item C shows it, and the toast keeps its text." The two options, "stop and ask which one before writing it", "Keep `COPY_FALLBACK` exported and unchanged in this item", item A and AC1 to AC3 are unchanged.
- **Files modified:** `test/benchmark/phase3/p3-run1-copy-fallback.md`
- **Commit:** 4afbb0e

**2. [Rule 3 - Blocking] The D-31 gate cases of `exit-evidence.test.ts` read the live run 1 brief**
- **Found during:** Task 1, running the wider suite after the redraft (`node --test test/unit/exit-evidence.test.ts`: 7 failures)
- **Issue:** `makeExitFixture` in `test/unit/exit-evidence.test.ts` builds its temporary repository around the old run 1 brief and expects exactly three findings. The redraft changed the needles (`COPY_SUCCESS`, `useCopyEmail`), so seven gate cases failed. The plan's `files_modified` did not list the file.
- **Fix:** Froze the earlier brief text as `test/fixtures/exit-gate-run1-brief.md` (a verbatim copy of the file at HEAD before this plan) and pointed the fixture at it, with a comment saying why. No assertion changed.
- **Files modified:** `test/unit/exit-evidence.test.ts`, `test/fixtures/exit-gate-run1-brief.md` (new)
- **Verification:** `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts`: 289 tests, 289 pass.
- **Commit:** 4afbb0e

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** none on scope; the first is a one-sentence consistency edit in a brief the owner approves at D-04, the second is test-fixture hygiene.

Notes, none a deviation: (1) the classification file's per-finding reasons were typed into a helper script kept outside the repository (`/tmp`), not committed; it holds a written reading for every finding and throws on an unread one, and is not a parser that reads "keep" from briefs (D-31); (2) the plan-commit ledger file under the shared git directory could not be written from this checkout (as in plan 03-54), so the base `91ec903769363bd68d50df6961d56f8ad9be69b8` was taken from `git rev-parse HEAD` at start and `commits: 2` is measured as `git rev-list --count 91ec903769363bd68d50df6961d56f8ad9be69b8..HEAD`; (3) the plan's byte-identity check calls `git show` from inside `node -e`, which the sandbox refuses, so it was run against copies of the five files at 4525c27 written with plain `git show` commands; the comparison logic is the plan's; (4) the brief-check and the dry run print the 4 and 47 write-set problems of runs 1 and 3 even though every finding is kept, by design (the tools do not read the classification); (5) the task commit's trailer follows the session's attribution line.

## Known Stubs

None.

## Documentation surfaces for the documentation plan

`docs/system/` exists in this checkout; this plan changes only a benchmark brief, planning records and tests, so no `docs/system/` document describes a behavior it changed. The documentation plan covers the exit tooling from plans 03-51 to 03-54; this plan adds no new surface. No `docs/system/findings.md` line is needed: code and `docs/system/` do not disagree here.

## Threat Flags

None beyond the plan's register. T-03-140 (a brief whose item changes guarded behaviour): item C leaves `COPY_FALLBACK` and the toast alone and the gate fails on any `changed` finding in a protected file (none). T-03-141 (a protected path in a Write list): the compiler accepted all three Write lists, the gate re-checks them, and `grep tests/e2e` over the redrafted brief finds nothing. T-03-142 (the portfolio written): every read was of git objects and the tools report the checkout equal before and after. T-03-143 (a halt record erased): the byte-identity check against 4525c27 passes for all five.

## Self-Check: PASSED

- FOUND: test/benchmark/phase3/p3-run1-copy-fallback.md, test/fixtures/exit-gate-run1-brief.md, 03-55-brief-classification.json, 03-55-dry-run.json, 03-57-evidence-exit.json, the five superseded SUMMARYs
- FOUND commits: 4afbb0e, c956443
- brief-gate pass; exit-drafts and exit-evidence 289 of 289; offline exit suite 10 of 10; typecheck clean
- STATE.md and ROADMAP.md untouched.
