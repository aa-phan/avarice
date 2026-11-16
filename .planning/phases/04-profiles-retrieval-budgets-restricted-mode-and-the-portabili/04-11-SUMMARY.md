---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 11
subsystem: containment
tags: [host-admission, claude-code, preflight, adr, d-20, ops-6, con-4, typescript]

requires:
  - phase: 04
    provides: "plan 04-02: spike S4-C, the flags the installed host lists and what each offline probe can prove"
  - phase: 01
    provides: "checkLaunchReady, checkHostReady, hookSelfTest and the sandbox probe in launch-preflight.ts"
provides:
  - "src/domain/host-admission.ts: admitHostVersion, compareVersions, VERIFIED_HOST_VERSIONS, VERIFIED_MINORS, REQUIRED_HELP_FLAGS"
  - "checkHostReady and checkLaunchReady return { claudeVersion, admission } and run the claude --help flag probe for an unverified patch"
  - "refusal rules enforcement_failure:host-minor-unverified, host-patch-below-range, host-version-unknown and host-flag-missing:<flag>; host-version-not-admitted:<v> is gone"
  - "host descriptor attribute admission = verified | unverified-patch"
  - "docs/decisions/ADR-014-host-patch-admission.md and the LIVE-CASES.md section Admission rule (ADR-014)"
affects: [04-23, 04-34, 04-38, 04-39]

actuals:
  tokens: 21000
  tasks: 3
  commits: 4
plan_head_before: 99435205966c186ec34d9390cfa9b6a346b5b2f4
plan_head_after: e5bf70cc31028dd1343dac1e86102fcb1c70bbdc
commits: 4

tech-stack:
  added: []
  patterns:
    - "Admission is a pure predicate over the reported version; the adapter adds the probes it cannot do (flag presence in claude --help) and the sandbox probe and hook self-test it already ran"
    - "A flag is present only as a whole word in the help text, so --settings is not met by --setting-sources or --settings-profile"

key-files:
  created:
    - src/domain/host-admission.ts
    - test/unit/host-admission.test.ts
    - docs/decisions/ADR-014-host-patch-admission.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-11-red-task1.json
  modified:
    - src/adapters/host-claude/launch-preflight.ts
    - src/adapters/host-claude/claude-host.ts
    - test/containment/failclosed.test.ts
    - test/integration/claude-host.test.ts
    - test/unit/live-admission-override.test.ts
    - test/containment/LIVE-CASES.md

key-decisions:
  - "A patch of a verified minor at or above its lowest verified patch (2.1.312) is admitted as unverified-patch when the flag probe, sandbox probe, hook self-test and settings check pass; any other minor, a lower patch or an unparseable version is refused"
  - "Versions compare per component as numbers (2.1.100 above 2.1.99)"
  - "The flag probe refuses with host-unavailable when claude --help cannot be read, and host-flag-missing:<flag> for the first missing flag in REQUIRED_HELP_FLAGS order"
  - "ADMITTED_CLAUDE_VERSIONS stays exported as an alias of VERIFIED_HOST_VERSIONS"

patterns-established:
  - "Tests that need a host version that is refused use a new minor (2.2.x); a 2.1 patch is now admitted by its probes"

requirements-completed: [OPS-6, CON-4]

coverage:
  - id: D1
    description: "admitHostVersion returns verified, unverified-patch or a refusal, comparing numerically"
    requirement: "OPS-6"
    verification:
      - kind: unit
        ref: "test/unit/host-admission.test.ts#admitHostVersion"
        status: pass
      - kind: unit
        ref: "test/unit/host-admission.test.ts#compareVersions orders each component as a number (OPS-6, T-04-29)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unverified patch launches only after the flag probe, sandbox probe and hook self-test pass; a failing probe refuses naming it"
    requirement: "OPS-6"
    verification:
      - kind: unit
        ref: "test/unit/host-admission.test.ts#checkHostReady: an unverified patch launches only after its flag probe passes"
        status: pass
      - kind: unit
        ref: "test/unit/host-admission.test.ts#checkLaunchReady: an unverified patch still has to pass the sandbox probe and the hook self-test"
        status: pass
    human_judgment: false
  - id: D3
    description: "The host descriptor carries attributes.admission"
    requirement: "OPS-6"
    verification:
      - kind: unit
        ref: "test/unit/host-admission.test.ts#the host descriptor carries the admission (D-20, OPS-6)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ADR-014 records the admission rule, the probes and what they cannot prove; LIVE-CASES.md defines how each admission is recorded"
    requirement: "CON-4"
    verification:
      - kind: other
        ref: "grep -n '^## ' docs/decisions/ADR-014-host-patch-admission.md; grep -n 'Admission rule (ADR-014)' test/containment/LIVE-CASES.md"
        status: pass
    human_judgment: true
    rationale: "Whether the residual risk stated in the ADR is acceptable is the owner's call, and the prose has not had a fresh-reader review"

duration: 35min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 11: Host admission by patch range Summary

**Claude Code 2.1 patches at or above 2.1.312 are admitted at launch after a `claude --help` flag probe, the sandbox probe and the hook self-test pass, labelled `unverified-patch` on the host descriptor; a new minor, a lower patch or a failed probe still refuses (ADR-014, D-20).**

## Performance

- **Duration:** about 35 min
- **Tasks:** 3 of 3
- **Files:** 11 (4 created, 7 modified, counting the plan files)

## Accomplishments

