---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
reviewed: 2026-11-25T00:00:00Z
depth: standard
diff_base: d10416a
files_reviewed: 58
files_reviewed_list:
  - docs/decisions/ADR-017-ac8-brief-coverage.md
  - docs/operations-and-testing.md
  - docs/system/README.md
  - docs/system/cli-reference.md
  - docs/system/containment.md
  - docs/system/coverage.md
  - docs/system/data-model.md
  - docs/system/diagrams/approve-privileged-action.puml
  - docs/system/findings.md
  - docs/system/indexes-and-context.md
  - docs/system/integrations.md
  - docs/system/policy-and-approvals.md
  - docs/system/processes.md
  - docs/system/profiles-and-credentials.md
  - docs/system/runs.md
  - scripts/eval-retrieval.ts
  - src/adapters/fs/profile-bindings.ts
  - src/adapters/fs/profile-registry.ts
  - src/adapters/git/run-workspace.ts
  - src/app/authorize.ts
  - src/app/context.ts
  - src/app/run-stages/restricted.ts
  - src/domain/approval.ts
  - src/domain/cache-scope.ts
  - src/domain/enforcement-map.ts
  - src/domain/hook-decision.ts
  - src/domain/privileged-commands.ts
  - src/hook/pre-tool-use.ts
  - src/ports/run-workspace.ts
  - test/benchmark/phase4/README.md
  - test/benchmark/phase4/eval-coverage.json
  - test/benchmark/phase4/eval-success-amendment.json
  - test/benchmark/phase4/eval-verdict-adr017.json
  - test/containment/live-run.test.ts
  - test/fault/bindings-race.test.ts
  - test/fixtures/json-shapes/context-active.json
  - test/helpers/bindings-race-child.ts
  - test/helpers/fake-run-host.ts
  - test/helpers/live-phase3-fixtures.ts
  - test/helpers/run-fixtures.ts
  - test/helpers/shell-oracle.ts
  - test/integration/approvals.test.ts
  - test/integration/cache-scope.test.ts
  - test/integration/hook-privileged.test.ts
  - test/integration/hook-retrieval.test.ts
  - test/integration/live-phase3-case-design.test.ts
  - test/integration/resource-degradation.test.ts
  - test/integration/restricted-mode.test.ts
  - test/integration/restricted-onboarding.test.ts
  - test/integration/run-independent-work.test.ts
  - test/integration/run-workspace.test.ts
  - test/unit/approval.test.ts
  - test/unit/enforcement-map.test.ts
  - test/unit/eval-retrieval.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/privileged-commands.test.ts
  - test/unit/profile-bindings-lock.test.ts
  - test/unit/profile-registry.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 04: Code Review Report (second gap closure, plans 04-56 to 04-69, since d10416a)

**Reviewed:** 2026-11-25
**Depth:** standard
**Files Reviewed:** 58 (13 source and script files, 15 documents and benchmark records, 30 test, fixture and helper files)
**Status:** issues_found
**Diff base:** d10416a (incremental; the earlier reviews are 04-REVIEW.md and 04-REVIEW-GAPS.md, with dispositions in 04-REVIEW-DISPOSITION.md and 04-REVIEW-GAPS-DISPOSITION.md, and are not repeated here)

## Summary

I checked every finding of 04-REVIEW-GAPS.md against the code and ran probes to confirm the fixes. No finding is regressed and no critical defect remains.

Verification done:

- **GCR-01 (closed).** `unshowableReason` is applied in all three places a request could be written: the attended hook (`src/hook/pre-tool-use.ts:722-730`), the run hook (`:458-466`) and the gate (`src/app/authorize.ts:157-162`). A `gitOptions` of 81 characters, a secret-shaped `env`, a control character and an over-long `cwd` are all refused with no request, and an exact 80-character value still passes. The 917-character figure in the documents is right (400 + 1 + 516).
- **GWR-01, GWR-03, GIN-02 (closed, with the gaps in IN-01 and IN-02).** About 230 probe lines were run through `classifyLine`. `gh pr -R x/y create`, `gh pr --repo=x/y merge 1`, `gh release -R x create v1`, `git -c alias.p=push p`, `--config-env alias.*`, `GIT_CONFIG_KEY_n`, `find -exec`, `parallel`, `watch`, `su -c`, `trap` and here-strings into a shell are all classified. The here-document double scan (GIN-01) now returns one command per substitution.
- **GWR-02 (closed).** I fuzzed the brace and glob detection against real bash on 6,500 random unquoted words over `{ } , . * ? [ ] - : ^ = @ ' " \`. It found no word that bash expanded and the scanner left unflagged, except the three-word family `x{},}` (a brace group whose first alternative is `}`). That family cannot form a privileged subcommand or program, so it is not reported.
- **GWR-04 (closed).** `excludePaths` uses `:(exclude,literal)` and rejects only empty, absolute, NUL and `..` entries. One residual is in IN-03.
- **GWR-05 (closed).** `lockIsStale` and `readProcessStartMs` are correct. `ps` rounds the elapsed time down, so the estimated start is at most 1 second late, inside the 2-second margin. The lock text stores a time taken before the wait loop, which is never later than the real write, so a live writer is never judged stale.
- **GWR-06, GWR-07, GIN-03, GIN-04, GIN-05 (closed).** The registry denies the whole root of a corrupt config. The race test records overlap and has an unlocked control. The cache format miss is judged between access scope and revision. `launch:` rows are one per attempt, so `launched > finished` correctly catches a retry that started a host and left no `invocation.finished`. The counts in `coverage.md` (48,506 source lines in 240 files; 243 test files: 93 unit, 116 integration, 18 fault, 11 containment, 3 mutation, 2 contract) match `git ls-files`. The four prose-review warnings the owner already holds were not re-reported. Single test files run for `approval`, `privileged-commands`, `profile-bindings-lock` and `profile-registry` all pass (270 tests).

What remains: a benchmark README that contradicts the code and a record it describes, a gap between what `approve` displays and what an approval binds, and four lower-severity items.

## Warnings

### WR-01: The Phase 4 benchmark README says the ADR-017 verdict file is "not yet present" and gives an AC-8 token bound of 50%

**File:** `test/benchmark/phase4/README.md:14,53`
**Issue:** Two claims contradict the code and the records in the same directory.
- Line 14 says of `eval-verdict-adr017.json` "Written by plan 04-65, not yet present." The file is present: commit `745fc2c` (plan 04-65) added it, and it is in this review's scope.
- Line 53 says AC-8 "passes when arm B or arm C has a success rate at least arm A's, at no more than 50% of arm A's total tokens". The code is `AC8_TOKEN_BOUND_PERCENT = 95` (`scripts/eval-retrieval.ts:278`, judged at `:292`). `eval-verdict-adr017.json` records `"boundPercent": 95`, and ADR-016 and ADR-017 both say 95%, inclusive. The 50% is a leftover of the task list's own rule text. This gap closure edited the same README (the Success bullet and the file table) and left both lines as they were. A reader of the README would conclude that the verdict fails (B is at 94.4% of A's tokens) or that it has not been produced.
**Fix:** Change the table row to "The re-judgement of the 18 recorded runs with the coverage record and the approved amendment (plan 04-65)." Change the AC-8 bullet to "at no more than 95% of arm A's total tokens, inclusive (ADR-016)", and add that the task list keeps its original rule text unedited, so the bound in force is the one in ADR-016. Keep the "not edited after approval" statement for `eval-tasks.json`.

### WR-02: `approve` displays a different text from the one the approval binds when a value holds an invisible formatting character (cites GCR-01)

**File:** `src/domain/approval.ts:24-25,108-132` (the gate); `src/cli/render/style.ts:18,21` and `src/cli/commands/approve.ts:88-92` (the display)
**Issue:** The GCR-01 fix refuses a set of parameters when any key or value holds a character in `[\u0000-\u001f\u007f-\u009f]`, so that "what the owner sees" equals "what the digest binds". The display path uses `stripControl`, which also deletes `\u061c`, `\u200b-\u200f`, `\u202a-\u202e`, `\u2060`, `\u2066-\u2069` and `\ufeff` (`INVISIBLE_FORMAT`). `unshowableReason` lets those characters through. I confirmed it: for `{ remote: 'https://github.com/a\u202eb/c', gitOptions: '-c x=\u200by' }`, `unshowableReason` returns `undefined`, the stored summary keeps the characters, and `stripControl(paramsSummary(p))` prints `gitOptions=-c x=y remote=https://github.com/ab/c`. The owner is therefore shown `x=y` and approves a digest that binds `x=<ZWSP>y`. The same applies to a branch or tag that differs from an existing one only by an invisible character (`refspec=main` against `main<ZWSP>`): the approval covers a push of a different ref from the one displayed. The classifier cannot reject these words (they are legal), so the display gate is the only place it can be stopped, and the documents (`policy-and-approvals.md`, `cli-reference.md`) say the summary "shows every bound key and value whole".
**Fix:** Make `HAS_CONTROL` in `src/domain/approval.ts` the same set that `stripControl` removes, so the two cannot differ:
```ts
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/;
const CONTROL = new RegExp(HAS_CONTROL.source, 'g');
```
Add a case to `test/unit/approval.test.ts` that asserts `unshowableReason` refuses a value holding U+200B and one holding U+202E, and mention "an invisible formatting character" next to "a control character" in the document lists.

