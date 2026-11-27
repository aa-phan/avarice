---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 19
subsystem: security
tags: [hook, privileged-actions, approvals, attended-mode, install-host, prompt-injection, fr-12, fr-14, adr-005, typescript]
status: complete

requires:
  - phase: 04-05
    provides: "the action table (classifyAction) and the policy model the approval gate asks"
  - phase: 04-16
    provides: "approval.requested event shape, apr_ IDs, the approvals table, avarice approve, scope attended:<session id>"
provides:
  - "classifyShellCommand, classifyCommandLine, PRIVILEGED_COMMAND_FORMS, privilegedReason: privileged shell forms named by action with the parameters an approval binds (src/domain/privileged-commands.ts)"
  - "Hook rule privileged:<action> in runs, with policy.denied and approval.requested recorded in the decision transaction (src/hook/pre-tool-use.ts, src/domain/hook-decision.ts)"
  - "Attended mode of the hook entry: --attended --data-root <dir> consumes an approval of scope attended:<session id> in one transaction with the action.started event"
  - "installAttendedHook, ATTENDED_HOOK_MARKER, attendedHookEntry: the marker-scoped settings.json entry written by avarice install-host (src/adapters/host-claude/attended-hook-install.ts)"
  - "consumeApprovalRow, pendingRequestId, PENDING_REQUEST_SQL: the approval statements the ledger and the hook share (src/adapters/sqlite/approval-rows.ts)"
affects: [04-21, 04-37, 04-38]

actuals:
  tokens: 45000
  tasks: 3
  commits: 5
plan_head_before: fa370677178846cd5cc13abb38d3cfe6f9bab5af
plan_head_after: 7438dd7d2796a98bcc37ac3134d723acd216f5f6
commits: 5

tech-stack:
  added: []
  patterns:
    - "Classification before the prefix rules: decideToolCall asks the privileged-form classifier first, so a push is refused as privileged:git.push (with an approval route) and a non-privileged gh form keeps its shell-denied-prefix rule"
    - "An approval binds the target and the NAMES of the options given, never an option's value: a title or body is not bound, --force is"
    - "The hook never prints an allow in attended mode: with nothing printed the host's own permission rules still apply, so an approval never widens what the host asks"
    - "Marker-scoped edit of a file the owner owns: only an entry whose command carries --avarice-attended-hook is replaced; indentation and mode are kept; the write is temp-and-rename"

key-files:
  created:
    - src/domain/privileged-commands.ts
    - src/adapters/sqlite/approval-rows.ts
    - src/adapters/host-claude/attended-hook-install.ts
    - test/integration/hook-privileged.test.ts
    - test/integration/untrusted-authority.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-19-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-19-red-task2.json
  modified:
    - src/domain/hook-decision.ts
    - src/domain/action-class.ts
    - src/hook/pre-tool-use.ts
    - src/adapters/sqlite/ledger.ts
    - src/cli/commands/install-host.ts
    - test/unit/hook-decision.test.ts
    - test/unit/action-class.test.ts
    - test/mutation/fail-closed.test.ts

key-decisions:
  - "A privileged shell form is classified by reading the whole command line (every command of it, each `;`, `&&`, `||`, `|`, newline, parenthesis, backtick and substitution, also inside double quotes), not only the single-segment form the run lexer accepts, so `cd x && git push` and `echo $(git push)` are named as git.push and not just refused for their syntax"
  - "In a run the hook never consumes an approval: a privileged form is always denied with the request the owner approves, so an approval never widens a run's command set (delivery of privileged effects for runs is AVARICE's own Phase 5 step); a retry after approval still gets a denial and a fresh request"
  - "In attended mode the hook prints no allow after consuming an approval: it exits 0 with no output and the host's own permission rules decide, so AVARICE's approval is a gate and never a grant"
  - "gh api with a method other than GET (or with fields or --input and no method, which gh makes a POST) is the action scm.api.write, added to the action table as privileged"
  - "The attended hook opens the store only for a privileged form: any other call is allowed with no read, no event and no store, so a broken profile blocks privileged forms (exit 2) and never the owner's other work"
  - "The shared approval statements moved to a lean module (approval-rows.ts) that the ledger and the hook both call, so an approval is consumed by one piece of SQL whichever process takes it"

patterns-established:
  - "Skeleton-first RED for a hook feature: the planned exports exist with no behavior so the real hook entry fails on its assertions and not on a missing module"
  - "A test that cannot be red because the behavior is already built (task 3) is shown to discriminate by a mutation of the committed source, restored with git checkout of that one file"

requirements-completed: [FR-12, FR-14]

