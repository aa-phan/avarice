---
phase: 01-contained-onboarding-of-one-repository
fixed_at: 2026-11-05T00:00:00Z
review_path: .planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-11-05
**Source review:** .planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (IN-01 to IN-06; fix scope `all`, no critical or warning findings)
- Fixed: 5
- Skipped: 1

**Verification:** `npx tsc -p .`, `node scripts/check-boundaries.ts` and `env -u AVARICE_LIVE npm test` ran in the isolated review-fix worktree, with the main checkout's `node_modules` symlinked in (removed before teardown). Result: 1310 tests, 1288 pass, 0 fail, 22 skipped. The known load-sensitive SIGTERM/SIGKILL flake did not fail in this run. No live or paid run was started (`AVARICE_LIVE` unset). This is a worktree-environment run; re-run the same commands in the main checkout after the fast-forward to reproduce it there.

## Fixed Issues

### IN-06: The header comment of `invocation.ts` describes the old ordering

**Files modified:** `src/app/invocation.ts`
**Commit:** 382bcca
**Applied fix:** Reworded the header to "computes the vendor-neutral scope ..., reserves the invocation's budget, picks the session ID ...", matching the scope-then-reserve order the code has had since WR-01. Comment only, no test.

### IN-02: Work-root and corpus-root validators are duplicated

**Files modified:** `src/domain/normalized-root.ts` (new), `src/domain/invocation-scope.ts`, `src/domain/knowledge-extraction.ts`, `test/unit/normalized-root.test.ts` (new)
**Commit:** 3c7ed2c
**Applied fix:** Extracted `normalizedAbsoluteRoot(value, label)` and the shared `trimTrailingSlashes` into a new domain module that imports nothing (boundary lint passes). Both `checkedWorkRoot` and `checkedCorpusRoot` are gone and both callers pass their own label, so the two error messages are byte-identical to before; the existing WR-01 tests pass unchanged. The helper throws a `RootRefusedError extends TypeError`, which keeps `name === 'TypeError'`. The new unit test pins the accepted forms, the refused forms, the error class and name, and that each caller keeps its own label. The new module and test file are the only new files, both required by the fix.

### IN-04: The new catch blocks are broader than the condition they name

**Files modified:** `src/app/invocation.ts`, `src/app/stages/index-knowledge.ts`, `test/fault/budgets.test.ts`, `test/integration/knowledge-pass.test.ts`
**Commit:** 2f58f10
**Applied fix:** Both catches now convert only a `RootRefusedError` (introduced under IN-02) and rethrow anything else. In `prepareInvocation` a non-refusal throw propagates with its stack instead of being reported as an `invalid` work root. In `runKnowledgeStep` a planner defect propagates to the stage runner, which records it as a `step-error` absent index (never blocking activation) rather than a quiet `invocation-failed`. The comment on the knowledge guard now says it is defence in depth, because staging is a realpath.
Tests: a fault test gives `prepareInvocation` a profile whose scope throws a TypeError that is not the refusal, and asserts that it propagates and that no budget row or launch step changed. An integration test makes the planner throw a TypeError, and asserts `step-error`, no "cannot plan the extraction" text, and no `launch:knowledge` step. Not tested: the `RootRefusedError` branch of the knowledge step. A non-absolute staging path breaks the earlier stages first, so the guard cannot be reached end to end. The root-refusal behaviour itself is covered at the domain level.

### IN-05: The exit gate does not tie `documentNodes` to the document accounting

**Files modified:** `scripts/assert-exit.ts`, `test/unit/checkout-digest.test.ts`
**Commit:** 41bc6b4
**Applied fix:** After the existing consistency branches, `judgeExit` now rejects `documentNodes < documentsExpected - unread`. I chose `>=` rather than equality after reading the code. `documentCoverage` counts a document as covered when at least one pass-origin document node cites it, and `mergeKnowledgeGraph` counts `documentNodes` as distinct document node ids. A covered document can therefore yield several nodes, and a node can cite a path outside the corpus, so the node count can legitimately exceed the covered count but never fall below it. The unread message and the new message are reported independently, so a partial run at the boundary (9 nodes, 25 expected, 16 unread) still gets only the unread message. The header comment was updated.
Tests: two rejecting cases (1 node for 25 covered documents; 8 nodes against 9 covered) and passing shapes (equal, more nodes than documents, and the boundary case with unread documents). The existing WR-02 cases still pass.

### IN-01: Pre-clustering chunk-usable gate is redundant with the per-document gate

**Files modified:** `src/app/stages/index-knowledge.ts`
**Commit:** 089d7c6
**Applied fix:** Took the review's "or document why both gates exist" option and left the gate in place. Removing it would change outcomes: "fewer than half the chunks usable" would no longer be an early `validation-failed` with per-chunk reasons, and the merge and graphify cluster run would be paid for first. It would also make the outcome text in `docs/repository-onboarding.md` (line 111) wrong. The comment now says the per-document check is the authority on coverage, and that the chunk gate is a deliberate coarser early exit and the only source of per-chunk skip reasons. Comment only, no behaviour change, so no new test and no doc change.

## Skipped Issues

### IN-03: The model still builds the path of the plan file itself

**File:** `src/domain/knowledge-extraction.ts:141`
**Reason:** Skipped deliberately. The fix changes the model-facing prompt, or supplies the plan path outside it, and the review itself calls it a design decision. The `T-01-88` test forbids the prompt from naming the corpus root, so the options are a relative `Read` of `.chunks.json` or an out-of-band absolute path. Either one can only be shown to work, or to avoid a regression in the model's behaviour, by a live run, which is not allowed here. The review also says the current composition is probably safe. Revisit if a live run fails on the first read.
**Original issue:** The prompt has the model build the first read path (`.chunks.json`) from its working directory. It is the one remaining path the model composes itself, and a slip there yields zero output.

---

_Fixed: 2026-11-05_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
