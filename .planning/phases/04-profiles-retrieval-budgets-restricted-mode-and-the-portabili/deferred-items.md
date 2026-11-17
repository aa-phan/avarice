# Deferred items, phase 04

Out-of-scope discoveries logged by executors; each is for the owner or a later plan.

## Found by plan 04-14

- `test/integration/exit-parity.test.ts` fails 10 of 15 cases (fixtures A and B and the anchor) with `TypeError: deps.profile.otherRoots is not iterable` at `src/app/checks.ts:138`, reached through `scripts/exit-parity.ts:489` (`parityReport` builds a profile with no `otherRoots`). None of those files is touched by plan 04-14, and the failing path (`sandboxSetup` in the parity script) does not run the onboarding code this plan changed. Pre-existing: `b9e566f` (plan 04-12) made `sandboxSetup` read `deps.profile.otherRoots`, and `scripts/exit-parity.ts:488` builds its profile as `{ workRoot, dataRoot }` only. The fix is `otherRoots: []` there (or the real roots).