coverage:
  - id: D1
    description: "The hook classifies git push (and its spellings: -C, -c, env, a leading assignment, a directory-qualified or upper-case program, sudo, a compound or substituted command), gh pr create, merge and edit, gh release create, gh api with a non-GET method, and npm publish to an action of the action table; reads such as gh pr view and git status are not privileged"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#the classification table (FR-12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "S-7: in a run, gh pr create is denied with rule privileged:scm.pr.create and a reason naming `avarice approve apr_...`, and policy.denied and approval.requested (scope = run ID, action, digest of the parsed parameters, no command text) are recorded beside the hook.decision; a retry names the waiting request"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#tracer: in a run, gh pr create is denied as privileged with the approve hint and recorded (FR-12, S-7)"
        status: pass
    human_judgment: false
  - id: D3
    description: "In an attended session with the hook installed, a privileged form is denied with the approve hint until the owner approves it, then allowed once with the approval consumed in the same transaction as action.started; another session, other options or another refspec, and a revoked approval are not covered; non-privileged calls are allowed with no event"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#attended mode: a privileged form is denied until the owner approves it, then allowed once (FR-12, S-4)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Any hook error in attended mode exits 2 (missing or unreadable store for a privileged form, malformed input, a missing session, a bad --data-root, missing --event, both modes), and an attended hook never refuses a settings change or a post-call event"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#attended mode fails closed (CON-3)"
        status: pass
    human_judgment: false
  - id: D5
    description: "avarice install-host writes the attended PreToolUse entry into settings.json beside the skill, idempotently, preserving every other key and entry byte for byte with the file's indentation and mode, replacing only the marked entry, refusing a symlinked or malformed settings.json (exit 3), and recording host-hook:attended"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#avarice install-host writes the attended hook entry beside the skill (FR-12, T-04-52)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Text in a brief, a context pack item (an ADR node) or tool output that claims an approval or permission to push changes no hook decision and creates no approvals row: the unit's push and pull request are denied as privileged, the contract row count, policyRevision and policy answers are unchanged, and the ADR sentence reaches the prompt only inside the untrusted-data fence"
    requirement: FR-14
    verification:
      - kind: integration
        ref: "test/integration/untrusted-authority.test.ts#retrieved text grants no authority"
        status: pass
    human_judgment: false

duration: 60 min
completed: 2026-11-17
---

# Phase 4 Plan 19: Privileged actions at the hook Summary

**Privileged shell forms (git push, gh pr create/merge/edit, gh release create, gh api writes, npm publish) are named by action and denied with the rule `privileged:<action>` and the `avarice approve <apr id>` hint, in runs and in attended sessions; an attended session consumes one parameter-bound approval; `install-host` writes the attended hook entry; and no retrieved text can approve anything.**

## Accomplishments

- `privileged-commands.ts` (pure): reads a whole command line and names the action and the parameters an approval binds (remote and refspec; base and head; selector; tag and target; endpoint and method; the names of the options given, never their values). `decideToolCall` asks it before the prefix rules, so a push is `privileged:git.push` while `gh pr view` keeps `shell-denied-prefix`.
- Run mode: the hook entry records `approval.requested` (or names the request still waiting) and `policy.denied` in the decision transaction and puts `avarice approve <apr id>` in the denial reason. An approval is never consumed in a run.
- Attended mode (`--attended --data-root <dir>`): Bash calls only; a privileged form consumes an approval of scope `attended:<session id>` in one transaction with `action.started`, or is denied with a new request; everything else is allowed with no event and no store access; every error exits 2.
- `installAttendedHook` and `install-host`: one `PreToolUse` entry with matcher `Bash`, identified by `--avarice-attended-hook`; only that entry is replaced; other keys, other entries, indentation and mode are kept; symlink, malformed file and mixed entry are refused (exit 3).
- `untrusted-authority.test.ts`: a real run with a hostile brief and an injected ADR node, the unit tries `git push origin main` and `gh pr create`; both are denied, nothing is approved, nothing about the contract or policy moves.
- The approval consume and pending-request statements now live in `approval-rows.ts`, used by the ledger (04-16 behavior unchanged, its 04-16 tests pass) and by the hook.

## Task Commits

1. **Task 1: tracer, S-7 in a run** — RED `6ecd0d8` (12 of 15 failing, `RED_EVIDENCE_OK`), GREEN `4840cef`
2. **Task 2: attended mode and its installation** — RED `3ee3aa7` (17 of 35 failing, `RED_EVIDENCE_OK`), GREEN `956e434`
3. **Task 3: retrieved text grants no authority** — `7438dd7` (tests; see deviation 2)

Plan metadata (this summary, STATE, ROADMAP, REQUIREMENTS) is committed separately.

