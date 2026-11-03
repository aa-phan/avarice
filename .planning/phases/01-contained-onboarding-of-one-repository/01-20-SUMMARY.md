---
phase: 01-contained-onboarding-of-one-repository
plan: 20
subsystem: testing
tags: [mutation-testing, adversarial-testing, containment, fail-closed, node-test]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: containment, validation, ledger and record units (plans 01-06, 01-10, 01-14, 01-15, 01-16, 01-17, 01-18)
provides:
  - "Measured strength of the Phase 1 suite over the guarantee-carrying code: 249 probed mutants, a behavior ledger in 01-MUTATION.md"
  - "49 new or strengthened tests (test/mutation/ and in place) that kill the survivors, 3 todo tests for open findings"
  - "audit/mutation-test-scans.json scan record (commit f88ca1e, testsAfterCommit 90dafb1)"
affects: [01-19, phase-5-mutation-gate, verify-work]

actuals:
  tokens: 33710
  tasks: 4
  commits: 9

plan_head_before: f88ca1e31147bc70990fe002df006c4a3066eb07
plan_head_after: 9d6eb113d1b9084187b88d304fec9167846fe5ed

tech-stack:
  added: ["mutation-probe (Rust, built --locked from adversarial-mutation-test 0.35.0; rustup minimal profile in the user's home)"]
  patterns: ["probe in scratch clones so the working tree never holds a mutation", "per-file suite wrapper with fail-fast and rerun-once for a reproducible kill"]

key-files:
  created:
    - test/mutation/fail-closed.test.ts
    - test/mutation/scope-and-validation.test.ts
    - test/mutation/ledger-and-record.test.ts
    - audit/mutation-test-scans.json
    - .planning/phases/01-contained-onboarding-of-one-repository/01-MUTATION.md
  modified:
    - test/integration/hook.test.ts
    - test/integration/claude-host.test.ts
    - test/integration/validation-failures.test.ts
    - test/containment/failclosed.test.ts
    - test/fault/budgets.test.ts
    - test/unit/graph-merge.test.ts
    - .planning/phases/01-contained-onboarding-of-one-repository/01-VALIDATION.md

key-decisions:
  - "Probe in two scratch clones of the scanned commit, not in the working tree: src stayed clean throughout and the pre-existing suite stayed untouched while pass 1 ran"
  - "Open findings MF-02, MF-03, MF-04 are left as todo tests for the owner; no documented design decision was changed"
  - "Equivalent mutants (FC-2g, B-23, B-31, B-08) are argued in the ledger, not pinned with tests that would encode an implementation detail"

requirements-completed: [ONB-1, ONB-3, ONB-8, ONB-9, ONB-12, SEC-5]

coverage:
  - id: D1
    description: "Every FC-1 to FC-12 fail-closed behavior has a probed mutant killed by a named test, or an equivalence argument"
    requirement: "ONB-3"
    verification:
      - kind: other
        ref: "01-MUTATION.md ledger check: node -e (rows >= 24, 12 distinct FC ids, no FC row survived)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pre-existing suite probed in full (158 mutants) before any new test was written, so each kill is attributed"
    verification:
      - kind: other
        ref: ".mutation-test/results/pass1-*.out, pass1b-*.out (pass 1: 133 killed, 25 survived)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Adversarial pass derived expected values from docs/containment.md, docs/repository-onboarding.md and docs/contracts-and-state.md; one test defect fixed (MF-01), three disagreements recorded as todo tests (MF-02, MF-03, MF-04)"
    verification:
      - kind: unit
        ref: "test/containment/failclosed.test.ts#when the sandbox network allowlist is not strict (todo)"
        status: pass
    human_judgment: true
    rationale: "Whether MF-02, MF-03 and MF-04 are defects or accepted design is the owner's call"
  - id: D4
    description: "Full suite green on Node 22.22.3 and Node 26.9.0 with no test deleted, skipped or weakened"
    verification:
      - kind: other
        ref: "node --test: 980 pass, 0 fail, 21 skipped (live), 3 todo on both Nodes; npx tsc -p . and scripts/check-boundaries.ts green"
        status: pass
    human_judgment: false

duration: 5h 14m
completed: 2026-11-03
status: complete
---

# Phase 1 Plan 20: Mutation campaign over the containment, validation and ledger units Summary

