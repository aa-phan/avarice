---
phase: 03-decisions-independent-work-and-amendments
plan: 34
subsystem: run-prompt-and-hook
status: complete
tags: [gap-closure, rc-8, aut-3, haiku, shell-rules, hook-refusal-reasons, run-agents]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-27's halt (item A, small, haiku, did not complete in s17-s51 twice), the run prompt and the hook from phases 2 and 3"
provides:
  - "spikes/phase-3-wave-0/S3-B-small-unit-haiku.md: the diagnosis of the 03-27 small-unit failure, read from the two transcripts before any fix"
  - "src/domain/run-shell-rules.ts: one source for the run's shell-rule text (prompt lines, hook refusal reasons, run agents' addendum)"
  - "the unit prompt states the shell rules, the read-only commands and the workflow shell-step instruction; shell-syntax, shell-not-allowed and shell-denied-prefix refusals carry a reason; the four run agents carry the rules"
  - "test/integration/run-prompt-policy.test.ts: the invariant that the unit prompt and the hook policy of the same invocation agree"
affects: [03-35, 03-31, 03-32, 03-33]

actuals:
  tokens: 40000
  tasks: 3
  commits: 4
plan_head_before: 240ab24e32900292b1244dff3937ced8fce35824
plan_head_after: 152e5b0ee0052e5f38da97ae7dca29ab1cb3c485
commits: 4

tech-stack:
  added: []
  patterns:
    - "Text the model reads (prompt lines, refusal reasons, agent notes) lives in one domain module and is built from the lists the hook enforces, so the three cannot drift"
    - "An integration invariant that parses the commands a prompt grants out of the prompt itself and judges each with the hook policy built from the same invocation request"

key-files:
  created:
    - spikes/phase-3-wave-0/S3-B-small-unit-haiku.md
    - src/domain/run-shell-rules.ts
    - test/integration/run-prompt-policy.test.ts
  modified:
    - src/app/run-gsd-config.ts
    - src/domain/hook-decision.ts
    - src/adapters/gsd/agents-json.ts
    - test/unit/run-gsd-config.test.ts
    - test/unit/hook-decision.test.ts
    - test/unit/agent-frontmatter.test.ts
    - test/integration/hook.test.ts
    - docs/system/runs.md
    - docs/system/containment.md

key-decisions:
  - "The fix is the prompt, the refusal text and the agents' note; ROUTINE_PRESET (modelBySize, escalation), READ_ONLY_COMMANDS, DENIED_COMMAND_PREFIXES and GSD_READ_VERBS are byte-identical to the head the gap plans were written at (git diff against bc1b012 is empty for invocation-scope.ts and run-contract.ts)"
  - "The loop limit (3 consecutive denials, CON-14) is kept; stating the rules up front and in each refusal removes the trigger without weakening the control"
  - "A refusal reason is built from fixed text and the policy's own command names only, so it never repeats the refused command and never names a path; the ledger event keeps the rule alone"

requirements-completed: []

coverage:
  - id: D1
    description: "The cause of the 03-27 small-unit failure is recorded from the two transcripts before any fix (three causes, alternatives not taken, the prediction 03-35 tests)"
    verification:
      - kind: other
        ref: "spikes/phase-3-wave-0/S3-B-small-unit-haiku.md (committed 064e2e1 before the first source change 475554d)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The unit prompt states the shell rules, names the read-only commands and removes the contradiction about the workflow's shell steps; every command it grants is admitted by the hook policy of the same invocation and each refused shape it names is refused"
    verification:
      - kind: command
        ref: "node --test test/unit/run-gsd-config.test.ts test/integration/run-prompt-policy.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A shell-syntax, shell-not-allowed or shell-denied-prefix refusal reaches the model with a reason naming what is admitted, never the refused command or a path; decisions and rules are unchanged"
    verification:
      - kind: command
        ref: "node --test test/unit/hook-decision.test.ts test/integration/hook.test.ts test/integration/run-prompt-policy.test.ts test/mutation/fail-closed.test.ts (263 pass); claude-host, run-loops, run-outcomes (62 pass, unedited)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four run agents carry the shell-rules addendum (the executor's before its commit note); map and intel agents are unchanged"
    verification:
      - kind: command
        ref: "node --test test/unit/agent-frontmatter.test.ts (26 pass)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Whether a haiku unit now completes the quick workflow live"
    verification: []
    human_judgment: true
    rationale: "Offline tests prove the prompt and the hook agree; only plan 03-35's live probe on haiku shows whether the model finishes (the prediction in S3-B)"

