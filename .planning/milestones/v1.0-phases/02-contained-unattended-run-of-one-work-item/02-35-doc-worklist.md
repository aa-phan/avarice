# Worklist for the gap-closure documentation pass (plan 02-35)

Plan base: 40adc1f (HEAD when the plan started; the last code change of the round is 9ca3b92 and the last test change 1f0b131).
Diff base: 2ac2b63 (the planning commit before plan 02-27's first commit). `git diff --stat 2ac2b63 HEAD -- src scripts test` lists 61 files; `-- docs/system` lists 8.

This file is working material for the executor and the reviewers, not a `docs/system/` document, so plan IDs, commits and file paths appear freely here and never in the documents. Every row was checked against the code at the plan base. "Current" means the docs/system section states the behavior as the code has it.

## Changed surfaces

| # | Surface | Source (commit, file:line) | docs/system section | Current? |
|---|---|---|---|---|
| 1 | A git object name is matched against the secret globs as written (`.` removed, `..` applied on the string), from the working copy root and from the shell's directory, before the canonical check; a name above the root is `outside-read-set` | 0b35653, `src/domain/normalized-root.ts:12`, `src/domain/hook-decision.ts:527` | containment.md, "Read rules" (object-name paragraph) and rule 12 | yes (edited by 02-27) |
| 2 | One git operand walker for the object check and the output check; every operand of the option grammar is judged as an object name; `M` dropped from the `git status` value letters | 06ee1fe, `src/domain/hook-decision.ts:608` | containment.md, rule 13 and the check-order list (step 5) | yes (02-27) |
| 3 | Corrective reasons on `shell-git-output` and `shell-git-object`, printed after the rule | 06ee1fe, `src/domain/hook-decision.ts` (GIT_RULE_REASONS) | containment.md, paragraph after rule 13 | yes (02-27) |
| 4 | `git show <revision>:.env` refused even when the revision stores a symlink there (deliberate over-deny) | 0b35653 | containment.md rule 12 and Quirks | yes (02-27) |
| 5 | The model has no admitted way to change directory (S-IN-01 skipped) | 02-27 | containment.md rule 12 | yes (02-27) |
| 6 | The canonical-comparison exception for git object names | 0b35653 | containment.md, "The PreToolUse hook" paragraph on canonical comparison | yes (02-27) |
| 7 | `onboard`, `resume` and `supervise` print outcome, note and error lines through one printer; every line is stripped | 04bed71, `src/cli/render/style.ts:36` | cli-reference.md, "Output style" | yes (02-28) |
| 8 | The stripped class holds the full invisible-format set; the soft hyphen stays | 6a47d78, `src/cli/render/style.ts:18` | cli-reference.md, "Output style" | yes (02-28) |
| 9 | Commit ids are 40 lowercase hex digits; a SHA-256 repository is refused at the first commit read, naming the object format at run start | 8cefde8, `src/adapters/git/staging-base.ts:24`, `src/adapters/git/run-source.ts` (head) | integrations.md, "Staging and run clones" and "Run source" | yes (02-29) |
| 10 | The oldest commit time is a single-pass minimum, so staleness does not throw on a long history | 808467b, `src/adapters/git/run-source.ts:22` | none: internal; no documented claim depended on it | not needed |
| 11 | Clone paths are split at a slash only (a backslash is part of a name) | 808467b, `src/adapters/git/staging-base.ts:89` | integrations.md, "Run workspace" commit bullet | filled by this plan (gap) |
| 12 | `--allow-run-refs` of the checkout digest script allows exactly one segment under the run prefix | 2e0bda1, `scripts/checkout-digest.ts:39` | none: a verification script, not part of the built system's surfaces | not needed |
| 13 | The run's abort signal is aborted when the supervisor loses its lease; the unit is stopped, the invocation stays charged, nothing is classified, discarded or retried | ce09fa9, `src/app/run-service.ts:138`, `src/app/run-service.ts:161`, `src/app/run-stages/item.ts:532` | runs.md, "Supervisor and lease"; containment.md, host paragraph | runs.md yes (02-30); containment.md sentence filled by this plan (02-30 asked for it) |
| 14 | A started launch that cannot be reaped (no session ID, or a host with no reap) stops the resume with every row still started | b44e22c, `src/app/run-resume.ts:83` | runs.md, "Resume and reconcile" step 1 | yes (02-30); integrations.md "Reaping by session ID" and processes.md step 4 and the quirk filled by this plan (they still said the step was skipped) |
| 15 | A gated item's moved HEAD is the supervisor's commit only with matching trailers and one parent equal to the snapshot head | b44e22c, `src/app/run-stages/item.ts:436`, `src/ports/run-workspace.ts:107` | runs.md, resume bullet for a gated item | yes (02-30); integrations.md commit bullet filled by this plan (parents read back) |
| 16 | SIGTERM ends the supervisor without aborting its unit's host (accepted, T-02-108) | none (no handler exists) | runs.md, Quirks | yes (02-30); findings.md line added by this plan |
| 17 | The live recorders write the home directory as `~`; `cleanupAttended` checks real paths; the attended allow list is narrowed | 8807d4a, b4f7a64, f148e3d, `test/helpers/live-attended.ts` | none: test harness and committed evidence only | not needed (confirmed: 02-31 changed no docs/system document) |
| 18 | The wider home-path residue in spike evidence and planning files | none | none: deferred to the owner's public-release decision, recorded in the disposition file | not needed |
| 19 | `settleBudgets`: a settlement and an orphan conversion with its event commit in one transaction | 18d8e89, `src/ports/ledger.ts:593`, `src/adapters/sqlite/ledger.ts:679`, `src/app/budget.ts:115` | containment.md, "Settlement"; data-model.md, budgets list; processes.md, step 10 | yes (02-32) |
| 20 | An ending without a result event (a crash) is charged its cost reservation | e283a45, `src/app/invocation.ts:153` | containment.md, "Settlement"; processes.md, discard flow step 1 and step 10 | yes (02-32) |
| 21 | One list of twelve credential locations feeds the host sandbox of onboardings and runs, the check sandbox, the graph and GSD tool sandboxes and the hook | fa82c9e, aed6e62, 18a3863, `src/domain/invocation-scope.ts:387`, `src/domain/invocation-scope.ts:403`, `src/app/checks.ts:121`, `src/adapters/graph/graphify.ts:92`, `src/adapters/gsd/gsd-onboarding.ts:106` | containment.md ("Generated settings", "Read rules", executor, Limits); integrations.md ("Verbs driven", `gh`); config-reference.md (`HOME` row, Limits) | yes (02-33) |
| 22 | The output of each declared check is redacted before it is stored | fa82c9e, `src/app/checks.ts:228` | containment.md, "Secret redaction" and the check posture bullets | yes (02-33); checks-and-evidence.md ("not filtered" in two places) filled by this plan |
| 23 | A credential stored outside the list stays readable (accepted); the allow-list inversion was not done | 02-33 | containment.md, Limits "Credentials stored elsewhere" | yes (02-33) |
| 24 | The Read permission deny rule names the contents of a directory, so it does not match a file-shaped credential | `src/adapters/host-claude/settings.ts:109` | none: a defect candidate | findings.md line added by this plan |
| 25 | The install proxy resolves an allowlisted name itself, refuses a name with any non-public address (403, recorded refused), connects to the vetted address | 9ca3b92, `src/adapters/exec/allowlist-proxy.ts:91` | containment.md, "Egress proxy" bullets and Limits; integrations.md, proxy response table and paragraph, Failure table | yes (02-34) |
| 26 | The conventions refuse `localhost`, names under it, single-label names, and names whose last label is all digits or a `0x` form as registry hosts | 1f0b131, `src/domain/conventions.ts:224` | config-reference.md, `registryHosts` row | yes (02-34) |
| 27 | A registry on a private network is unsupported | 9ca3b92, 1f0b131 | containment.md Limits; integrations.md Quirks; config-reference.md | yes (02-34); findings.md line added by this plan (owner to confirm) |
| 28 | The proxy module imports `node:dns/promises`; the resolver seam stays out of production | 9ca3b92, `test/unit/footprint.test.ts` | none: a test pin | not needed |

## Gaps found and filled

1. containment.md host paragraph: the lease-loss sentence (row 13).
2. containment.md, check posture bullets: the Output bullet had been joined to the Reads bullet on one line (a formatting defect from the credential edit); split into two bullets.
3. integrations.md, "Reaping by session ID": an onboarding's resume skips the reap for a host with no reap capability; a run's resume stops (row 14).
4. processes.md, run resume step 4: the "host without a reap capability skips the end step" sentence replaced by the stop; the quirk on a refusing host now says it is the onboarding resume.
5. integrations.md, "Run workspace": the slash-only split and the parents read back with the trailers (rows 11 and 15).
6. checks-and-evidence.md: the artifact paragraph and the quirk said check output is stored unfiltered; both now state the redaction and its limit (row 22).

## findings.md changes

New lines:
- `src/app/run-stages/finish.ts:206`: `test:<text>` acceptance matches a test ID by substring; the proposal shows exact IDs. Spec contradiction, owner to decide (review item IN-07 deferred).
- `src/app/stages/map.ts:57`: the onboarding map invocation's only abort signal is a wall-clock timeout; the run unit's counterpart also aborts on lease loss. Intent unknown.
- `src/cli/commands/supervise.ts:35`: SIGTERM ends the supervisor without aborting its unit's host. Intent unknown.
- `src/adapters/host-claude/settings.ts:109`: Read deny rules are `Read(<path>/**)` and do not match file-shaped credential entries (candidate from 02-33).
- `src/adapters/exec/allowlist-proxy.ts:91`: private-network registries are unsupported; owner to confirm (flagged assumption from 02-34).
- Two lines under "Known load-sensitive tests": the `after` cleanup of `test/integration/run-start.test.ts` (ENOTEMPTY, seen in 02-28 and 02-29) and `test/integration/shell-supervisor.test.ts:111` (seen once in 02-32).

Removed (the described behavior changed this round):
- `src/adapters/exec/allowlist-proxy.ts:95`: "the proxy connects to the allowlisted name without checking the address it resolves to" (02-34 fixed it).
- `src/app/checks.ts:217`: "check stdout and stderr are stored in the artifact with no redaction" (02-33 fixed it).

Reworded:
- `src/app/checks.ts:120`: the line now says the sandboxed supervisor commands deny the credential locations, the data root and the default parents.

Re-anchored (the old line had already drifted before the round):
- `src/app/invocation.ts:158` is now at `src/app/invocation.ts:177` (the settlement that runs after a refusal); `src/app/budget.ts:74` is now at `src/app/budget.ts:115` (the orphan charge, which still carries no wall clock).

Annotated `(now at file:line)`: every citation of a changed file whose line moved, found by mapping each cited line through the diff hunks from 2ac2b63 to HEAD (42 new annotations, in `onboard.ts`, `ledger.ts`, `graphify.ts`, `hook-decision.ts`, `budget.ts`, `run-workspace.ts`, `item.ts`, `conventions.ts`, `checks.ts`, `invocation-scope.ts`, `invocation.ts`, `run-source.ts`). Citations to `hook-decision.ts` that an earlier annotation already named ("now at") were updated in place. The line that plan 02-27 wrote about the git object bypass already cites the current lines (`hook-decision.ts:656`, `:527`) and was left alone. The citation `test/integration/claude-host.test.ts:704` is now `:705`.

## README tables

No document was added or renamed in this round, so the documents table and the proposal counterparts table of README.md are unchanged. Confirmed by `git diff --stat 2ac2b63 HEAD -- docs/system/README.md` (empty) and by the file list of docs/system.

## Documents changed in the round, grouped for review

- A: containment.md, findings.md
- B: integrations.md, config-reference.md
- C: runs.md, processes.md, data-model.md, checks-and-evidence.md
- D: cli-reference.md (README.md did not change)
