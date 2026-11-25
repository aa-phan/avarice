# Plan 04-68 documentation worklist

Hand-off to plan 04-69 (README tables, `coverage.md`, `findings.md`, fresh reviews). Written from the code at HEAD `a5b09f8` (the docs commit of Task 1); the last commit that touched `src` is `2bd1e03`. The documents below were changed in commits `f06df42` (plan 04-56), `424ab25` and `90d33c3` (plan 04-67) and `a5b09f8` (this plan). The gap-plan code diff is `git diff --stat 96a0718..HEAD -- src` (13 files, 754 insertions, 121 deletions; 96a0718 is the commit `coverage.md` was last counted at). `git diff --stat ed9e123..HEAD -- docs` shows `docs/system/` files and, from plan 04-65 only, `docs/decisions/ADR-017-ac8-brief-coverage.md` and `docs/operations-and-testing.md`. No proposal document was edited to match the code.

Review groups for plan 04-69: A is the six documents plan 04-67 changed; B is the four documents Task 1 of this plan changed. None of the ten is reviewed yet; every one is `drafted` until a fresh `technical-writer:prose-reviewer` has read it.

## Documents changed

| Document | Sections touched | Review group |
|---|---|---|
| `policy-and-approvals.md` | Parameters and digest (plan 04-56, `f06df42`); Privileged commands in the hook: what the classifier reads, three outcomes, what the classifier cannot see; Enforcement map rows `privileged-approval` and `profile-isolation` and the note after the table | A |
| `containment.md` | Layers table (Privileged commands row); Restricted mode (what a restricted run does); the default AVARICE parents paragraph (root list, whole-root denial); the privileged rule-name paragraph; Events the hook records; Broad discovery (brace-glob reason); Limits of containment (Another profile's roots, Command classification) | A |
| `diagrams/approve-privileged-action.puml` | the run branch and the attended unapprovable branch | A |
| `processes.md` | Approve a privileged action, steps 2, 3 and 4 | A |
| `cli-reference.md` | approve (description and output paragraph); context JSON field table, `items` row (`format`) | A |
| `data-model.md` | Profile roots table, config home row (bindings lock rules); the `policy.denied` event row | A |
| `runs.md` | Restricted runs, the paragraph on the run's end and its patch (any name left out literally, in-scope edits kept) | B |
| `profiles-and-credentials.md` | Selecting a profile, the binding registry's lock paragraph (four takeover cases, 60-second fallback, takeover residual); Roots and isolation, Moved-root denial and What stays open (a corrupt config has its whole root denied); Quirks (the lock line) | B |
| `integrations.md` | the `pgrep` and `ps` row and the unconfined-tools list (the lock holder's start); Run workspace (new Patch bullet with `excludePaths`); the failure table (new `ps` row for the lock) | B |
| `indexes-and-context.md` | Reuse and access (the five cache misses in order, the item format, when it is raised, the retry report's reuse part) | B |

## Documents left unchanged

| Document | Why |
|---|---|
| `overview.md` | No subsystem, command or boundary changed. |
| `onboarding.md` | A restricted onboarding builds no patch and takes no bindings lock path the document describes; the root denial it shares is in `containment.md`. |
| `doctor.md` | No finding, probe or area changed. |
| `config-reference.md` | No key, flag, default or environment variable changed; the pack `format` is not a setting. |
| `autonomy-and-decisions.md` | The decision flow is unchanged; a run's unshowable-command denial is a `policy.denied` event, documented in `data-model.md` and `containment.md`. |
| `checks-and-evidence.md` | No gap plan touched checks, evidence or gates. |
| `interactive-shell.md` | No command name, completion or history rule changed. |
| `portability.md` | The capability descriptors of the ports are unchanged; the new `excludePaths` option is a parameter of the run workspace, documented in `integrations.md`. |
| `history.md`, `unknowns.md` | History is dated and pinned; no new unknown surfaced. |
| `README.md`, `coverage.md`, `findings.md` | Owned by plan 04-69. |

## Surfaces from plans 04-56 to 04-66

| Plan | Surface | Where written |
|---|---|---|
| 04-56 | Whole summary with no ellipsis; unshowable conditions and caps; attended refusal `privileged:unapprovable`; run mode (no request, no summary); the gate | `policy-and-approvals.md` Parameters and digest, Privileged commands; `containment.md` table row, rule paragraph, events; `data-model.md` `policy.denied`; `processes.md` approve steps 2 to 4 and the diagram; `cli-reference.md` approve |
| 04-57 | gh options between group and subcommand; same-line git alias or config include refused; one count per here-document substitution | `policy-and-approvals.md` What the classifier reads, Three outcomes |
| 04-58 | Restricted patch leaves out an out-of-scope path of any name literally and keeps the in-scope edits; the `RunWorkspace` `excludePaths` option | `containment.md` Restricted mode (04-67); `runs.md` Restricted runs; `integrations.md` Run workspace, Patch |
| 04-59 | Lock staleness (reused ID, 2-second margin, `ps` elapsed time); 60-second fallback and its residual; takeover without a lock of its own; corrupt config's whole root denied; race-test notes | `profiles-and-credentials.md` Selecting a profile, Moved-root denial, What stays open, Quirks; `data-model.md` config home row; `containment.md` default parents and Limits; `integrations.md` `ps` row and failure table. The race-test notes need no document: no `docs/system/` document describes that test |
| 04-60 | Brace-glob refusal reason; pack item `format`; the `format` cache miss and its order | `containment.md` Broad discovery; `cli-reference.md` `items` row; `indexes-and-context.md` Reuse and access. The 04-60 SUMMARY says the pack stored for a run step carries `format`; the code does not: the step records only the references (`src/app/run-stages/item.ts:294`), so no document says it |
| 04-61 | Harness exports, record kinds, `briefFor` text, spend rule | No `docs/system/` document describes the harness (`findings.md` line 271 records that); findings lines below |
| 04-62 | Refused brace and glob positions; what counts as an expansion word; unchanged answers; glob residual; over-refusal | `policy-and-approvals.md` Three outcomes and What the classifier cannot see; `containment.md` table row and Limits |
| 04-63 | Wrappers, launchers, string forms, here-strings; refusals added; residual list | `policy-and-approvals.md` What the classifier reads, Three outcomes, What the classifier cannot see, enforcement-map row; `containment.md` Limits |
| 04-64 | None (the SUMMARY has no documentation surfaces) | No change |
| 04-65 | AC-8 re-judgement figures, the proposal's score sentence, ADR-017 | Findings lines and the README row below; no `docs/system/` evaluation document exists |
| 04-66 | No supported-Node statement changes; suite count to compare | No change: `integrations.md` (Node 22.22.3 or newer), `config-reference.md` and `findings.md` stay true, and `coverage.md` records no whole-suite test count, so there is nothing to compare |

## `findings.md`: lines to update or close, lines to add

Update or close (line numbers are those of `findings.md` at HEAD):

- Line 271 (`scripts/eval-retrieval.ts:1`, the harness has no document): add the exports that read recorded data and spend nothing, no mode and no flag: `briefBullets` (`scripts/eval-retrieval.ts:425`), `loadCoverage` (`:543`), `loadAmendment` (`:603`), `readCoverageRuns` (`:642`), `judgeWithCoverage` (`:655`), `editedPaths` (`:679`), `rejudgeWithCoverage` (`:726`) and the now exported `costsOf` (`:1167`); `rejudge` (`:390`) and `rejudgeResultsFile` (`:403`) are unchanged and `eval-verdict-adr016.json` still equals their output. The harness reads two record kinds, `avarice-eval-brief-coverage` and `avarice-eval-success-amendment`, each pinned by sha256 and the amendment needing `approvedBy` and `approvedAt`. Add that the `briefFor` scope text changed after the 18 recorded runs (`scripts/eval-retrieval.ts:886`; those runs were given the earlier text, as ADR-017 states) and the spend rule: `stepSpendUsd` (`:1219`) records the cap when the exit code is null, when launches cannot be counted or when launches exceed finished invocations, and 0 for a step that exited with a code and started no host.
- Line 332 (`docs/requirements.md:237`, AC-8): restate the recorded result from `test/benchmark/phase4/eval-verdict-adr017.json` and ADR-017, which supersede the success counts of `eval-verdict-adr016.json` as the judgement of record: successes A 0, B 2, C 3 of 6; partial A 2, B 2, C 1; tokens 94.4% of A for B and 88.5% for C; AC-8 passes through arm B on the token bound (success holds trivially because A has 0); the knowledge pass stays on because C now succeeds more often than B, 3 runs to 2. Replace "4 of 6 tasks against 2 of 6" with these figures. Add that `docs/requirements.md:237` still states AC-8 without the brief clause: the requirement text is unchanged, and the owner decides whether it gains the clause.
- Line 333 (`docs/operations-and-testing.md:153`, the proposal's arms): keep. The same paragraph's score sentence now states the amended rule and links ADR-017 (plan 04-65, `a9cba5a`), so the earlier suspicion that it "still says the accepted change in reviewer judgment" no longer holds; do not add that line. Refresh the verdict anchor from `scripts/eval-retrieval.ts`.
- Line 262 (enforcement-map rows with no proving test): refresh the anchors; `approval-single-use` is now at `src/domain/enforcement-map.ts:101` and `restricted-mode` at `:165`.
- Line 264 (`profile-isolation` row text against the registry): refresh the anchors to `src/domain/enforcement-map.ts:109` and `src/adapters/fs/profile-registry.ts:52` (`wholeRootOf`) and `:59` (`knownProfileRoots`). The line now also covers a corrupt config's whole-root denial; `policy-and-approvals.md` and `containment.md` state the built behavior.

Add:

- `src/domain/enforcement-map.ts:91` against `src/hook/pre-tool-use.ts:458` and `src/domain/approval.ts:100`: the `privileged-approval` row's AVARICE part names only a `gh api` body read from a file or standard input as a command no approval can bind, while the hook also refuses a command whose bound values cannot be shown whole (`unshowableReason`). `policy-and-approvals.md` and `containment.md` state both. Intent unknown; the owner decides whether the table text moves. (From plan 04-67.)
- `src/domain/privileged-commands.ts:528`: an assignment word before the program that holds `?` or `*` (`URL=http://x/?a=1 curl x`) is refused as a brace or glob expansion, although the shell does not expand assignment words, and `find {src,test} -name x` is refused for the brace word. The document states both as over-refusal. Deliberate fail-safe or over-reach is not decided by the code; intent unknown. (From plans 04-62 and 04-63.)
- `src/adapters/fs/profile-bindings.ts:270`: taking over a stale bindings lock holds no lock of its own, so a third writer that creates a lock in the gap between the rename and the put-back can share the lock with another writer until the first releases. The code comment names it as a residual; `profiles-and-credentials.md` states it. (From plan 04-59.)
- `src/adapters/fs/profile-bindings.ts:185`: where `ps` cannot be read, a live but hung holder loses the lock after `BINDINGS_STALE_AGE_MS` (60 seconds). The code comment names it as a residual and the documents state it. Deliberate; add only if the owner wants it listed. (From plan 04-59.)

## `coverage.md`: denominators whose counts changed, and each recount command

Counted at `a5b09f8` on 2026-11-25 (the last `src` commit is `2bd1e03`).

| Surface | At `96a0718` (recorded) | At `a5b09f8` | Command |
|---|---|---|---|
| Source lines | 47,873 (240 files) | 48,506 (240 files) | `git ls-files src \| xargs cat \| wc -l`; `git ls-files src \| wc -l` |
| Test files | 242: 92 unit, 116 integration, 18 fault, 11 containment, 3 mutation, 2 contract | 243: 93 unit, 116 integration, 18 fault, 11 containment, 3 mutation, 2 contract (new: `test/unit/profile-bindings-lock.test.ts`) | `git ls-files test \| grep -c '\.test\.ts$'`; per directory with `git ls-files test \| grep '\.test\.ts$' \| sed -E 's#^test/([^/]+)/.*#\1#' \| sort \| uniq -c` |
| Hook rules | 40 | 40, re-run and unchanged: the unshowable-command refusal reuses the existing `privileged:unapprovable` and the per-action rules | the command of the Hook rules row in `coverage.md` (Denominators) |
| Diagram sources | 9 | 9, re-run and unchanged (the approval diagram was edited, not added) | `ls docs/system/diagrams/*.puml \| wc -l` |
| Enforcement map controls | 18 | 18, re-run and unchanged | `grep -c "^    id: '" src/domain/enforcement-map.ts` |
| Schema migrations, ports | 4, 15 files | 4, 15, re-run and unchanged | `ls src/adapters/sqlite/migrations \| wc -l`; `ls src/ports \| wc -l` |
| Event data fields | no denominator | `policy.denied` gains the unshowable-command variants (documented in `data-model.md`); no event kind was added | `git diff 96a0718..HEAD -- src` filtered for added `policy.denied` data |

Counts not re-run because no code touched them: CLI commands 20, `AVARICE_*` names 19, action table 22, event kinds 50 (the diff adds no kind literal other than the existing `policy.denied`), doctor finding areas 11. The `Benchmarks` row is unchanged (5 repositories, 20 tasks); `test/benchmark/phase4/` also holds `eval-coverage.json`, `eval-success-amendment.json` and `eval-verdict-adr017.json`, which the row does not count. The `Per-document status` rows for the ten documents above change to `changed after review` (or `drafted` for any not yet reviewed) until the reviews pass.

## README proposal-counterparts row for ADR-017

Add beside the ADR-016 row in the proposal counterparts table of `docs/system/README.md`:

`| [decisions/ADR-017-ac8-brief-coverage.md](../decisions/ADR-017-ac8-brief-coverage.md) | partly: [findings.md](findings.md), for the AC-8 figures under the brief-coverage rule; the evaluation harness has no document in this tree |`

The documents table needs no new row: no new `docs/system/` document was written.

## Review groups for plan 04-69

| Group | Documents | Fresh reviewer checks against the code |
|---|---|---|
| A | `policy-and-approvals.md`, `containment.md`, `diagrams/approve-privileged-action.puml`, `processes.md` (approve flow), `cli-reference.md` (approve, context items), `data-model.md` (config home row, `policy.denied`) | the classifier's wrappers, launchers, string forms and residual list; the refusal cases; the unshowable-value conditions and caps; the restricted patch; the corrupt-config root denial; the brace-glob reason |
| B | `runs.md` (restricted runs), `profiles-and-credentials.md`, `integrations.md` (`ps` row, Run workspace Patch, failure table), `indexes-and-context.md` (Reuse and access) | the lock's four takeover cases against `lockIsStale`, the 2-second margin and the 60-second fallback; the registry's whole-root denial; the patch's exclusion lists; the order of the cache misses |

Each reviewer should read every sentence that states a limit (2 seconds, 60 seconds, 1 second for `ps`, 1 MiB, 440 characters, 80 characters, 400 characters, 512 characters, 16 prefix words) against the constant in the code. Reviewers of group A should note that `data-model.md` and `profiles-and-credentials.md` both describe the lock and must say the same.
