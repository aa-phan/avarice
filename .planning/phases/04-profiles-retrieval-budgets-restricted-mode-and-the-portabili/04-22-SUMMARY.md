---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 22
subsystem: testing
tags: [profile-isolation, redaction, sandbox-exec, canary, secret-corpus, sec-1, sec-3, ac-5, ac-6, typescript]

requires:
  - phase: 04-12
    provides: "knownProfileRoots, ProfilePaths.otherRoots and the moved-root deny list the isolation suite exercises"
  - phase: 04-15
    provides: "the keychain broker whose resolution seeds the process redactor"
  - phase: 04-18
    provides: "the line-by-line transcript redaction, AVARICE_DEBUG_TRANSCRIPTS and the redacting artifact store"
provides:
  - "AC-6 measured: 12 enterprise-acme commands (moved roots) and 5 (default parents) under a sandbox that denies personal-local's roots, 0 failed or named a denied path, 0 canaries in anything enterprise-acme wrote"
  - "AC-5 measured: a corpus of every pattern kind plus a seeded keychain value injected through six inputs, 0 findSecrets hits and 0 seeded values in 58 scanned stores"
  - "SECRET_CORPUS, SEEDED_VALUE, scanForCorpus, scanTotal (test/helpers/secret-corpus.ts)"
  - "Two production redaction gaps closed (the brief, the hook's read keys) that the suite found"
affects: [04-27, 04-28, 04-34, 04-37, 04-38]

actuals:
  tokens: 16200
  tasks: 2
  commits: 4
plan_head_before: 43efd8e883ebe4f868d00cdb60a8a20d0f19ff5b
plan_head_after: c15f352d6f05ed1ea3ada1535c0660fa692e3ef3
commits: 4

tech-stack:
  added: []
  patterns:
    - "A cross-profile read is counted two ways on macOS, which has no unprivileged syscall trace: a command that fails on (or names) a denied path under sandbox-exec, and a planted canary found in anything the second profile wrote"
    - "A redaction suite pairs every input with a positive control: the raw input holds each corpus kind, and the store it reaches holds the matching [REDACTED:<kind>] marker, so a 0 is never a pass on an empty store"
    - "The secret corpus is derived from fixed seeds at test time, so no complete secret-shaped literal is committed"

key-files:
  created:
    - test/helpers/secret-corpus.ts
    - test/integration/profile-isolation.test.ts
    - test/integration/redaction-suite.test.ts
  modified:
    - src/app/deps.ts
    - src/app/run-start.ts
    - src/cli/composition.ts
    - src/hook/pre-tool-use.ts
    - src/domain/enforcement-map.ts
    - scripts/exit-parity.ts
    - test/helpers/live-harness.ts

key-decisions:
  - "A brief is redacted, not refused, when it holds a secret: startRun parses the text after AppDeps.redact, so the title, the work items and the contract hold the marker and the run goes on"
  - "hook_reads is keyed by the redacted path plus the first 16 hex characters of the SHA-256 of the whole path, on write and on lookup, so read-before-edit still tells two secret-named files apart"
  - "The config home is shared by every profile, so the isolation suite denies personal-local's profile directory by contents (file-read-data), not the whole config home and not its metadata"
  - "The seeded credential value is not injected through a hook event target: the hook is a separate process that never resolves a credential and cannot know it"

patterns-established:
  - "Skeleton-free exit suites: the plan adds no production feature, so a green first run is explained by controls that prove each count can be non-zero"

requirements-completed: [SEC-1, SEC-3]