## Info

### IN-01: `coproc NAME { ... }`, `sudo -s` and `sudo -i` with a command are not classified (cites GIN-02)

**File:** `src/domain/privileged-commands.ts:393,442-460` (the reserved word list and wrappers)
**Issue:** GIN-02's fix adds `coproc` as a reserved word, so `coproc { git push; }` is read. The documented form with a name, `coproc FOO { git push; }`, is not: `coproc` is dropped and `FOO` becomes the program, so `classifyLine` returns `none` (I ran it). `sudo -s 'git push'` and `sudo -i 'git push'` hand the string to the user's shell, but the quoted word is read as a program named `git push`, so they also return `none`. The wrapper list is documented as an allow-list, so neither is a regression, but `coproc NAME` is syntax the fix claims to cover.
**Fix:** In `programWords`, after dropping `coproc`, skip one word when it is a plain name and the next word is `{` or `(`. For `sudo` and `doas`, treat the first non-option word after `-s` or `-i` as a shell string and pass it to `classifyString`. Add both forms to the shell-oracle corpus in `test/unit/privileged-commands.test.ts`, or name them in the residual list of `ENFORCEMENT_MAP`.

### IN-02: A git alias created earlier on the same line (`git config alias.p push && git p`) is classified as `none` (cites GWR-03)

**File:** `src/domain/privileged-commands.ts:732-748` (`classifyGit`)
**Issue:** GWR-03 closed the alias defined by the command's own `-c`, `--config-env` and `GIT_CONFIG_KEY_n`. The line `git config alias.p push && git p origin main` (also with `;`) defines and uses the alias in one line the hook sees whole, yet returns `none`. The documents describe the residual as "set by an earlier separate call", which this is not: the classifier has both commands. The model needs one call, not two.
**Fix:** In `classifyGit`, treat a `config` subcommand whose key argument begins `alias.` (after any global options, and with or without `--global`, `--local` or `--add`) as `unparseable` with `ALIAS_REFUSAL`, the same refusal as for `-c alias.*`. Add `git config alias.p push && git p` to the corpus.

### IN-03: A host that leaves many out-of-scope files can still make `patch()` fail and withhold its in-scope patch (cites GWR-04)

**File:** `src/app/run-stages/restricted.ts:225`; `src/adapters/git/run-workspace.ts:683-686`
**Issue:** Each out-of-scope path is passed to git as its own argv word (`:(exclude,literal)<path>`), and `status` has no cap on how many changed paths it returns. `getconf ARG_MAX` is 1,048,576 on this machine, so about 20,000 out-of-scope files with ordinary path lengths exceed it; git then cannot be started and `readOutputs` records "the patch could not be built ... and was not stored". GWR-04 fixed the file-name cause of a withheld patch; this is the count cause. I reasoned this from the limit and did not run a clone with that many files. The host the restricted run does not trust can reach it by writing files outside its scope, which the sandbox lets it do inside the clone.
**Fix:** Cap how many paths `patch` takes as `excludePaths` (for example 1,000), and when `outOfScope` is longer, build the patch from the in-scope paths instead: `git diff ... -- <in-scope pathspecs>`, or pass the excludes through `--pathspec-from-file` with `--pathspec-file-nul` on a file in the work root. Add a test with 5,000 out-of-scope files that asserts the in-scope edit is in the patch.

### IN-04: `loadCoverage` accepts any text for `judgedBy`, `judgedAt` and `method`, so the verdict's input record carries no check of who made it

**File:** `scripts/eval-retrieval.ts:543-596`
**Issue:** `loadAmendment` requires `approvedBy` and `approvedAt` (an RFC 3339 time) and refuses a half-approved record. `loadCoverage`, the record that decides which runs count as successes, requires only that `judgedBy`, `judgedAt` and `method` are strings: an empty `judgedBy` and a `judgedAt` of `"x"` load. The comment above the block says the coverage is "a record a person made and the owner approved", and `eval-coverage.json` today holds real values, but nothing enforces either statement, and a hand edit that flips one bullet changes `coverageSha256` only in the output, not the verdict's validity.
**Fix:** Require non-empty `judgedBy` and `method`, require `judgedAt` to match `RFC_3339` and parse, as `loadAmendment` does for `approvedAt`, and add the three cases to `test/unit/eval-retrieval.test.ts`.

---

_Reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
