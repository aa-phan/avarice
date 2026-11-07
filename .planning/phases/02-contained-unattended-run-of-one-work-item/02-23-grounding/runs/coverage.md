# Coverage: docs/system/runs.md (new)

Run at HEAD 6f825cee5b8e3a841fed56b60e43907fa69d8429 on 2026-11-06, diff base e725db6. For every `code:` file the diff `e725db6..HEAD` was read and the file at HEAD.

## Files of the packet (31 of 31)

- `src/adapters/git/run-source.ts`: covered (conventions read from a descendant commit, staleness, file presence at the pin). New file in the diff.
- `src/adapters/git/run-workspace.ts`: covered (clone, snapshot, discard, commit and its trailers, hand-off fetch, trailer reading). New file.
- `src/adapters/gsd/agents-json.ts`: covered (generated agents file, executor-only addendum). New file.
- `src/adapters/host-claude/claude-host.ts`: covered in part. Documented: the run purpose needs a run owner, the launch starts in the clone's canonical path, `resultSeen` and `isError` reach the classifier. No documentable behavior for this document in the rest of the hunk (the owner directory naming, the environment marker and the scratch variable); passed to containment in seams.md.
- `src/adapters/sqlite/ledger.ts`: covered in part. Documented: the single transaction of run, contract, budgets and item; the transition table check, reason rule and fence check; the lease methods; per-name step replacement; attempts. Tables, columns and events left to data-model (seams.md).
- `src/app/budget.ts`: covered (five run budget rows, reservation, orphan charge, charge at resume).
- `src/app/invocation.ts`: covered in part. Documented: reserve before launch, `launch` step started, scope computed before reserving, run retention. No documentable behavior beyond a pointer for the scope inputs and scratch directories (containment).
- `src/app/run-gsd-config.ts`: covered (seven settings, prompt shape and cap, no-commit sentence).
- `src/app/run-resume.ts`: covered.
- `src/app/run-service.ts`: covered.
- `src/app/run-stages/blocked.ts`: covered.
- `src/app/run-stages/discard.ts`: covered.
- `src/app/run-stages/finish.ts`: covered.
- `src/app/run-stages/item.ts`: covered.
- `src/app/run-stages/prepare.ts`: covered.
- `src/app/run-stages/stage.ts`: no documentable behavior beyond the stage contract (a checkpoint and a transition that carry the fence); stated under "Supervisor and lease".
- `src/app/run-start.ts`: covered.
- `src/app/run-status.ts`: covered.
- `src/cli/commands/resume.ts`: covered (run branch; the onboarding branch is onboarding.md's).
- `src/cli/commands/start.ts`: covered.
- `src/cli/commands/supervise.ts`: covered.
- `src/cli/spawn-supervisor.ts`: covered.
- `src/domain/brief.ts`: covered (format, limits, validation).
- `src/domain/conventions.ts`: covered as meaning only; key list and limits left to config-reference.
- `src/domain/gates.ts`: covered in part. G2 and G4 rule lists are checks-and-evidence's; documented where each gate runs and what a failure does.
- `src/domain/invocation-scope.ts`: no documentable behavior for this document beyond the run skill and agents, the loop limits and the subagent cap named as carried into the scope; scope computation is containment's (seams.md).
- `src/domain/outcome.ts`: covered.
- `src/domain/quick-record.ts`: covered.
- `src/domain/run-contract.ts`: covered.
- `src/domain/run-lifecycle.ts`: covered.
- `src/domain/run-preflight.ts`: covered.

## Alive, dormant, dead

- Alive (wired): the commands `start`, `supervise` and `resume` are in the command list (`grep -n "COMMANDS" src/cli/main.ts`); the three stages are registered (`grep -n "registerRunStage(" src/app/run-service.ts`, 3 matches); the run workspace and the run source are built in the composition root (`grep -n "CloneRunWorkspace\|GitRunSource" src/cli/composition.ts`).
- Dead states: no transition into `waiting_external`, `awaiting_review`, `failed`, `cancelled` or `closed`: `git grep -n -E "transition\(.*'(waiting_external|awaiting_review|closed|cancelled|failed)'" -- src/app src/cli` has no match (exit 1). `awaiting_review` appears only as a read in `src/app/run-status.ts:267`.
- Dead blocked reasons: `git grep -n -E "unauthenticated|ref_changed|ref_deleted|access_revoked" -- src` finds only the lifecycle definition, an error kind in `src/domain/result.ts:9` and an unrelated freshness value.
- Dead pause signal: `git grep -n stateNeedsHuman -- src` finds only the definition and the check in `src/domain/outcome.ts`; no caller passes it.
- Dead step status for runs: `git grep -n "'reconciled'" -- src` finds the lifecycle table and the onboarding resume only.
- Read-only: `expectedDecisions` is stored and unread: `git grep -n expectedDecisions -- src`.
- Dormant: none found in the run path. The edges out of `blocked_on_decision` exist in the table and are not driven (see the dead-states command; the stages and commands have no call that moves a blocked run).

## Documented counts (N of M)

- Run states: 11 of 11, transitions 37 of 37: `node --input-type=module -e "import('./src/domain/run-lifecycle.ts').then(m=>console.log(m.RUN_STATES.length,m.RUN_TRANSITIONS.length))"` prints `11 37`.
- Blocked reasons: 7 of 7 (`m.RUN_BLOCKED_REASONS.length` with the same import), 3 of 7 recorded by the stages (the proof above).
- Run step statuses: 6 of 6 (`m.RUN_STEP_STATUSES.length`). Work item states: 6 of 6 (`m.WORK_ITEM_STATES.length`).
- Start refusal codes: 10 of 10: 4 distinct codes in `src/app/run-start.ts` (`grep -n "refused('" src/app/run-start.ts` shows 5 call sites, `conventions-invalid` twice) plus 6 in the `PreflightCode` union (`grep -n "export type PreflightCode" src/domain/run-preflight.ts`).
- Next actions: 6 (contract_ready), 6 (running), 3 (verifying), 1 (paused) of 6, 6, 3, 1: `m.RUN_NEXT_ACTIONS` with the same import.
- Overridable budget names: 7 of 7: `import('./src/domain/run-contract.ts')` then `BUDGET_OVERRIDE_NAMES.length`.
- GSD settings: 7 of 7: `import('./src/app/run-gsd-config.ts')` then `RUN_GSD_SETTINGS.length`.
- Budget rows: 5 of 5: `grep -n "name:" src/app/budget.ts` within `budgetRowsOfRun` (invocations, toolCalls, subagentsTotal, wallClockMs, costUsd).
- Contract top-level keys: 16 of 16: compiled a sample contract with `compileRunContract` and printed `Object.keys(contract).length`.
- Brief frontmatter keys: 5 of 5 and sections 5 of 5: `grep -n "FRONTMATTER_KEYS\|const SECTIONS" -A6 src/domain/brief.ts`.
- Outcome kinds: 7 of 7: `grep -n "export type ClassifiedKind" src/domain/outcome.ts`. Decision classes: 4 of 4: `grep -n "export type RunDecisionClass" src/app/run-stages/blocked.ts`.
- Gate rules (owned elsewhere, named in seams only): G2 8, G4 7: `import('./src/domain/gates.ts')` then `G2_RULES.length`, `G4_RULES.length`.
- Plan-base counts from the worklist (11 states, 37 transitions, 7 reasons, 6 step statuses, 6 item states) match HEAD.

## Not checked

- No test was run and no run was executed; every claim rests on reading code at HEAD. Evidence files (`test/containment/*.jsonl`, `LIVE-CASES.md`, red-evidence and exit-evidence files, spend ledgers) were not opened.
- Not read: `src/app/check-validation.ts`, the rest of `src/app/checks.ts` (read lines 325 to 390 only), `src/cli/render/run-view.ts`, `src/app/context.ts` (the context query), the hook entry and settings generator, `src/adapters/git/staging-clone.ts` beyond the confirmation that the run clone reuses its clone helper.
- The `docs/system` siblings were read for shape and for the claims this document must not repeat; `checks-and-evidence.md` does not exist at HEAD.
- The proposals were read only at the lines cited in findings.md.

## Verification of the read-only claim

`git status --porcelain --untracked-files=all` run at the end shows only the package directory (recorded in the receipt).
