# Deferred items, phase 04

Out-of-scope discoveries logged by executors; each is for the owner or a later plan.

## Found by plan 04-14

- `test/integration/exit-parity.test.ts` fails 10 of 15 cases (fixtures A and B and the anchor) with `TypeError: deps.profile.otherRoots is not iterable` at `src/app/checks.ts:138`, reached through `scripts/exit-parity.ts:489` (`parityReport` builds a profile with no `otherRoots`). None of those files is touched by plan 04-14, and the failing path (`sandboxSetup` in the parity script) does not run the onboarding code this plan changed. Pre-existing: `b9e566f` (plan 04-12) made `sandboxSetup` read `deps.profile.otherRoots`, and `scripts/exit-parity.ts:488` builds its profile as `{ workRoot, dataRoot }` only. The fix is `otherRoots: []` there (or the real roots).

## Deferred by plan 04-52 (code review warnings)

Warnings the triage did not fix. Each is also a row of `04-REVIEW-DISPOSITION.md` reading `deferred`.

- WR-14: A kill between activation and the start of a requested promotion leaves it neither done nor reported; nothing runs and no data changes. Target: Phase 5 (delivery and data safety).
- WR-23: `patch()` decodes a binary-capable diff as UTF-8, so a non-UTF-8 restricted patch loses byte fidelity. Target: Phase 5 (data safety).
- WR-26: A corrupt binding or enterprise-pattern registry makes `avarice doctor` exit 3 before it can diagnose; the registry read itself still fails closed. Target: Phase 5 (corrupted-store diagnosis and restore).
- WR-28: The AC-8 summary counts infrastructure failures as task failures and ignores `tokensComplete`; it has no effect on the recorded verdict. Target: plan 04-50 (moves the row to fixed if the owner chooses branch b, otherwise before any further AC-8 run).
- WR-29: The token comparison uses raw totals while success uses rates; the recorded runs have equal task counts, so the verdict is unaffected. Target: plan 04-50 (moves the row to fixed if the owner chooses branch b, otherwise before any further AC-8 run).
- WR-32: A completed, paid run is discarded when judge preparation throws; it has no effect on the recorded verdict. Target: plan 04-50 (moves the row to fixed if the owner chooses branch b, otherwise before any further AC-8 run).
- WR-36: The arm repository still holds the denied files in git history and `assertNoLeak` does not check it; plan 04-50's decision context scans whether any run read the held-out file. Target: plan 04-50 (moves the row to fixed if the owner chooses branch b, otherwise before any further AC-8 run).
- WR-37: The fake-remote duplicate fault changes nothing, so the duplicate-tolerance tests pass vacuously against the fake. Target: Phase 7 (real remote adapters extend NFR-4).
- WR-38: The doctor probe timeout is a fixed 1 s and the fake `claude` is a Node process, so two doctor tests flake under load. Target: Phase 5.
