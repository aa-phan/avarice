---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 31
subsystem: testing
tags: [ac-8, evaluation, retrieval, stream-json, tokens, knowledge-pass, dry-run, leakage]

requires:
  - phase: 04-01
    provides: "fitsPhase4Ceiling, recordPhase4Spend, ceilingRefusal and the Phase 4 spend ledger"
  - phase: 04-03
    provides: "the owner-approved eval-tasks.json (20 tasks, arms, pass rules)"
  - phase: 04-26
    provides: "adapters.context source selection"
  - phase: 04-30
    provides: "the pack budget the arms run under"
provides:
  - "Per-invocation token measurement: the stream-json parser's usage, InvocationDetails token fields, invocation.finished tokens"
  - "Profile config key adapters.knowledgePass (default true, D-08) and an empty adapters.context list meaning no source"
  - "scripts/eval-retrieval.ts: the three-arm AC-8 harness with --dry-run, --live, leakage guards, a sandboxed judge and pure verdict() and knowledgeRule()"
affects: [04-36, 04-38, 04-39]

actuals:
  tokens: 21500
  tasks: 3
  commits: 7
plan_head_before: 42c97edf96f725f24f0cb9599be7efb7274ce1db
plan_head_after: 075c7831ebed80ed514baafc01a76763f3f564b3

tech-stack:
  added: []
  patterns:
    - "An evaluation arm is a profile configuration, not a code path: adapters.context and adapters.knowledgePass"
    - "Leakage is removed from the arm's repository (denied reads deleted, one branch at the parent, no remote) and the held-out test is added only to a separate judging clone"
    - "Live spend is checked against the Phase 4 ceiling for the whole plan before anything is cloned and again before each model step"

key-files:
  created:
    - scripts/eval-retrieval.ts
    - test/unit/eval-retrieval.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-31-red-task1.json
  modified:
    - src/adapters/host-claude/stream-json.ts
    - src/adapters/host-claude/claude-host.ts
    - src/ports/agent-host.ts
    - src/app/invocation.ts
    - src/app/stages/index-steps.ts
    - src/app/stages/index-stage.ts
    - src/domain/context-adapters.ts
    - src/cli/composition.ts
    - test/unit/stream-json.test.ts
    - test/integration/run-invocation.test.ts
    - test/integration/context-adapters.test.ts

key-decisions:
  - "An empty adapters.context list now selects no source (arm A, D-06); plan 04-26 had refused it"
  - "Arm A gets its GSD map by one throwaway fast onboarding with --promote commit whose map commit is fast-forwarded into the arm repository before the onboarding the run uses, because a run clones the onboarded revision only"
  - "AC-8 tokens are the run's own invocations; onboarding tokens and cost are recorded beside them as setup"
  - "Held-out test and every deniedReads path are deleted from the arm repository, so a changed test's old version is unreadable too"
  - "The judge never counts missing dependencies or an unavailable sandbox as a failed task: it reports a judging error"

requirements-completed: [FR-3, FR-22]

coverage:
  - id: D1
    description: "The stream-json parser sums the last usage of each distinct assistant message id into four token counts (zeros when absent), the claude host reports them, and invocation.finished carries their sum as tokens"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/stream-json.test.ts#usage per distinct assistant message"
        status: pass
      - kind: integration
        ref: "test/integration/run-invocation.test.ts#carries the sum of the four usage counts as tokens on invocation.finished, and no tokens when the host reported none"
        status: pass
    human_judgment: false
  - id: D2
    description: "adapters.knowledgePass false records the knowledge index step as disabled and starts no knowledge invocation; absent or true runs it as before; a non-boolean is refused at composition naming the key"
    requirement: FR-3
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#adapters.knowledgePass (D-08)"
        status: pass
      - kind: integration
        ref: "test/integration/knowledge-pass.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "An empty adapters.context list composes no source, records no context adapter and answers a query with no items (the baseline arm has no pack)"
    requirement: FR-3
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#composes no source for an empty adapters.context list, records no context adapter, and answers a query with no items"
        status: pass
    human_judgment: false
  - id: D4
    description: "The harness refuses an unapproved task list, plans every run with its cap, and --dry-run prints the planned runs and the projection, exits 0 inside the Phase 4 ceiling and non-zero with the D-03 refusal past it, spending and recording nothing"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#--dry-run"
        status: pass
      - kind: other
        ref: "node scripts/eval-retrieval.ts --dry-run --tasks 3 (exit 0, 9 planned runs)"
        status: pass
    human_judgment: false
  - id: D5
    description: "No arm can read the held-out test, a denied read, the target commit, a remote or a second ref; the held-out test is added only in the judging clone"
    requirement: FR-3
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#leakage (T-04-85): the arm workspace and the judging clone"
        status: pass
    human_judgment: false
  - id: D6
    description: "verdict() and knowledgeRule() compute the AC-8 and D-08 outcomes (exactly half the tokens passes, one over fails) and summarize() states both per arm"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#verdict (AC-8) and knowledgeRule (D-08)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The live driver (arm setup, map generation, onboarding, start --wait, ledger reads, sandboxed judging of a real repository) runs end to end"
    verification: []
    human_judgment: true
    rationale: "It spends and was not run (SPEND RULE). Its pieces are tested offline: workspace preparation, conventions, briefs and the leakage guards were run against read-only scratch clones of the three owner repositories; the CLI steps, ledger reads and the judge on a real repository first run in plan 04-36's pilot."