- `src/domain/host-admission.ts` holds the pure predicate: verified list (five versions), verified minors (`2.1` from patch 312), required help flags (seven, from S4-C), numeric `compareVersions`.
- `launch-preflight.ts` replaces list membership with the predicate. For an unverified patch it runs `claude --help` with the version probe's timeout and spawn options and refuses a missing flag as `host-flag-missing:<flag>`. A verified version is not probed. `checkLaunchReady` already ran the settings check, hook self-test and sandbox probe before the version check, so an unverified patch with an allowing hook is refused as `hook-self-test` before the host is asked anything (test added).
- `claude-host.ts` puts `admission` in the descriptor attributes beside `claudeVersion`.
- Tests that used 2.1.400 and 2.1.999 as "not admitted" now use 2.2.0 and 2.2.999, because a 2.1 patch is admitted by its probes. The harness override still maps a named version to the last verified one.
- ADR-014 and the LIVE-CASES.md section record the decision, the residual risk (a patch changing containment semantics without failing a probe), the table of behaviors only a live run proves, and the table of unverified patches seen (empty).

## Task Commits

1. Task 1 RED: `ab17fcd` test(04-11), predicate stub and 17 failing tests, evidence in `04-11-red-task1.json`
2. Task 1 GREEN: `78f9b94` feat(04-11), predicate, flag probe, admission in the preflight result, existing tests moved to a new minor
3. Task 2: `62f3795` feat(04-11), `attributes.admission` on the descriptor (the ordering cases and the live override update were covered in the Task 1 commits)
4. Task 3: `e5bf70c` docs(04-11), ADR-014 and LIVE-CASES.md

## Verification

- `node --test test/unit/host-admission.test.ts test/unit/live-admission-override.test.ts test/unit/launch-args.test.ts`: 53 pass, 0 fail
- Unit suite plus `test/containment/failclosed.test.ts`, `test/integration/claude-host.test.ts`, `test/integration/host-search-tools.test.ts`: 2669 tests, 2669 pass, 0 fail
- `npm run typecheck` clean; `npm run check:boundaries` ok (108 files)
- Acceptance: `grep -n admitHostVersion src/adapters/host-claude/launch-preflight.ts` prints lines; ADR-014 has Status, Context, Decision and Consequences and names D-20; LIVE-CASES.md has the section.
- The full `npm test` was not run (orchestrator runs it at the wave's end).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing tests asserted `host-version-not-admitted` for 2.1.400 and 2.1.999**
- **Found during:** Task 1
- **Issue:** under the new predicate a 2.1 patch is admitted by probes, so those tests no longer described a refusal.
- **Fix:** `failclosed.test.ts` now covers 2.2.0 (`host-minor-unverified`), 2.1.311 (`host-patch-below-range`) and an unverified patch whose `--help` cannot be read (`host-unavailable`); `claude-host.test.ts` and `live-admission-override.test.ts` use 2.2.x as the not-admitted version.
- **Files modified:** test/containment/failclosed.test.ts, test/integration/claude-host.test.ts, test/unit/live-admission-override.test.ts
- **Commit:** 78f9b94

**2. [Rule 3 - Blocking] The RED step needed a stub module**
- The RED evidence check rejects an import fault, so `src/domain/host-admission.ts` was committed first as an exporting stub that admits nothing (ab17fcd).

**Total deviations:** 2 auto-fixed (both Rule 3). **Impact:** none on scope.

## Decisions needing owner review

- **Unreadable `--help` refuses as `host-unavailable`**, the same rule as an unreadable `--version`; the plan named no rule for that case.
- **A 2.1 patch in the harness override path skips the flag probe**: `admissionOverride` reports the last verified version for the named one, so a live admission run on an unverified patch does not exercise the probe. This is the existing test-only behavior and is left unchanged.
- **The flag match is whole-word** (`--settings` is not met by `--settings-profile`); a host that lists a required flag only inside a longer token, such as `--max-budget-usd=<n>`, still matches because `=` is not a word character, but one written `--max-budget-usdx` does not.
- **`--safe-mode`** (S4-C section 2) is still not refused by name in `assertLaunchArgsSafe`; the plan did not ask for it and `buildLaunchArgs` never emits it.

## Known Stubs

None.

## Documentation surfaces (for plans 04-38 and 04-39)

- `docs/system/containment.md`: the launch readiness row (line 15), the refusal table rows for step 4 (lines 75 to 76: `host-version-not-admitted:{version}` is replaced by `host-minor-unverified`, `host-patch-below-range`, `host-version-unknown` and `host-flag-missing:{flag}`), the admitted-versions paragraph (line 81, "a constant list of five" and "checks membership") and the startup readiness paragraph (line 100).
- `docs/system/config-reference.md`: the `AVARICE_CLAUDE_BIN` row (line 23, "must report an admitted version") and the Admitted versions and gates table (line 316).
- `docs/system/integrations.md` and `docs/system/coverage.md` (the row "admitted host versions 5 of 5"): the five verified versions stay; add the verified-minor rule and the descriptor attribute `admission`.
- `docs/system/findings.md`: lines 78 and 90 mention the admitted list and the restricted-mode difference; line 90 now also has the launch-time rule.
- Descriptor attribute `admission` (`verified` | `unverified-patch`); `doctor` does not exist in the code yet, so the label `admitted (unverified patch)` is stated by ADR-014 and LIVE-CASES.md only.
- New ADR: `docs/decisions/ADR-014-host-patch-admission.md` (add to the proposal counterparts table if it gets a counterpart).

## Self-Check: PASSED

- Files exist: src/domain/host-admission.ts, test/unit/host-admission.test.ts, docs/decisions/ADR-014-host-patch-admission.md, 04-11-red-task1.json
- Commits ab17fcd, 78f9b94, 62f3795, e5bf70c are ancestors of HEAD
