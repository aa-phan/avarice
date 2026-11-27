---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
reviewed: 2026-11-25T00:00:00Z
depth: standard
diff_base: 862b82f
files_reviewed: 4
files_reviewed_list:
  - docs/system/coverage.md
  - docs/system/indexes-and-context.md
  - docs/system/policy-and-approvals.md
  - test/benchmark/phase4/README.md
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
status: issues_found
---

# Phase 4: Code Review Report (gap review 3, plan 04-70)

**Reviewed:** 2026-11-25
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Plan 04-70 is documentation only. The four files changed in 21 lines added and 19 removed since `862b82f`. I read each changed line against the code it describes and against the review records `coverage.md` cites.

The code claims hold:

- `policy-and-approvals.md` steps 6 and 7 match `src/app/authorize.ts:154-162`. An approval already on record is consumed first (`:150-155`). Then `unshowableReason` denies with `UNAPPROVABLE_RULE` and no request. Then the pending-request lookup and `approval-required:` follow.
- The run and attended split for the alias and brace refusals matches the code. A run turns an `unparseable` line into `shell-syntax` with `shellRuleReason` text (`src/domain/hook-decision.ts:820-821`, `src/domain/run-shell-rules.ts:35-36`). An attended session passes the classifier reason through `denyUnparseable` (`src/hook/pre-tool-use.ts:721`).
- The `indexes-and-context.md` anchor `#knowledge-record-fields` resolves (heading at line 212, and `corpusCap` is documented in that table at line 224).
- The `access_revoked` retry-report sentence matches `src/app/context.ts:430-431` and `:470`, except for the edge in IN-02.
- The benchmark README AC-8 bound matches `scripts/eval-retrieval.ts:278-292` (95, inclusive via `<=`) and ADR-016. The task list keeps `maxTokenShare: 0.5`, as the README says. `eval-verdict-adr017.json` exists and is no longer "not yet present".
- All eleven round-4 sha256 digests recorded in `04-69-reviews/README.md` match the current files.
- `git diff 3a6c10c HEAD -- src scripts bin test` is only the benchmark README, so the exception that `coverage.md` line 7 adds is accurate.

No code-versus-document contradiction that misleads a reader was found in the changed lines. One ledger sentence is now stale (WR-01), and five lower-severity points are listed below.

## Warnings

### WR-01: The ledger row for `coverage.md` still says later commits change documents and planning records only

**File:** `docs/system/coverage.md:101`
**Issue:** Line 7 was edited in this plan to say that a later commit (`df3611a`) changed `test/benchmark/phase4/README.md`, a file in the counted `test` tree. The self-referential row in the per-document table was not edited and still reads "counts re-run at `3a6c10c`; later commits change documents and planning records only". The two lines now contradict each other inside the same file. `git diff --stat 3a6c10c HEAD -- src scripts bin test` shows the benchmark README is the one non-document change.
**Fix:** Make the row match line 7, for example: "counts re-run at `3a6c10c`; later commits change documents, planning records and the benchmark notes in `test/benchmark/phase4/README.md` only".

## Info

### IN-01: Benchmark README files table omits `eval-verdict-adr016.json` and calls the amendment unapproved

**File:** `test/benchmark/phase4/README.md:9-14`
**Issue:** The table lists `eval-verdict-adr017.json` but not `eval-verdict-adr016.json`, which exists in the directory. The record is the ADR-016 re-judgement that `scripts/eval-retrieval.ts:399` writes. The new AC-8 bullet at line 53 cites ADR-016 as the bound in force. The row for `eval-success-amendment.json` says `approvedBy` and `approvedAt` are "both `null` until the owner approves", but the file carries `"approvedBy": "Aaron Phan"` and `"approvedAt": "2026-11-25T05:57:45Z"`. The `eval-verdict-adr017.json` row calls it "the approved amendment", so the two rows read as if they disagree.
**Fix:** Add a row for `eval-verdict-adr016.json`. Reword the amendment row to "with its own `approvedBy` and `approvedAt` (set at approval)".

### IN-02: The retry-report `access_revoked` sentence omits the refused-read path

**File:** `docs/system/indexes-and-context.md:285`
**Issue:** "An item of the earlier pack whose access was revoked is not read, and the report lists it with the reason `access_revoked`" is true for a handle the source's find reports as revoked (`src/app/context.ts:431`). When a source refuses the read as `unauthenticated` or `denied` (`:480-485`), the handles go to `omitted` as `access_revoked` but are not added to `refetch`. A prior item that was picked and could not be reused is listed with its cache-miss reason (`:470`), not `access_revoked`. A reusable prior item is kept. The round-4 group B reviewer recorded this edge as out of scope. The next sentence, "An item of the earlier pack that the retry picks again and cannot reuse is read again", is also not true when the source refuses that read.
**Fix:** Scope the sentence to revocations the find reports, or add one clause: "a read that the source refuses leaves the item out of the pack with the reason `access_revoked` in the omitted list".

### IN-03: "A run denies the line as `shell-syntax`" ignores the run with no shell

**File:** `docs/system/policy-and-approvals.md:122-123`
**Issue:** The two new sentences say a run denies an unreadable line as `shell-syntax`. `decideShell` returns `shell-disabled` before the classifier when `policy.commands.strategy === 'none'` (`src/domain/hook-decision.ts:807`, the knowledge pass). Such a run never reaches the `shell-syntax` rule. The sentence is true for every run that has a shell.
**Fix:** Add "in a run that has a shell", or link the existing run paragraph that already states the rule.

### IN-04: The claim "The rule over-refuses in two places" is known to be wrong and stays in the document

**File:** `docs/system/policy-and-approvals.md:125`
**Issue:** Round 3 recorded this as A-N1 and the owner left it open (`04-69-reviews/README.md`, "Open after round 3"). I re-ran `classifyLine` read-only. `bash {a,b}.sh` is refused (a brace word that forms a shell operand or option), while `bash scripts/{a,b}.sh` is not. The same holds for `su` and `watch`. The text also says words in "the arguments of any other program" are not refused. This is a third over-refusal, so the count of two is wrong. The line is outside the lines this plan changed, and the owner decision applies, so it is not a regression.
**Fix:** Drop the count ("The rule also over-refuses, for example when ...") and add the shell and `su` case.

### IN-05: Per-document rows in `coverage.md` grow without limit, and the round-4 observations are not carried into Outstanding

**File:** `docs/system/coverage.md:82-98`, `:106-107`
**Issue:** Each reviewed row now stacks up to four "Earlier review" histories in one cell. The cells run 2,000 to 4,300 characters, and one sentence runs 190 words. The project rules keep delivery history out of `docs/system/` prose, and the ledger is the one place it is allowed, but the cells are no longer readable. The Outstanding section says "Round 4 recorded no NIT". `04-69-reviews/README.md` also records two out-of-scope observations from round 4 (the hook message wrapping the alias and brace reasons with split-the-command advice, and the refused-read `access_revoked` edge of IN-02). Outstanding mentions only the 04-54 observations, so these two have no owner-visible home in the ledger.
**Fix:** Collapse each row to the current review round plus a pointer to the records. Add one Outstanding bullet naming the two round-4 observations.

---

_Reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