## TDD

- **Task 1 RED:** skeleton classifier returning null; the real hook entry denied by `shell-denied-prefix` where `privileged:scm.pr.create` was planned. Typecheck clean.
- **Task 2 RED:** skeleton installer returning "not implemented"; the hook ignored `--attended` and exited 2. 17 of 35 failed on assertions.
- **Task 3:** green on first run (the behavior was built by tasks 1 and 2). It was shown to discriminate by turning the classification off in `decideShell`: 2 of 6 cases failed (the rule names and the approval.requested count); the source was restored with `git checkout` of that one file and the 6 pass.
- No REFACTOR commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Five existing expectations named the old prefix rule for a push**
- **Found during:** Task 1
- **Issue:** `test/unit/hook-decision.test.ts` (four assertions) and `test/mutation/fail-closed.test.ts` (one) asserted `shell-denied-prefix` or `shell-syntax` or `shell-not-allowed` for `git push` forms. The plan makes a push `privileged:git.push` before the prefix rules, so the rule name changes; the call is still denied. `hook.test.ts` (the plan's "existing hook tests pass unchanged") passed untouched.
- **Fix:** the assertions now expect `privileged:git.push` (a chained `npm test && git push` is also named as the push, no longer `shell-syntax`).
- **Files modified:** test/unit/hook-decision.test.ts, test/mutation/fail-closed.test.ts
- **Commit:** 4840cef

**2. [Rule 3 - Blocking] Task 3 tests cannot be red against Task 1 and 2's GREEN**
- **Found during:** Task 3
- **Issue:** the behavior Task 3 asserts (a run denies the push as privileged, nothing creates an approval) was built by Tasks 1 and 2, so the new cases pass on first run; Task 3 has no implementation left to commit.
- **Fix:** shown to discriminate by mutation (see TDD). One `test(04-19)` commit, no `feat` commit.
- **Commit:** 7438dd7

**3. [Rule 2 - Missing critical] `scm.api.write` added to the action table**
- **Found during:** Task 1
- **Issue:** `gh api` with a write method has no action in the table (`scm.pr.update` and `scm.comment.create` are narrower than "any change the platform allows").
- **Fix:** `scm.api.write: privileged` in `src/domain/action-class.ts` and in the unit test's list. An unlisted name is privileged anyway, so no class changes; the table now documents it.
- **Commit:** 4840cef

**4. [Plan deviation] `hook-policy.ts` unchanged; the shared SQL moved**
- `src/adapters/host-claude/hook-policy.ts` is in the plan's file list but needed no change: the attended command line is built in `attended-hook-install.ts`. The approval consume and pending-request SQL moved from `ledger.ts` into the new `approval-rows.ts` so the hook (which must stay lean) runs the identical statements; 04-16's approval tests (unit, integration, fault) pass unchanged.
- `installAttendedHook` returns `Result<{ status, path, digest }>` (not the bare status the plan's signature shows) because install-host records the digest as `host-hook:attended`.

**Total deviations:** 4 (1 bug-fix of expectations, 1 blocked-red, 1 missing-critical, 1 shape). **Impact:** none on the plan's goal.

## Decisions needing owner review

1. **The hook path does not enforce `approvalSource` and does not evaluate policy rules (the 04-16 gap is not widened, and not closed).** The hook is lean (it imports no application layer), so it asks no `evaluatePolicy`. In a run every privileged form is denied, so nothing is consumed. In attended mode it consumes any usable approval row of the scope, action and parameter digest; `grantApproval` writes only `source = local-user` rows, so an `approvalSource` other than `local-user` is not consulted (as in 04-16's `authorizeAction`). A user, organization or repository policy `deny` rule for `git.push` is also not consulted in the attended hook: an approved push is allowed there. Closing it means passing the evaluated policy to the hook (a file the profile writes) or moving the decision into a command the hook calls.
2. **Attended consume leaves `action.started` with no `action.finished`.** Only the `PreToolUse` entry is installed; no `PostToolUse` entry ends the action. Under `reconcilePrivilegedSteps` such a start looks interrupted, but nothing reconciles an `attended:` scope today. Decide whether to install a `PostToolUse` entry that writes the end.
3. **The attended entry sets `onFailure: "block"` and `timeout: 5`**, as the run settings do. A hook that times out blocks the owner's Bash call in their own session.
4. **An approval binds the target and the option NAMES, not values, and not the directory.** `git push --force origin main` needs its own approval; `gh pr create --title a` and `--title b` share one; `git -C other push origin main` shares the approval of `git push origin main` (the hook does not bind `-C` or `cwd`).
5. **`npm publish --dry-run` is classified privileged** (fail closed), as is every `gh api` that is a POST by default.
6. **Forms not in the plan stay unclassified:** `gh pr close/comment/review`, `gh issue create`, `pnpm publish`, `yarn npm publish`, `git push` through an alias, and `bash -c '<computed string>'` (the documented bypass, T-04-53). In a run, `gh` stays refused by prefix; in an attended session they are allowed.
7. **`install-host` writes the skill first.** A refused settings.json leaves the skill in place and exits 3 with a message that says so.

## Documentation surfaces (for plans 04-37 and 04-38)

- **Rule IDs:** `privileged:git.push`, `privileged:scm.pr.create`, `privileged:scm.pr.merge`, `privileged:scm.pr.update`, `privileged:release.publish`, `privileged:scm.api.write` (the hook decision rule and the `policy.denied` rule). Run denials of other forms keep `shell-denied-prefix`.
- **Action table:** `scm.api.write` (privileged).
- **Parameters an approval binds, per form:** git push (`remote`, `refspec`, `repo`, `options`), gh pr create (`base`, `head`, `repo`, `options`), gh pr merge and edit (`selector`, `base`, `repo`, `matchHeadCommit`, `options`), gh release create (`tag`, `target`, `repo`, `assets`, `options`), gh api (`endpoint`, `method`, `hostname`, `options`), npm publish (`package`, `registry`, `tag`, `access`, `options`).
- **Hook entry flags:** `--event pre|post|config-change`, `--policy <file>` (run mode), `--attended`, `--avarice-attended-hook` (marker, no meaning to the hook), `--data-root <abs dir>` (the ledger is `<dir>/state.db`). `--attended` with `--policy`, without `--data-root`, with a relative root or without `--event` exits 2; `--event post` and `config-change` in attended mode exit 0 and do nothing.
- **Settings entry:** `hooks.PreToolUse[]` item `{ matcher: "Bash", hooks: [{ type: "command", command: "<node> --disable-warning=ExperimentalWarning <hook entry> --event pre --attended --avarice-attended-hook --data-root <data root>", timeout: 5, onFailure: "block" }] }` in `<claude config dir>/settings.json`, file mode 0600 when created, existing mode and indentation kept. Hook entry path: `AVARICE_HOOK_ENTRY` or this checkout's `src/hook/pre-tool-use.ts`.
- **install-host:** a second output block `hook attended: installed|unchanged|updated` with `path:` and `digest:`; adapter config `host-hook:attended` (port `host-hook`, adapter `claude-code-hook`); exit 3 for a symlinked, non-JSON, non-object, wrongly shaped or mixed settings.json.
- **Events:** `policy.denied` (warn; `ruleId`, `action`, `scope`, `runId` when a run, `requestId`, `tool`, `paramsDigest`, `target` = bounded redacted parameter summary, `source: "hook"`), `approval.requested` (as 04-16, `ruleId` `privileged:<action>`; attended events carry no run ID), `action.started` with `source: "approval"` and `approvalId` for an attended consume.
- **Attended mode behavior:** Bash calls only; a privileged form is denied with `avarice: privileged:<action>: <action> needs an approval for these parameters; the owner approves it at a terminal with: avarice approve <apr id>`; after approval the same call (same session, action and parameters) passes once, with no output, and the host's own permission rules still apply; the store is opened only for privileged forms; session IDs must match `[A-Za-z0-9_.-]{1,100}`.
- **Documented bypass (T-04-53, ADR-005, SEC-6 enforcement map):** a command name built from a variable or an alias, a script or function that pushes, and `bash -c` over a computed string are not classified; the sandbox (no network, no credentials) and the SCM platform's protections are the controls that hold.
- **Quirk:** in a run, a retry after the owner approves is still denied and records a fresh request (delivery of privileged effects for runs is Phase 5).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-04-50 to T-04-53 are covered by the tests named in the coverage block; T-04-53 is the accepted bypass above).

## Verification

- `node --test test/integration/hook-privileged.test.ts test/integration/untrusted-authority.test.ts test/integration/hook.test.ts test/integration/install-host.test.ts`: 112 of 112 pass.
- `npm run test:unit`: 2685 of 2685 pass. Also run and green: the hook, approvals, approval-consume, privileged-no-replay, run-loops, claude-host, transcript-retention and fail-closed suites.
- `npm run typecheck` clean; `npm run check:boundaries` ok (116 files).
- The full `npm test` (about 23 minutes) is the orchestrator's.

## Self-Check: PASSED

All seven created files exist; the five commits (6ecd0d8, 4840cef, 3ee3aa7, 956e434, 7438dd7) are on the branch.