coverage:
  - id: D1
    description: "AC-6: every enterprise-acme command (repo add, onboard with the index and knowledge steps, context, status, inbox, start killed in verification, resume of the run and of the onboarding) runs under a sandbox denying personal-local's data root, work root and profile config, none fails on or names a denied path (0), and no personal-local canary is in anything enterprise-acme wrote (0)"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-isolation.test.ts#AC-6: a second profile runs its whole workflow with the first profile unreadable"
        status: pass
    human_judgment: false
  - id: D2
    description: "S-9 and the moved-root case: status naming personal-local inside the enterprise-acme repository exits 3 and neither store changes; the roots personal-local moved by environment variable are found by the registry and denied; the same holds on the default parents"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-isolation.test.ts#S-9: status naming personal-local inside the enterprise-acme repository exits 3 and neither store was touched"
        status: pass
      - kind: integration
        ref: "test/integration/profile-isolation.test.ts#AC-6 on the default parents: enterprise-acme commands under a deny of personal-local's default roots"
        status: pass
    human_judgment: false
  - id: D3
    description: "AC-5: a corpus of every pattern kind and a seeded keychain value, injected through the brief, repository files, a declared check's output, the host transcript, hook event targets and the shell command line, leaves 0 findSecrets hits and 0 seeded values in every table, artifact file, the history file and the rest of the data root, with a positive control per input"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/redaction-suite.test.ts#AC-5: a secret corpus injected through every input leaves none of it in the store, the artifacts or the history"
        status: pass
    human_judgment: false
  - id: D4
    description: "A secret pasted into a brief is stored as its redaction marker in the run title, the work items, the contract and the contract file; a path that holds a secret is stored in hook_reads as the marker plus a digest of the path"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/redaction-suite.test.ts#each input left its redaction markers in the store it reaches (the 0 above is not a pass on empty stores)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The enforcement map attributes profile isolation and redaction to the two exit suites; the live drivers (scripts/exit-parity.ts, the live harness) deny the other profiles' roots instead of passing an empty list"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/enforcement-map.test.ts"
        status: pass
      - kind: integration
        ref: "test/integration/exit-parity.test.ts"
        status: pass
    human_judgment: true
    rationale: "The live drivers run against the real machine and a live model; their new deny list is typechecked and the parity script's offline tests pass, but a live pass belongs to plans 04-34 and 04-37"

duration: 35min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 22: AC-6 profile isolation and AC-5 redaction exit suites Summary

**Two committed offline suites measure the SC1 numbers: 0 cross-profile reads across a second profile's whole workflow under a deny sandbox with planted canaries, and 0 secret patterns in the store, artifacts and history after a seeded corpus went through six inputs; the redaction suite found and closed two persistence boundaries (the brief, the hook's read keys) that kept a secret as typed**

## Performance

- **Duration:** about 35 min
- **Started:** 2026-11-17T07:38:00Z (approximate; not recorded at start)
- **Completed:** 2026-11-17T08:14:00Z
- **Tasks:** 2 (one tracer, one auto)
- **Files modified:** 10 (3 created, 7 modified, excluding this summary)

## Measured counts (for plan 04-34)

```
cross-profile reads: 0 (enterprise-acme commands that failed on, or named, a denied personal-local path; 12 commands ran)
cross-profile reads: 0 (personal-local canaries in what enterprise-acme wrote; 5 canaries, 297 files and the store scanned)
cross-profile reads: 0 (default parents: commands that failed on, or named, a denied personal-local path; 5 commands ran)
cross-profile reads: 0 (default parents: personal-local canaries in what enterprise-acme wrote)
secret patterns found: 0 (58 stores scanned: the SQLite dump, the artifact files, the history file and the rest of the data root)
```

`node --test test/integration/profile-isolation.test.ts test/integration/redaction-suite.test.ts` prints these five lines (14 of 14 tests pass). Both suites are fully offline: a fake claude, a fake run host, a fake graphify and a temporary keychain stand in for the model and the tools. Nothing is deferred to plan 04-34 except running them again after plans 04-27 and 04-28 add their stores.

## Accomplishments

