---
phase: 02-contained-unattended-run-of-one-work-item
plan: 33
subsystem: containment
tags: [sandbox, credentials, deny-list, redaction, seatbelt, gap-closure]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: command sandboxes and default AVARICE parents (02-20), budget settlement (02-32), integrations documentation (02-29)
provides:
  - CREDENTIAL_PATHS and credentialPaths(home) in the domain: twelve home-relative credential locations
  - the list at all five deny sites (check/install/inventory sandbox, onboarding scope, run scope, graphify and GSD tool sandboxes)
  - check output passed through redactSecrets before it is stored as an artifact
  - real-sandbox read, copy and npm tests with a temporary home
  - containment.md, integrations.md and config-reference.md describe the credential locations, the redaction and the deny-list limit
affects: [02-34, 02-35 documentation pass, verify-work 2]

plan_head_before: 97dbeefa13a6ab9d8e23f20dcc5a2a22cb43c096
plan_head_after: d19325f1be19ca14cdd3f9c55db692dcdb48d262

actuals:
  tokens: 18000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "one exported readonly list plus a mapper under a home path feeds every deny list; the domain keeps its own string join"
    - "real-sandbox tests build a temporary home with a sentinel at each protected location and run /bin/cat and /bin/cp through SandboxedExecutor with sandboxSetup's paths"

key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-33-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-33-red-evidence-task2.json
  modified:
    - src/domain/invocation-scope.ts
    - src/app/checks.ts
    - src/adapters/graph/graphify.ts
    - src/adapters/gsd/gsd-onboarding.ts
    - test/integration/run-sandbox-other-profiles.test.ts
    - test/integration/check-validation.test.ts
    - test/integration/claude-host.test.ts
    - test/integration/hook.test.ts
    - test/unit/invocation-scope.test.ts
    - test/unit/run-scope.test.ts
    - test/unit/claude-settings.test.ts
    - test/unit/hook-decision.test.ts
    - docs/system/containment.md
    - docs/system/integrations.md
    - docs/system/config-reference.md

key-decisions:
  - "The allow-list inversion of the command sandbox is not done: node and npm need many system paths, so the triage rated it large and risky. The deny list stays a list of known locations and containment.md's limits say so (T-02-116, accepted)."
  - "The list adds .git-credentials and .pgpass to the review's seven locations."
  - "The Read permission-deny renderer is unchanged, as the plan says; see Findings for plan 02-35 for what that means for the file-shaped entries."

patterns-established:
  - "A new credential location is added in CREDENTIAL_PATHS only; every sandbox and the hook follow"

requirements-completed: [RC-5, CON-5, CON-1]

coverage:
  - id: D1
    description: "A command run with the check sandbox's settings cannot read any of the twelve credential locations and cannot copy ~/.netrc into scratch, under the real macOS sandbox with a temporary home"
    requirement: "CON-1"
    verification:
      - kind: integration
        ref: "test/integration/run-sandbox-other-profiles.test.ts#credential locations are unreadable to run commands (R-WR-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "npm still runs with its .npmrc read-denied: npm config get registry exits 0 in the real sandbox with HOME set to the temporary home"
    requirement: "CON-1"
    verification:
      - kind: integration
        ref: "test/integration/run-sandbox-other-profiles.test.ts#credential locations are unreadable to run commands (R-WR-03) > npm still runs with its .npmrc read-denied"
        status: pass
    human_judgment: false
  - id: D3
    description: "A declared check's output is redacted before it is stored as an artifact"
    requirement: "CON-5"
    verification:
      - kind: integration
        ref: "test/integration/check-validation.test.ts#a secret printed by a check is stored redacted (R-WR-03, T-02-115)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The onboarding and run scopes, the generated host settings (sandbox denyRead and denyWrite, Read deny rules) and the hook policy hold every credential location"
    requirement: "RC-5"
    verification:
      - kind: unit
        ref: "test/unit/invocation-scope.test.ts, test/unit/run-scope.test.ts, test/unit/claude-settings.test.ts, test/unit/hook-decision.test.ts"
        status: pass
      - kind: integration
        ref: "test/integration/claude-host.test.ts and test/integration/hook.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The graphify and GSD tool sandboxes use the shared list"
    requirement: "CON-1"
    verification:
      - kind: integration
        ref: "test/integration/graphify-tool.test.ts and test/integration/gsd-adapter.test.ts (existing suites, no expected list named the three directories)"
        status: pass
    human_judgment: false
  - id: D6
    description: "docs/system containment.md, integrations.md and config-reference.md describe the credential locations, check-output redaction and the deny-list limit"
    verification: []
    human_judgment: true
    rationale: "Prose accuracy and style are checked by the fresh prose review in plan 02-35; only the plan's greps were run here."