duration: "~45 min"
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 31: AC-8 Evaluation Groundwork Summary

**Tokens are now measured per invocation from stream-json usage, the knowledge pass has a profile switch, and a guarded three-arm evaluation harness with a dry run, leakage removal, a sandboxed judge and pure AC-8 and D-08 arithmetic is ready, with nothing spent.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-11-17T14:12Z
- **Tasks:** 3 (plus one deviation commit)
- **Files:** 14 changed (1,523 insertions, 8 deletions)

## Accomplishments

- **Tokens (tracer, A2).** The parser keeps the last usage printed under each assistant `message.id` and sums input, cache-creation, cache-read and output tokens (zeros when absent, an id-less message counted on its own, a non-numeric or negative count read as 0). The claude host puts the four counts in the invocation details; `invocation.finished` carries `tokens`, their sum, when the adapter measured them.
- **Knowledge switch (D-08).** `adapters.knowledgePass` (default true): false records the knowledge step as `disabled` before it runs, so no knowledge invocation starts and onboarding still ends `active`. A non-boolean is refused at composition for writing and read-only commands, naming `adapters.knowledgePass`.
- **Harness.** `scripts/eval-retrieval.ts` reads only an approved list (`approvedBy` and `approvedAt` both set), plans every task under every arm, and has two modes. `--dry-run` prints the runs, caps and projection, and exits 3 with the D-03 text past the ceiling. `--live` refuses first when the whole plan passes the ceiling and checks it again before each model step, recording each step's spend under plan 04-36. Arms are profile configurations: A `adapters.context []`, B gsd-intel and gsd-graph with the pass off, C the same with the pass on.
- **Leakage (T-04-85).** An arm's repository is a clone reduced to the task's parent: one branch, no remote, no later commit (the target commit's object is pruned and asserted absent), every `deniedReads` path deleted, plus one setup commit (derived conventions; planning stubs where the parent has none). The held-out test is copied from the target commit into a separate judging clone only. The preparation was also run read-only against the three owner repositories in a scratch directory (removed afterwards): all 20 briefs parse with the real brief parser, and a workspace for T01, T07 and T16 passed every leak assertion with conventions the real parser accepts.
- **Judging.** Required checks and the held-out command run in the judging clone through the sandboxed executor, which can write only below the clone. The result keeps statuses and exit codes, never output. Missing dependencies or an unavailable sandbox is a judging error, not a failed task.

## Dry-run projection for plan 04-36

Cap bound, not a forecast (tasks file sha256 `3de7b108...` matches the approved digest):

| Plan | Runs | Run caps (0.40 each) | Onboarding caps (A 0.60, B 0.60, C 0.90) | Arm A map generation (0.60 per parent without a map) | Total | Against 40.00 USD ceiling |
|---|---|---|---|---|---|---|
| Pilot, `--tasks 3` | 9 | 3.60 | 6.30 | 1.80 (3 parents) | **11.70 USD** | fits (exit 0) |
| Full, 20 tasks | 60 | 24.00 | 42.00 | 6.60 (11 of 20 parents) | **72.60 USD** | refused (exit 3, D-03) |

- **Arm A map-generation cost:** 0.60 USD cap per parent without a map. 11 of the 20 parents carry no `.planning/codebase` at the parent (the 6 portfolio and 5 GroceriesGPT tasks); the 9 `auto_search_workflow` parents do, so arm A reuses them. This is the cost plan 04-03 asked to size.
- **The full evaluation does not fit the ceiling as designed.** Onboarding, not the runs, is the larger share (42.00 of 72.60), because each arm of each task is onboarded at its own parent. The three pilot tasks are all portfolio tasks, so the pilot sizes only that repository. Levers for the owner (not decided here): fewer tasks, a shared onboarding for arms A and B (their profile differs only at run time), arms B and C only, or a ceiling decision.
- **The caps are assumptions.** Phase 3's recorded exit runs cost 0.8 to 1.2 USD each, well above 0.40; medium tasks run on sonnet. Expect the pilot to show whether 0.40 truncates runs (`budget_exhausted`).

## Task Commits

1. **Task 1: tracer, usage tokens** - `f16bf3f` (test, RED, `RED_EVIDENCE_OK`), `f315902` (feat, GREEN)
2. **Task 2: knowledge pass switch** - `7655c03` (test, RED), `236c6b9` (feat, GREEN)
3. **Deviation: empty adapters.context list** - `a27b004` (feat, with its test change)
4. **Task 3: harness** - `0469808` (test, RED: 20 of 23 failing on the missing module), `075c783` (feat, GREEN)

**Plan metadata:** the commit after this file (docs: complete plan).

## TDD Gate Compliance

RED then GREEN for every task. RED evidence of task 1 is `04-31-red-task1.json`: the classifier returned `RED_EVIDENCE_OK` (target "sums the last usage of each distinct message id, so two events that share an id count once", 3 of 26 failing). Semantic assessment: the target ran and failed on its own `deepEqual` of `parsed.usage` (undefined, because the parser kept no usage); the stream parsed cleanly and the other 23 tests passed, so the failure is the missing capture and not a load or fixture fault. Tracer gate: the verify (`node --test test/unit/stream-json.test.ts`) re-ran green after GREEN ("Tracer verified end-to-end - expanding"). The deviation commit `a27b004` carries its test change and its implementation together (the test failed first, observed before the edit, but the RED was not committed separately).

## Files Created/Modified

- `src/adapters/host-claude/stream-json.ts`, `claude-host.ts`, `src/ports/agent-host.ts`, `src/app/invocation.ts` - usage capture, details fields, `tokens` on the event
- `src/domain/context-adapters.ts`, `src/cli/composition.ts`, `src/app/stages/index-steps.ts`, `index-stage.ts` - `parseKnowledgePass`, the composition refusal, `knowledgePassEnabled` and `profileDisabledStep`; the empty list
- `scripts/eval-retrieval.ts` - the harness
- `test/unit/eval-retrieval.test.ts` (23 tests), `test/unit/stream-json.test.ts`, `test/integration/run-invocation.test.ts`, `test/integration/context-adapters.test.ts`

## Decisions Made

See key-decisions. The ones that are policy are repeated below for the owner.

## Decisions needing owner review

1. **Empty `adapters.context` now means "no source".** The plan names `adapters.context []` for arm A, but plan 04-26 refused an empty list (message "expected at least one source name"). I accepted it, because the owner-approved arm A is "no AVARICE pack" and no other product configuration removes the pack. Effect: a profile that writes `[]` gets no packs at all. The 04-26 test that asserted the refusal was changed to assert the acceptance. Alternative: keep the refusal and give arm A a single source such as `git-files`, which hands it search hits and so is not the baseline.
2. **How arm A gets its map.** A run clones the onboarded revision only, so a map generated in staging is invisible to it. Where the parent has no map, arm A pays a throwaway fast onboarding (promoted as one commit) and a second onboarding of the repository that carries it. The alternative (arms B and C also see the map) would stop isolating the pack's effect.
3. **Which tokens count for AC-8.** The run's own invocations. Onboarding tokens and cost are recorded per run as `setup` and are not in the verdict. If the owner wants the one-time index and map cost charged to each arm, the verdict inputs change.
4. **Derived conventions for the arms.** The harness writes `.avarice/config.json` itself: the task's checks as required checks (timeout 900 s), a write set of every non-dot top-level directory plus unprotected top-level files, `npm ci` against the registry host when the parent has `package-lock.json`, and stub `.planning/PROJECT.md`, `ROADMAP.md` and `STATE.md` where the parent has none (start refuses without a roadmap). These are the agent's authority in the evaluation.
5. **Judge dependencies.** The judge copies a `node_modules` tree (named with `--node-modules`, or the source checkout's own when its lockfile equals the parent's). A tree built from a newer lockfile is never used silently: the task is reported as a judging error.
6. **Briefs carry the implementation detail of the commit body** (decided in plan 04-03); a pilot check is still needed that no brief gives the answer away.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan's arm A configuration was refused by the product**
- **Found during:** Task 3 design (reading `parseContextAdapters`)
- **Issue:** `adapters.context []` is a refusal since plan 04-26.
- **Fix:** accepted the empty list as no sources; changed the one test that asserted the refusal and added one for the new behavior; no document in `docs/system/` states the old refusal.
- **Files modified:** `src/domain/context-adapters.ts`, `test/integration/context-adapters.test.ts`
- **Committed in:** `a27b004`

**2. [Rule 3 - Blocking] The host adapter had to report the tokens**
- **Found during:** Task 1
- **Issue:** the plan lists the parser, the port and `invocation.ts` but not `src/adapters/host-claude/claude-host.ts`, which builds `InvocationDetails`.
- **Fix:** four lines in `claude-host.ts`.
- **Committed in:** `f315902`

**3. [Rule 2 - Missing critical] Where the plan said to read the key**
- **Found during:** Task 2
- **Issue:** the plan says to read `adapters.knowledgePass` in `index-steps.ts`; the loop that selects steps is in `index-stage.ts`, and the refusal belongs in composition beside the context list.
- **Fix:** `knowledgePassEnabled` and `profileDisabledStep` live in `index-steps.ts` (the acceptance grep passes), the stage calls them, composition refuses the bad value.
- **Committed in:** `236c6b9`

Test-only additions outside the plan's file list: `test/integration/run-invocation.test.ts` (the event field).

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical). **Impact:** necessary for the plan's own goal; no scope creep.