- **AC-6 suite.** personal-local holds an active record and a `ready_for_review` run of R1 with canaries in its store (the run title), a repository file, its data root, its work root and its profile config. enterprise-acme repo add, onboard (index and knowledge steps), context, status, inbox, a start killed in verification, status of the paused run, resume of the run, resume of the stopped run, resume of the onboarding and a refused cross-profile status run under `sandbox-exec` with the network and every read of personal-local's roots denied. None failed on or named a denied path, and none of the five canaries is in enterprise-acme's store, artifacts, work root, config or output. S-9 (`status --profile personal-local` in the enterprise-acme repository) exits 3 and neither store's files change. A second layout (temp HOME, default parents) runs five commands the same way.
- **AC-5 suite.** A corpus of one sample per pattern kind (GitHub token, AWS key ID, JWT, private key block, Authorization header, URL userinfo, an `sk-` key) and a seeded value read from a temporary keychain (which seeds the process redactor) go through the brief, a repository source file and text file, a declared check that prints the text file, the host transcript (through the production Claude host adapter with the whole transcript stored), the names of files the unit writes (hook event targets) and the interactive shell's command line. Every table, artifact file, the history file and the rest of the data root hold none of it, and the stores hold the markers where it went in.
- **Controls.** The wrapper really denies a canary read; the scan finds all five canaries in personal-local's own roots; a command that opens personal-local's store under the same wrapper is counted; every corpus sample triggers its own pattern; the seeded value triggers none and is unknown to the redactor until the keychain is resolved; every input holds every kind before anything is stored.
- **Reconciled the two carried items.** The enforcement map now attributes profile isolation to `test/integration/profile-isolation.test.ts` (replacing the sandbox-only evidence of plan 04-06) and redaction to `test/integration/redaction-suite.test.ts`; `scripts/exit-parity.ts` and the live harness deny the other profiles' roots instead of passing `profileRoots: []`.

## Task Commits

1. **Task 1: tracer, the AC-6 isolation suite** - `4c18614` (test)
2. **Task 2: the AC-5 redaction suite** - `9a4a33a` (test), preceded by the production fix it required `1ee6ca8` (fix)
3. **Carried items: enforcement map and live drivers** - `c15f352` (test)

**Plan metadata:** the commit that adds this summary, STATE.md and ROADMAP.md.

## Files Created/Modified

- `test/integration/profile-isolation.test.ts` - AC-6 suite (moved roots with the full workflow, and the default parents)
- `test/integration/redaction-suite.test.ts` - AC-5 suite
- `test/helpers/secret-corpus.ts` - `SECRET_CORPUS`, `SEEDED_VALUE`, `scanForCorpus`, `scanTotal`
- `src/app/deps.ts`, `src/cli/composition.ts`, `src/app/run-start.ts` - `AppDeps.redact` (the process redactor) and the brief parsed after it
- `src/hook/pre-tool-use.ts` - the key of `hook_reads`
- `src/domain/enforcement-map.ts` - the two attributions
- `scripts/exit-parity.ts`, `test/helpers/live-harness.ts` - the other profiles' roots in the scope

## Decisions Made

See key-decisions above. The ones that set policy or security semantics beyond the plan are under the next heading.

## Decisions needing owner review