duration: 50min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 33: Credential locations Summary

**One exported list of twelve home-relative credential locations now feeds all five sandbox deny sites and the hook, a command under the real macOS sandbox can no longer read or copy any of them, and check output is redacted before it is stored.**

## Performance

- **Duration:** about 50 min (the full suite took about 6 of them)
- **Completed:** 2026-11-08
- **Tasks:** 3
- **Files modified:** 17 (including the two RED evidence files and this SUMMARY's neighbours)

## Accomplishments

- R-WR-03 fixed at the five sites the triage undercounted: (1) `sandboxSetup` in src/app/checks.ts, which serves every check, the install and the inventory list command; (2) the onboarding scope's `denyRead`; (3) the run scope's `denyRead` and `denyWrite`, which become the host's `sandbox.filesystem.denyRead`, Read deny rules and the hook policy through the unchanged renderer; (4) the graphify adapter; (5) the GSD onboarding adapter. `grep -n "export const CREDENTIAL_PATHS" src/domain/invocation-scope.ts` prints one line (387) and `grep -n "'.config/gh'" src/domain/invocation-scope.ts` prints exactly one line, inside the list.
- The list: `.ssh`, `.aws`, `.config/gh`, `.gnupg`, `.netrc`, `.npmrc`, `.docker`, `.kube`, `.config/gcloud`, `Library/Keychains`, `.git-credentials`, `.pgpass`.
- Proven on the real sandbox with a temporary home holding a sentinel at each location: `/bin/cat` of each prints no sentinel and exits non-zero, and `/bin/cp ~/.netrc <scratch>/stolen` fails and leaves no file.
- npm result: `npm config get registry` exits 0 in the real sandbox with HOME set to the temporary home whose `.npmrc` exists and is read-denied. The case ran (not skipped; npm is on /opt/homebrew/bin). So the run host, which keeps the real HOME, will not break `npm test` through the extended list.
- A check that prints `AKIAABCDEFGHIJKLMNOP` stores a check-output artifact holding `[REDACTED:` and not the key id (`redactSecrets` before `artifacts.put`; the stored `$ argv` line is redacted too).
- Allow-list inversion: not done. Reason: node and npm need many system paths, and the triage rates the inversion large and risky. containment.md's limits state that a credential stored elsewhere under the home stays readable. For plan 02-35's disposition.

## Task Commits

1. **Task 1: Tracer, check sandbox and redaction**
   - RED `7d9ebb0` (test): credential describe (twelve reads, copy, npm) and the redaction case
   - GREEN `fa82c9e` (feat): `CREDENTIAL_PATHS`, `credentialPaths`, `sandboxSetup`, `redactSecrets`
2. **Task 2: onboarding and run scopes**
   - RED `831b4a4` (test): scope, settings and hook cases
   - GREEN `aed6e62` (feat): both scopes use `credentialPaths(home)`
   - fix `d19325f` (fix): two hook integration expectations (see Deviations)
3. **Task 3: graphify and GSD adapters, docs/system** - `18a3863` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Both TDD tasks have a `test(02-33)` commit before the GREEN commit. No refactor commits. Task 3 is `type="auto"` without TDD.

- **RED, Task 1** (`02-33-red-evidence-task1.json`): `node --test --test-reporter=tap` on the two integration files at the base. 47 tests, 36 pass, 11 fail: nine credential reads (`.gnupg`, `.netrc`, `.npmrc`, `.docker`, `.kube`, `.config/gcloud`, `Library/Keychains`, `.git-credentials`, `.pgpass`; "printed its content"), the `.netrc` copy ("the copy succeeded"), and the redaction case (the stored artifact held the raw key id). The three original directories and the npm case pass at base, as the plan expects. I did not run `gsd_run check tdd-red-evidence` on these records: the plan's evidence shape (command, ranAgainst, reason, failingTests, semanticAssessment) is the one earlier plans of this phase used, and the semantic assessment is recorded in each file.
- **RED, Task 2** (`02-33-red-evidence-task2.json`): four unit files at the Task 1 commit. 262 tests, 253 pass, 9 fail, all on the nine added entries. The hook case (Read of `~/.netrc` and `~/Library/Keychains/x` is `deny-read`) passes at base because the hook decides from the policy's `denyRead` list; the scope that computes that list is what fails, through the other cases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test expectations that encoded the old three-entry list**
- **Found during:** Task 2 GREEN and the full suite
- **Issue:** (a) test/unit/run-scope.test.ts "trims trailing slashes" read `denyRead[5]` as the work root; with twelve entries it is at index 14. (b) test/integration/claude-host.test.ts and two cases in test/integration/hook.test.ts pinned `cat ~/.netrc` as `outside-read-set`; `.netrc` is a named credential location now, so it is `deny-read` (still denied, by the more precise rule).
- **Fix:** the index is `2 + credentialPaths(HOME).length`; the three expectations name `deny-read` with a comment. No behavior was weakened; both rules deny.
- **Files modified:** test/unit/run-scope.test.ts, test/integration/claude-host.test.ts, test/integration/hook.test.ts
- **Verification:** both integration files pass alone (claude-host 39/39, hook 54/54).
- **Commits:** `aed6e62` (a and claude-host), `d19325f` (hook)

**2. [Rule 2 - Missing critical] config-reference.md named the old list**
- **Found during:** Task 3 docs grep across docs/system
- **Issue:** docs/system/config-reference.md said sandboxed supervisor commands deny "the SSH, AWS and GitHub CLI credential directories", which is now wrong. CLAUDE.md requires the matching document to change in the same change.
- **Fix:** both mentions now say "credential locations" and the first links to containment.md. coverage.md was not touched.
- **Files modified:** docs/system/config-reference.md
- **Commit:** `18a3863`

**Total deviations:** 2 auto-fixed (1 bug in tests, 1 documentation). **Impact:** none on behavior.

## Issues Encountered

- Full suite (`npm test`): 2611 tests, 2553 pass, 55 skipped, 3 fail. Two failures were mine (the hook.test.ts cases above) and are fixed; hook.test.ts then passed alone (54/54). The third was the WR-07 probe case of test/mutation/fail-closed.test.ts (known load-sensitive); alone the file passes 35/35. The full suite was not re-run after the hook fix; the changed file and the fail-closed file were run alone. No SIGTERM, ENOTEMPTY or shell-supervisor failure appeared this time. No other sandbox-related failure appeared.
- The plan-commit ledger file was written under the worktree's git directory by a plain redirect (the combined command was refused by the tool); `git rev-list --count 97dbeef..HEAD` measured 6 before this SUMMARY's own commit.
- The unsandboxed `cat` sanity case in the credential describe uses `spawnSync` on the temporary home; it shows the denial comes from the sandbox, not the file mode.

## Findings for plan 02-35

| Item | Status |
|---|---|
| R-WR-03 (three-entry list at five sites, check output unredacted) | Fixed |
| Allow-list inversion | Not done; reason above |
| A credential stored outside the list | Accepted (T-02-116), in containment.md limits |
| Read permission deny rule for a file-shaped entry | Open, for the owner: the renderer writes every denied root as `Read(<path>/**)`, which names the contents of a directory and does not match a file such as `.netrc`, `.npmrc`, `.git-credentials` or `.pgpass`. The file is still refused by the sandbox `denyRead`, the hook (`deny-read`, covered by a test) and the Read tool's allow list; only the host's own permission-deny layer lacks a rule for those four. The plan said to leave the renderer unchanged. Candidate line for findings.md: `src/adapters/host-claude/settings.ts:109` (the deny list built from `scope.denyRead`). |

docs/system documents changed for plan 02-35's fresh review: containment.md, integrations.md, config-reference.md. coverage.md was not touched.

## Known Stubs

None.

## Threat Flags

None. T-02-114 and T-02-115 are mitigated as planned; T-02-116 is accepted and documented.

## Self-Check: PASSED

- Created files exist: both RED evidence files and this SUMMARY.
- Commits `7d9ebb0`, `fa82c9e`, `831b4a4`, `aed6e62`, `18a3863` and `d19325f` are ancestors of HEAD.
- Verification: run-sandbox-other-profiles, check-validation and executor (75 of 75, credential describe ran, npm case ran); invocation-scope, run-scope, claude-settings, containment-matrix and hook-decision (275 of 275); claude-host (39 of 39); graphify-tool and gsd-adapter (27 of 27); hook (54 of 54); fail-closed alone (35 of 35); `check-boundaries` ok; `tsc -p .` clean; `grep -n "Library/Keychains" docs/system/containment.md` and `grep -n "redact" docs/system/containment.md` match; `grep -c "three credential" docs/system/containment.md` prints 0; `grep -rn "join(options.home, '.ssh')" src/adapters` finds nothing.