## Issues Encountered

- The evaluation's tasks file is the approved one (sha256 `3de7b1080203809485fbf4f7b968e9e29703490494a019b0750e2f1050f15d92`, equal to the digest recorded in plan 04-03); nothing changed it.
- A profile's roots may not sit under `~/.claude*`, so `--scratch` cannot be the job tmp directory `~/.claude-edu/jobs/...` for a live run; use the system temp directory (the default).
- The held-out tests were not run at their parents (plan 04-03's known limit). The harness has no mode that does so; the pilot discovers a held-out test that passes at the parent only as an arm that "succeeds" with no change. Consider checking that before the full evaluation.

## Known Stubs

None. The `.planning` stubs the harness writes into an arm repository are intentional scratch content, not product stubs.

## Threat Flags

None beyond the plan's register. T-04-85 (leakage) is mitigated and tested, T-04-86 (spend overrun) by the per-run cap, the whole-plan and per-step ceiling checks and the dry run, T-04-87 by pure, tested arithmetic.

## Documentation surfaces (for plan 04-38)

- **config-reference:** profile config `adapters.knowledgePass` (boolean, default true; false records the knowledge index step `disabled`; non-boolean refused naming `adapters.knowledgePass`). `adapters.context`: an empty list is valid and selects no source (no pack); the refusal text "expected at least one source name" is gone; unknown name, repeat and non-list still refused.
- **data-model.md line 185 and containment.md line 346:** `invocation.finished` also carries `tokens`, the sum of the invocation's input, cache-creation, cache-read and output tokens, when the host adapter measured them.
- **runs/containment/ports:** `InvocationDetails` gains optional `inputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `outputTokens`; the stream-json parser's `ParsedStream` gains `usage`.
- **onboarding.md and indexes-and-context.md:** the knowledge step's `disabled` status now also follows the profile switch, not only the contract's index flag.
- **A new document for the evaluation harness** (its modes, flags, arms as profile configurations, the leakage guards, the judge, the results file, the projection and the ceiling checks), listed in `docs/system/README.md` and `coverage.md`.
- **findings.md:** none new from this plan; the spec's arm A (document section reads) versus D-06's baseline stays with plan 04-39.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-36 can run `node scripts/eval-retrieval.ts --live --tasks 3 --out <file>` once the owner authorizes the spend (11.70 USD cap bound for the pilot). Before the full evaluation the owner has to decide how to fit 72.60 USD into a 40 USD ceiling (see the levers above).

## Self-Check: PASSED

- `scripts/eval-retrieval.ts`, `test/unit/eval-retrieval.test.ts` and `04-31-red-task1.json` exist.
- Commits `f16bf3f`, `f315902`, `7655c03`, `236c6b9`, `a27b004`, `0469808` and `075c783` are ancestors of HEAD.
- `test/containment/live-spend-phase4.jsonl` is byte-identical before and after (empty, sha1 `da39a3ee...`); no live `claude` was invoked.
- Unit suite 2,740 pass, 0 fail; 16 related integration and fault files 310 pass, 0 fail; `npm run typecheck` and `npm run check:boundaries` clean; `node scripts/eval-retrieval.ts --dry-run --tasks 3` prints 9 planned runs and exits 0.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