1. **A brief that holds a secret is redacted, not refused (SEC-3).** The suite found the brief kept as typed in the run title, the work items, the contract and its file. The plan requires 0 hits with the run going on, so `startRun` now parses the text after `AppDeps.redact`; the model sees the marker, not the secret, and the digest that detects a changed file stays the one of the file bytes. The alternative is to refuse the brief (exit 64 naming the pattern), which is stricter and changes what `start` accepts. Pattern kinds are redacted whatever the process; a seeded credential value is redacted only in a process that already resolved the credential, which `start` does not, so a pasted credential literal that matches no pattern stays in a brief.
2. **The hook cannot redact a seeded credential value.** The hook is a process of its own (a child of the host) that never resolves a credential, so its redactor holds the patterns only. A seeded literal that matches no pattern and appears in what the hook records (a file path) is stored as typed in `events` and `hook_reads`. Passing the value to the hook would put a credential in the host's environment or on disk, which is worse. The suite therefore injects the seeded value into every input except hook event targets; the plan's "0 occurrences of the seeded value" holds there only for pattern-shaped secrets. Today a hook event's target is a staging-relative file path and a Bash call records no command text, so the exposure is a secret in a file name.
3. **`hook_reads` stores a digest of a secret-bearing path.** The key is the redacted path plus 16 hex characters (64 bits) of the SHA-256 of the whole path, only when redaction changed the path. A 64-bit prefix of a hash of a path that embeds a high-entropy token is not a practical lead on the token, but a path that embeds a low-entropy secret could be brute-forced offline from it. A bare marker would let a read of one secret-named file satisfy the read-before-edit rule for another.
4. **What AC-6 counts, and what it cannot see.** The config home is shared by every profile (it holds `bindings.json` and each profile's own config), so it cannot be denied whole. The suite denies personal-local's data root and work root outright and personal-local's profile config directory by contents (`file-read-data`: file contents and listings, not the metadata of the directory). A full deny made every enterprise-acme command exit 70, because composition lstats and reads each other profile's directory and config on every command (the registry of plan 04-12, D-19) and treats an lstat it cannot make as a failure that stops the command. That read is by design and returns roots only, but it is a read of another profile's config by the CLI process (the production sandbox applies to run commands and the host, not to the CLI). A refused read of `config.json` is skipped by the registry, so the first count (a command that fails on, or names, a denied path) does not see it; the second (canaries) shows none of its content reached anything enterprise-acme wrote. If AC-6 is meant to forbid that read too, the registry needs another source for the roots (a registry of its own, not each profile's config).
5. **Hook-recorded targets are file names only.** The plan said "hook event targets with corpus targets"; the hook records a file path for a Read, Edit or Write and no command text for a shell call, so a secret reaches a hook event only through a file name. Kinds that need a space, slash, colon or `@` (an Authorization header, a URL) cannot be a file name and are covered by the other inputs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] The brief was stored as typed**
- **Found during:** Task 2 (AC-5 suite, first complete run: 5 stores held corpus hits)
- **Issue:** `contracts`, `runs`, `work_items`, the contract file `runs/<id>/contract-v1.json` and `state.db` held the brief's secrets verbatim.
- **Fix:** `AppDeps.redact` (composition wires the process redactor), and `startRun` parses `(deps.redact ?? redactSecrets)(text)`.
- **Files modified:** src/app/deps.ts, src/cli/composition.ts, src/app/run-start.ts
- **Verification:** the suite (0 hits, markers in `contracts` and `runs`); unit suite 2687 of 2687; run-start, run-ledger, run-spec-derivation, run-resume-refs, run-supervisor, run-gates and others green
- **Committed in:** 1ee6ca8

**2. [Rule 2 - Missing critical functionality] `hook_reads` stored the path of a secret-named file as typed**
- **Found during:** Task 2 (second run: `hook_reads` and `events` held hits)
- **Issue:** the read-before-edit table keys each file by its canonical path; a path that holds a token was written to it unredacted by the hook's own SQL.
- **Fix:** `readKey` in the hook (redacted path plus a digest of the path, used on insert and on lookup).
- **Files modified:** src/hook/pre-tool-use.ts
- **Verification:** the suite (0 hits, `[REDACTED:...]` in `hook_reads`); hook, hook-privileged, hook-read-digest, hook-git-secret-reads, run-loops, claude-host and host-search-tools tests green
- **Committed in:** 1ee6ca8

**3. [Rule 3 - Blocking] A full deny of personal-local's config directory made every enterprise-acme command exit 70**
- **Found during:** Task 1 (first run)
- **Issue:** see Decisions needing owner review 4. The registry lstats every other profile directory and fails the composition when the lstat is refused.
- **Fix:** the suite denies the profile config directory by contents, not whole.
- **Files modified:** test/integration/profile-isolation.test.ts
- **Verification:** the suite, with the control that the denied files cannot be read
- **Committed in:** 4c18614

