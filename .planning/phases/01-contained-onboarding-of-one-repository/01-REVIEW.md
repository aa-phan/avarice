---
phase: 01-contained-onboarding-of-one-repository
reviewed: 2026-11-04T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - scripts/assert-exit.ts
  - src/app/stages/index-knowledge.ts
  - src/domain/invocation-scope.ts
  - src/domain/knowledge-extraction.ts
  - src/domain/knowledge-validation.ts
  - test/fault/killpoints.test.ts
  - test/helpers/fake-knowledge-host.ts
  - test/integration/claude-host.test.ts
  - test/integration/knowledge-pass.test.ts
  - test/unit/checkout-digest.test.ts
  - test/unit/graph-merge.test.ts
  - test/unit/invocation-scope.test.ts
  - test/unit/knowledge-corpus.test.ts
  - test/unit/knowledge-extraction.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-04
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Incremental review of `git diff 4b57ef8..HEAD` for these files: the G-01-154 gap closure (plans 01-25 and 01-26) and the invocation-scope work-root check (WR-01).

The core change is sound. Per-document coverage is judged on the merged graph (`documentCoverage`) and re-judged after clustering. The verbatim `readPath`/`writePath` values come from a validated corpus root. The `assert-exit` unread gate fails closed when the accounting is absent. I traced `entryFor` in `graph-merge.ts`, the `source_file` rewrite, and the ID-collision path. Coverage counts only nodes that were actually added with the pass origin, as the unit tests claim.

No security defects or data-loss paths were found. The findings are:
- one ordering problem that can leak a budget reservation;
- one gate that trusts self-reported counters;
- one test helper that can make an assertion vacuous.

No `CLAUDE.md` exists in the repository root, so no project conventions were applied beyond the codebase's own patterns.

## Warnings

### WR-01: `computeInvocationScope` can now throw after the invocation has been reserved, leaving an unsettled reservation

**File:** `src/domain/invocation-scope.ts:225` (caller `src/app/invocation.ts:76-95`)
**Issue:** `checkedWorkRoot` now throws a `TypeError` from inside `computeInvocationScope`. In `prepareInvocation`, `reserveInvocation(...)` (units, wall clock and cost) runs first, and `computeInvocationScope` is called only after it. A rejected work root therefore throws after the reservation was taken and before the `launch:*` step is recorded. No code path settles or releases that reservation, and the throw escapes the `Result`-returning stage as an exception. The same applies to `planExtractionChunks(..., join(staging, KNOWLEDGE_DIR))` in `index-knowledge.ts:141`. It throws a `TypeError` that no stage catches, though it runs before the reservation.

`workRoot` is `realpathNearest(resolve(...))` today, so a bad value is unlikely. The check exists to defend against exactly that case, though. When it fires, the onboarding gets a crash and a spent invocation unit instead of a typed `err`.
**Fix:** Validate before reserving, or convert the throw to a `Result` at the boundary. For example, run the work-root check at the top of `prepareInvocation` and return `err({ kind: 'internal', cause: ... })`:
```ts
// src/app/invocation.ts, before reserveInvocation(...)
try { checkedWorkRoot(deps.profile.workRoot); } catch (e) { return err({ kind: 'internal', cause: describeError(e) }); }
```
This needs `checkedWorkRoot` exported. Alternatively, wrap the `computeInvocationScope` call in try/catch and settle the reservation on failure. Do the same for `planExtractionChunks` in `runKnowledgeStep`.

### WR-02: The `assert-exit` unread gate trusts self-reported counters with no consistency check

**File:** `scripts/assert-exit.ts:94-99` and `scripts/assert-exit.ts:124-130`
**Issue:** `finite()` accepts any finite number, including negative and fractional values. `judgeExit` fails only when `unread > 0`.
- A record with `documentsExpected: 0` (or negative) and `unread: 0` passes. Its `documentNodes` is positive, so this is inconsistent: more document nodes than documents expected.
- `unread: -1` passes.
- Nothing ties `documentsExpected` to `documentNodes`, to `nodes.document`, or to `knowledge.corpus`.