**The Phase 1 suite kills 244 of 249 mutants of the fail-closed code (133 with the tests that existed, 111 after this plan's additions), 4 are equivalent, 1 non-FC survivor is recorded, and the campaign found one real test defect (fixed) and three open spec questions (todo tests).**

## Performance

- **Duration:** 5h 14m (2026-11-02 23:45 to 2026-11-03 04:59, local)
- **Tasks:** 4 (Task 1 was resolved by the owner through the orchestrator before the run)
- **Files modified:** 13 (6 existing test files, 3 new test files, scan record, ledger, validation)

## Accomplishments

- **Task 1 (checkpoint, resolved before the run).** The owner chose `rustup-user`. Rust 1.99.1 was installed with `rustup-init` over HTTPS (TLS 1.2+), `--no-modify-path --profile minimal`, into `~/.cargo` (40 MB) and `~/.rustup` (445 MB); no shell profile was edited. The probe was built with `cargo build --release --locked` from the plugin's own source under `$TMPDIR`. Nothing was installed before that.
- **Task 2.** 249 mutants across the Target Units, one per behavior. The pre-existing suite was probed first (158 mutants): 133 killed by named existing tests, 25 survived. Recorded in `01-MUTATION.md` with the scanned commit `f88ca1e31147bc70990fe002df006c4a3066eb07`, the suite command and the full ledger.
- **Task 3.** Each survivor got a discriminating test, strengthened in place where an existing test meant to cover the behavior and added under `test/mutation/` otherwise; 22 of the first 25 were killed by it and 3 are equivalent. The 91 mutants not probed in pass 1 were probed against the later suite (62 killed, 29 survivors); 27 of those were killed by further new tests, 1 is equivalent and B-87 survives with a recorded follow-up. No FC row survives.
- **Adversarial pass.** Expected values were derived from the three spec documents and falsified with inputs the suite lacked: `..` after a symlink, case-variant spellings on APFS, symlink loops and 45-link chains, `--flag=value` spellings, a `;` second command, text after the GSD preamble, glob and brace expansion in shell reads, exact-zero budgets, lease fences, activation precedence. Results: MF-01 (fixed), MF-02, MF-03, MF-04 (open), observations O-1 to O-6.
- **Task 4.** `audit/mutation-test-scans.json` (commit `f88ca1e`, `testsAfterCommit` `90dafb1`, 249 behaviours, 133 + 49 + 62 killed, 4 equivalent, 1 surviving), the Mutation row in `01-VALIDATION.md`, full suite on both Nodes.

## Task Commits

1. **MF-01 RED:** `c06f6eb` the reap test's child must be running before reap (fails deterministically).
2. **MF-01 GREEN:** `d678833` pass `--` before `--session-id`; **MF-01b:** `90dafb1` random session ID.
3. **Task 3 tests, per unit:** `f225946` (hook, launch, preflight, executor), `a6be5ae` (scope, validation, narrowing), `c13005c` (lease, activation), `46ab4fe` (hook input limits, canonicalizer, executor cancellation, budget boundary), `27c66ca` (structure checks, write set, activation, budget input).
4. **Task 4 / ledger:** `9d6eb11` 01-MUTATION.md, scan record, validation row.

## Findings (details in 01-MUTATION.md)

- **MF-01 fixed.** `node -e SCRIPT --session-id ID` exits with `bad option` within milliseconds, so the reap test passed only when `pgrep` won a race; this is the intermittent failure 01-18 saw. A second defect in the same test (a constant session ID) let two concurrent suite runs end each other's child. Test-only; production `reap` unaffected.
- **MF-02 open.** The launch preflight does not require `sandbox.network.strictAllowlist`.
- **MF-03 open.** The 2 KiB document-node cap counts top-level string fields only.
- **MF-04 open.** The hook's shell read check does not see unquoted glob or brace expansion (the sandbox `denyRead` is the stopping control).
- **Real holes the survivors exposed (now pinned):** a `;` second command was admitted by the hook's lexer when its refusal was removed; text after the GSD preamble on the same line; `--bare=1` style flags in the launch check; a `.git` entry missing from the workspace listing; the exact-zero budget boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reap test raced pgrep (MF-01)**
- **Found during:** Task 2 (the first full run of the wrapper failed on it)
- **Issue:** the child process exited at start-up; a fixed session ID also let concurrent suites interfere
- **Fix:** failing assertion first (`c06f6eb`), then `--` before `--session-id` (`d678833`) and a random UUID (`90dafb1`); the `{ terminated: 1 }` assertion is unchanged
- **Files modified:** test/integration/claude-host.test.ts
- **Commit:** c06f6eb, d678833, 90dafb1

**2. [Rule 3 - Blocking] The suite is too slow to probe 249 mutants as written**
- **Found during:** Task 2
- **Issue:** the full suite takes about 95 s per verdict; the plan's one-suite-per-mutant would have taken about 6 hours
- **Fix:** probed in two scratch clones with a per-file wrapper (`.mutation-test/suite-runner.mjs`) that runs the same files, runs the files that mention the mutated module first, stops on the first failing file and reruns it once before the failure counts. Pass 1 was then limited to 158 mutants; the other 91 ran against the later suite (so their kills are not split between old and new tests)
- **Files modified:** none under src or test (probe files are in the gitignored `.mutation-test/`)

**3. [Departure] Mutations were never applied in the working tree**
- The skill and plan allow the probe to mutate `src`; clones were used instead (the skill's own advice), so `git diff --exit-code -- src` stayed clean the whole time. One probe run was stopped by hand and the scratch clones' `src` were reset there.

**Total deviations:** 1 auto-fixed bug, 1 blocking issue worked around, 1 departure in method. **Impact:** attribution for 91 mutants is "suite after Task 3", not split.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema; findings stay in the repository (T-01-71), no issue was filed and nothing was pushed.

## Self-Check

Verified: `01-MUTATION.md`, `audit/mutation-test-scans.json` and the three `test/mutation/` files exist; commits `c06f6eb`, `d678833`, `f225946`, `a6be5ae`, `c13005c`, `46ab4fe`, `27c66ca`, `90dafb1`, `9d6eb11` are on the branch; `git status --porcelain -- src` is empty; the plan's Task 2, 3 and 4 automated checks pass.

## Self-Check: PASSED