duration: about 1 h 15 min
completed: 2026-11-09
---

# Phase 3 Plan 34: fix the cause of the small-unit failure Summary

**The 03-27 small unit failed because the prompt told it to run a workflow whose shell steps the hook refuses while listing one command, never stated the shell rules, and the hook's shell refusals named a rule and nothing else; the prompt, the refusals and the four run agents now state what the hook admits, proven offline, with the size-to-model map and every containment list untouched.**

## Diagnosis in two sentences

Haiku, given a prompt that listed only `npm test` and also demanded the whole quick workflow (gsd-tools, mkdir, git), either improvised compound shell lines that the hook refused with a bare rule name, three in a row, which ended the unit by the loop limit (run 1), or read the contradiction literally and stopped (run 2); sonnet and opus met the same refusals but had admitted calls between them and worked the workflow out themselves. The evidence directories still existed, so the record in `spikes/phase-3-wave-0/S3-B-small-unit-haiku.md` was written from the transcripts, not only from the results lines.

## Performance

- **Duration:** about 1 h 15 min
- **Tasks:** 3 of 3 (Task 1 was the tracer)
- **Files:** 3 created, 9 modified
- **Live spend:** none (offline plan)

## Accomplishments

- **S3-B record.** The failure of both runs with per-call tables for haiku, the comparison with sonnet and opus, three causes, five alternatives not taken, the prediction and an empty "Live probe (plan 03-35)" heading. Committed before any source change.
- **The prompt.** `contractText` adds, directly after the command bullets: the shell-rules sentence (one plain command per Bash call, the refused forms, relative paths), the read-only commands sentence built from `READ_ONLY_COMMANDS` (a list change changes the sentence) with the Read, Grep and Glob tools, and the workflow shell sentence (do not run gsd-tools, mkdir or repository-changing git and do not stop for them; choose the quick directory, create files with Write, start the planner, plan-checker, executor and verifier with the Agent tool). `RUN_WORKFLOW_SENTENCE`, `RUN_NO_COMMIT_SENTENCE` and the resume prompt are unchanged; the 32 KiB cap still refuses a brief that does not fit, never cuts it.
- **The refusals.** `shellRuleReason` gives `shell-syntax`, `shell-not-allowed` and `shell-denied-prefix` a reason (the refused forms in the prompt's own words; the commands this policy admits). Used by `decideShell` when no git reason applies, including the empty and over-long command. Hook output reads `avarice: shell-syntax: <reason>`; the ledger event still records only the rule.
- **The agents.** `AVARICE_RUN_SHELL_ADDENDUM` closes the prompts of the four run agents; the executor's carries it before its commit note. A subagent's refused call counts toward the same invocation's loop limit.
- **The invariant.** `test/integration/run-prompt-policy.test.ts` runs a one-item small brief through the real supervisor and the fake host, builds the hook policy from the recorded request, parses the granted commands out of the prompt text, and judges each (admitted) and five refused shapes (`ls src; ls test`, `npm test 2>&1`, `ls ~`, `pwd`, `mkdir -p ...`; denied, each with a clean reason).
- **docs/system.** `runs.md` (Launch) and `containment.md` (agents file bullet, shell refusal paragraph, opening module list) describe the change.

## Task Commits

1. **Diagnosis (before code)** - `064e2e1` (docs)
2. **Task 1: tracer, the prompt states the shell rules** - `475554d` (feat)
3. **Task 2: refusals say what is admitted** - `7d38907` (feat)
4. **Task 3: run agents carry the rules, docs/system** - `152e5b0` (feat)

Tracer gate: the Task 1 `<verify>` commands (unit and integration suites, typecheck, check-boundaries, the unchanged-lists diff) all passed end to end, so expansion went ahead. Red evidence for each task is in its commit message (import failures for Tasks 1 and 3, 7 failing cases for Task 2).

## Deviations from Plan

**1. [Rule 1 - test] An existing assertion in test/unit/hook-decision.test.ts**
- **Found during:** Task 2
- **Issue:** the "corrective reasons" case asserted that `curl x` (shell-denied-prefix) and `git log -- *.ts` (shell-syntax) carry no reason. The plan makes those two rules carry one.
- **Fix:** the two commands moved to a new assertion that their decision and rule are unchanged and that a reason is present. The file is in Task 2's own `<files>`.
- **Commit:** `7d38907`

**2. [Rule 1 - test] The old "no other agent" assertion of agent-frontmatter.test.ts**
- **Found during:** Task 3
- **Issue:** the case said a planner agent has no `AVARICE run` text. The planner now carries the shell-rules note.
- **Fix:** it now asserts the planner and the mapper get no commit addendum; new cases cover the four run agents and the unchanged map and intel agents. In Task 3's `<files>`.
- **Commit:** `152e5b0`

**3. [Plan defect - verification] The docs `<automated>` check of Task 3 cannot pass as written**
- **Found during:** Task 3
- **Issue:** it fails if either document contains `agents-json.ts`, but both documents already name that file in the opening paragraph, where CLAUDE.md requires modules to be named once. Adding the new module's path to the containment opening (the CLAUDE.md rule) would add a second match.
- **Fix:** I ran the same check on every line except the opening line 3 of each document (mkdir present in runs.md; the three shell rules with a reason in one line of containment.md; no plan number, module path or file name in the prose). It passes. The prose holds none of those; the opening paragraphs follow the repository rule. `src/domain/run-shell-rules.ts` was added to the containment opening list; runs.md's opening already covers `src/domain/`.

**4. [Environment] The root-pin script and the plan ledger file**
- The harness refused to run `root-pin.sh` (a `bash <script>` form it could not verify) and refused a write to the shared `.git` path. In place of the script I ran its decisive comparison as plain commands before every commit: `git rev-parse --show-toplevel` and `git -C <pinned root> rev-parse --show-toplevel` both gave `/Users/aphan/avarice/.claude/worktrees/phase-03`. In place of the on-disk head ledger I recorded the head at start (`240ab24e32900292b1244dff3937ced8fce35824`) and used it for `commits:` above.

**Total deviations:** 2 test updates (Rule 1), 1 plan verification defect, 1 environment workaround. **Impact:** none on the behavior; no containment list, preset value or hook decision changed.

## Issues Encountered

None beyond the deviations. `node --test` on the whole repository was also run once (see Self-Check).

## Documentation surfaces (for plans 03-31 to 03-33)

Changed in this plan, to be reviewed fresh by plan 03-33 (README.md, coverage.md and findings.md were not touched):

- `docs/system/runs.md`, the "Launch." paragraph: the shell rules, the read-only commands, the instruction on the workflow's gsd-tools, mkdir and git steps, and the run agents' closing note.
- `docs/system/containment.md`: the opening module list (run-shell-rules), the agents-file bullet (every run agent's note, the executor's two notes), and the new paragraph after the git refusals (the reason on `shell-syntax`, `shell-not-allowed` and `shell-denied-prefix`).

Plan 03-27's proposed `docs/system/findings.md` line ("a small item does not complete the quick workflow under the run's command list") is superseded by this fix unless plan 03-35's live probes fail; do not add it before 03-35 reports.

## Known Stubs

None.

## Threat Flags

None. No new network, auth, file-access or schema surface: only prompt text, a refusal reason built from fixed text and the policy's own command names, and an agents-file note. T-03-64 (prompt granting more than the hook admits) is covered by the integration invariant and the unchanged-lists diff; T-03-65 (refusal reasons leaking) by the clean-reason assertions; T-03-66 (workflow sentence read as leave to work by hand) by keeping `RUN_WORKFLOW_SENTENCE` and naming the four agents. T-03-SC: no package installs.

## Self-Check: PASSED

- Created files exist: the S3-B record, `src/domain/run-shell-rules.ts`, `test/integration/run-prompt-policy.test.ts`.
- Commits `064e2e1`, `475554d`, `7d38907`, `152e5b0` are ancestors of HEAD; `git rev-list --count 240ab24..HEAD` is 4 before this file.
- `node --test` over the whole repository (run after the Task 3 code, before the summary commit): 3489 tests, 3422 pass, 0 fail, 67 skipped (live cases without `AVARICE_LIVE`).
- `node --test "test/unit/**/*.test.ts"` 1859 pass; the targeted integration suites (hook, run-prompt-policy, fail-closed, claude-host, run-loops, run-outcomes, hook-git-secret-reads, hook-read-digest) pass; `npm run typecheck` and `node scripts/check-boundaries.ts` clean; `git diff bc1b012 -- src/domain/invocation-scope.ts src/domain/run-contract.ts` and the diff of the read-only regression tests and fake hosts are empty.