The gate's stated purpose is "every corpus document became a document node", yet it never checks that a corpus existed (`documentsExpected >= 1`) or that the numbers are internally possible. A malformed or hand-edited record still passes the exit rehearsal.
**Fix:** Require integers and a coherent shape:
```ts
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
// ...
} else if (f.documentsExpected < 1 || f.unreadDocuments > f.documentsExpected) {
  problems.push(`the knowledge accounting is inconsistent (documentsExpected ${f.documentsExpected}, dropped.unread ${f.unreadDocuments})`);
} else if (f.unreadDocuments > 0) { ... }
```
Add a unit case for each.

### WR-03: `chunkPlanNormalized` swallows every error, so the plan-equality assertions can pass vacuously

**File:** `test/fault/killpoints.test.ts:109-115` (used at lines 133, 183 and 274)
**Issue:** Any read or parse failure returns `null`. The assertions `assert.deepEqual(second.chunkPlan, reference.chunkPlan)` and `assert.deepEqual(outcome.chunkPlan, reference.chunkPlan, ...)` then compare `null` with `null` and pass. This can happen if the plan path changes, if staging is cleaned, or if the run never reaches the knowledge step. The staging digest now excludes `CHUNK_PLAN_FILE` entirely, so the plan has no other coverage in this suite. Silently weakening an assertion in this way is a test-reliability defect.
**Fix:** Do not swallow the error. Let the read/parse throw. At minimum, assert `reference.chunkPlan !== null`, for example `assert.notEqual(reference.chunkPlan, null, 'the reference run wrote a knowledge chunk plan')`. A kill point before the knowledge step legitimately has no plan only if the test says so explicitly.

## Info

### IN-01: Pre-clustering chunk-usable gate is now redundant with the per-document gate and gives a less accurate message

**File:** `src/app/stages/index-knowledge.ts:183-187`
**Issue:** `half = ceil(chunks/2)` of chunks "usable" is still enforced. The comment says a usable chunk says nothing about coverage, and coverage is judged per document. The chunk gate adds a second, coarser 50% threshold with a different failure message and counts documents differently. A run with all documents covered by two of three chunks is rejected on chunk count in some shapes. It is also only an approximation of the per-document rule. Keeping it is defensible as a cheap early exit, but the two thresholds can disagree and confuse an operator.
**Fix:** Keep only the `present === 0` (`no-output`) check and let `validateKnowledgeGraph` decide. Or document why both gates exist.

### IN-02: Work-root and corpus-root validators are duplicated

**File:** `src/domain/invocation-scope.ts:212-222` and `src/domain/knowledge-extraction.ts:73-84`
**Issue:** `checkedWorkRoot` and `checkedCorpusRoot` are the same algorithm (trim trailing slashes, require a leading `/`, refuse `/`, refuse empty, `.` and `..` segments). They differ only in the error prefix. Both are in the domain layer, which may import only relative paths. The two copies can drift, for example if one is later hardened against NUL bytes or backslashes.
**Fix:** Extract one `normalizedAbsoluteRoot(value, label)` helper into a small domain module and call it from both.

### IN-03: The model still builds the path of the plan file itself

**File:** `src/domain/knowledge-extraction.ts:141`
**Issue:** The prompt tells the model to build the first read path (`.chunks.json`) as "your working directory, then /.chunks.json". The G-01-154 root cause was exactly the model composing paths from cwd or staging. The plan read is the one path still composed by the model, and a slip there yields zero output. The cwd is the corpus directory, so the composition is simpler than the document case and probably safe. Still, it is the one remaining place where the "never build a path yourself" rule does not apply.
**Fix:** If a live run ever fails on this read, consider a relative `Read` of `.chunks.json`. Alternatively, put the absolute plan path in a tool-level setting rather than the prompt. The `T-01-88` test forbids the prompt from naming the root, so this would need a design decision.

---

_Reviewed: 2026-11-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