**4. [Rule 3 - Blocking] The run blocked on a decision, and the transcript control saw a JSON escape**
- **Found during:** Task 2
- **Issue:** eight denied shell attempts in a row reached the loop limit of three consecutive denials and opened a decision; the transcript control scanned JSON lines in which `\n` sits before an AWS key ID, which the word-boundary pattern does not match.
- **Fix:** hook-recorded targets are injected as file names (a shell call records no text), and the transcript control scans the decoded strings. The stored transcript is redacted either way: an AWS key ID after a JSON escape is named `[REDACTED:gsd-scan]` by the GSD pattern instead of `[REDACTED:aws-key]`.
- **Files modified:** test/integration/redaction-suite.test.ts
- **Verification:** the suite
- **Committed in:** 9a4a33a

### Plan items done differently

- The plan says to read the `PLAN.md` interface `denyRead` from `test/helpers/offline.ts` and extend it; the suite builds its wrapper locally from `NO_NETWORK_PROFILE` and `SANDBOX_EXEC` of that file (the plan's own instruction to extend the wrapper "only inside the test file").
- The `test/helpers/secret-corpus.ts` helper holds `scanTotal` besides the two planned exports.

---

**Total deviations:** 4 auto-fixed (2 missing critical, 2 blocking). **Impact on plan:** the two Rule 2 fixes change production code the plan did not list; both are what T-04-60 asks the suite to catch and were committed apart from the suite. No scope creep.

## TDD Gate Compliance

No RED record files: this is an `execute` plan of exit suites, not a `tdd` plan. Task 1 (tracer) was green on its first working run because the isolation it measures already held; that is explained rather than assumed: the controls show the wrapper blocks a canary read, the scan finds the canaries in personal-local's own roots, and a command that opens personal-local's store under the same wrapper is counted. Task 2 was RED before the fix: the first complete run found hits in `contracts`, `runs`, `work_items`, the contract file and `state.db`, and the second in `hook_reads` and `events`; both closed in `1ee6ca8` and the suite then ran with 0 hits.

Tracer gate: the tracer `<verify>` (`node --test test/integration/profile-isolation.test.ts`) passed end to end (9 of 9) before Task 2 started.

## Issues Encountered

- The suites run a real onboarding, run and shell in this process or under `sandbox-exec`, about 19 s (AC-6) and 9 s (AC-5).
- The unit tier, the hook tests, the run tests and the credential tests were run after the production changes; the full suite is the orchestrator's run at the end of the wave.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-59 (a cross-profile read missed by unit tests) and T-04-60 (a persistence boundary missed by redaction) are mitigated by the suites, and the second found two real gaps (above). T-04-61 (a real secret committed in fixtures): the corpus is derived from fixed seeds at run time and `findSecrets` over the three new test files and both changed source files returns nothing; `test/unit/footprint.test.ts` passes. No package was installed (T-04-SC).

## Documentation surfaces (for plan 04-38)

- **Data model / containment:** `hook_reads.path` holds the redacted path plus `#<16 hex>` when a path held a secret-shaped string; the brief text is stored redacted (`runs.title`, `work_items.spec_json`, `contracts`, `runs/<id>/contract-v1.json`).
- **CLI reference:** `avarice start` redacts a brief's secrets (marker `[REDACTED:<kind>]`) before the contract is compiled; the file's byte digest still decides `changed` on resume.
- **Containment, limits:** the seeded-credential limit of the hook process (decision 2) and the registry's read of other profiles' config (decision 4).
- **Coverage:** `docs/system/coverage.md` counts, and the enforcement map rows `profile-isolation` and `redaction` now name tracked suites.

## Next Phase Readiness

Plans 04-27 (manual evidence) and 04-28 (retrieval caches) add their own redaction and profile assertions; plan 04-34's offline gate runs both suites again after them. `AppDeps.redact` is available to any service that stores text a person typed.

## Self-Check: PASSED
