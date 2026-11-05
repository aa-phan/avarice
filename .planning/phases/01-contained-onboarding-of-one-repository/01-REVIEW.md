---
phase: 01-contained-onboarding-of-one-repository
reviewed: 2026-11-04T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - scripts/assert-exit.ts
  - src/app/invocation.ts
  - src/app/stages/index-knowledge.ts
  - test/fault/budgets.test.ts
  - test/fault/killpoints.test.ts
  - test/unit/checkout-digest.test.ts
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-04
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Incremental review of `git diff fb229cf..HEAD` for the six files touched by the fixes for the prior findings WR-01, WR-02 and WR-03. This review supersedes the earlier one. The fixes were checked against the code that calls and is called by them, not only against the diffs.

**WR-01 (resolved).** `prepareInvocation` now computes the scope before `reserveInvocation`. I confirmed that this reordering changes nothing recorded.
- `computeInvocationScope` is pure. It takes no `deps`, ids or clock, and it neither writes nor appends events. Running it earlier therefore changes no ledger row, event or id order.
- The only visible change is for a run that has both a bad work root and an exhausted budget. It now gets a typed `invalid` error instead of `granted: false` and a `blocked` transition. That is the right precedence, because a configuration fault should not be reported as budget exhaustion.
- A throw from the scope can no longer leave an unsettled reservation, because nothing has been reserved by then.
- The `ensureDir` side effect still runs before the refusal. It is idempotent and holds no budget.
- The `planExtractionChunks` guard turns a throw into an absent index (`invocation-failed`) instead of a crash.
- The new budgets test covers four bad roots. It asserts the budget rows are unchanged and that no `launch:map` step was recorded.

**WR-02 (resolved).** `judgeExit` now rejects non-integer and negative counters, `documentsExpected < 1`, and `unread > documentsExpected`.
- The branches are ordered so that the malformed check runs before the comparison. A fractional or negative value therefore never reaches the `>` comparison.
- The error messages interpolate only numbers.
- The unit cases assert the exit code, the message, and the absence of the old "no document node" message. Positive controls with coherent shapes are included.

**WR-03 (resolved).** `chunkPlanNormalized` no longer swallows errors. All three call sites (killpoints lines 151, 178 and 269) run through `outcomeOf` on a finished onboarding. A missing or unparseable plan now fails loudly, so the null-equals-null vacuity is gone.

No new critical or warning defects were found. There are three new minor items (IN-04 to IN-06). IN-01 to IN-03 are carried forward unchanged; the fixes did not touch the code they cite.

## Info

### IN-01: Pre-clustering chunk-usable gate is redundant with the per-document gate and gives a less accurate message

**File:** `src/app/stages/index-knowledge.ts:190-194`
**Issue:** The `half = ceil(chunks/2)` gate on usable chunks is still enforced. The comment two lines above says a usable chunk says nothing about coverage, and coverage is judged per document. The chunk gate is a second, coarser 50% threshold with a different failure message. The two thresholds can disagree and confuse an operator. Keeping it as a cheap early exit is defensible.
**Fix:** Keep only the `present === 0` (`no-output`) check and let `validateKnowledgeGraph` decide, or document why both gates exist.

### IN-02: Work-root and corpus-root validators are duplicated

**File:** `src/domain/invocation-scope.ts:212-222` and `src/domain/knowledge-extraction.ts:74-84`
**Issue:** `checkedWorkRoot` and `checkedCorpusRoot` are the same algorithm. They differ only in the error prefix and in how they trim trailing slashes: one calls `trimTrailingSlashes`, the other uses an inline regexp. The two copies can drift if one is later hardened against NUL bytes or backslashes.
**Fix:** Extract one `normalizedAbsoluteRoot(value, label)` helper into a small domain module and call it from both.

### IN-03: The model still builds the path of the plan file itself

**File:** `src/domain/knowledge-extraction.ts:141`
**Issue:** The prompt tells the model to build the first read path (`.chunks.json`) as "your working directory, then /.chunks.json". It is the one remaining path the model composes itself, and a slip there yields zero output. The composition is simpler than in the document case and probably safe.
**Fix:** If a live run ever fails on this read, use a relative `Read` of `.chunks.json`, or supply the absolute plan path outside the prompt. The `T-01-88` test forbids the prompt from naming the root, so this needs a design decision.

### IN-04: The new catch blocks are broader than the condition they name, and one of them is unreachable and untested

**File:** `src/app/invocation.ts:96-98` and `src/app/stages/index-knowledge.ts:143-147`
**Issue:** Both `catch (cause)` blocks convert any throw into a domain result.
- In `prepareInvocation`, every throw from `computeInvocationScope` becomes `{ kind: 'invalid', field: 'workRoot' }`. Today the work-root check is the only throw in that function. A later defect inside it, such as a `TypeError` from a malformed contract, would be misreported as a work-root problem and hidden from stack-trace tooling.
- In `runKnowledgeStep`, any throw from `planExtractionChunks` becomes a silently absent knowledge index. The staging path that feeds `corpusRoot` is a realpath, so the guard cannot fire in practice. The fix report says it has no test. A real defect in the planner would degrade to a quiet absent index and not show up as a crash.

**Fix:** Narrow the catch to the intended failure. For example, export a small `RootRefusedError` or check `cause instanceof TypeError && /workRoot must be/.test(cause.message)` and rethrow everything else. Alternatively, have the domain functions return a `Result` and drop the catch. Add a unit test that passes a non-normalized staging path to `runKnowledgeStep`, or document the guard as defence in depth.

### IN-05: The exit gate does not tie `documentNodes` to the document accounting

**File:** `scripts/assert-exit.ts:126-136`
**Issue:** After the WR-02 fix, `documentsExpected` and `dropped.unread` are checked against each other. They are still not checked against `documentNodes` or `nodes.document`. In the pipeline, every covered document is cited by at least one document node, so `documentNodes >= documentsExpected - unread` should always hold. A record with `documentsExpected: 25`, `unread: 0` and `documentNodes: 1` passes the gate. This is the residual part of the prior WR-02 concern that "nothing ties `documentsExpected` to `documentNodes`". It is lower severity now, because the counters are no longer independently impossible.
**Fix:** After the consistency branches, add a check such as `f.documentNodes < f.documentsExpected - f.unreadDocuments`, with a message and a unit case. First confirm the invariant against `graph-merge.ts`, since `documentNodes` counts distinct document ids.

### IN-06: The header comment of `invocation.ts` describes the old ordering

**File:** `src/app/invocation.ts:2-5`
**Issue:** The file header says `prepareInvocation` "reserves the invocation's budget, computes the vendor-neutral scope...". The code now computes the scope first and reserves second. The inline comments at lines 78-81 and 101-102 are accurate, but the header is stale.
**Fix:** Reword it to "computes the vendor-neutral scope, reserves the invocation's budget, picks the session ID...".

---

_Reviewed: 2026-11-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
