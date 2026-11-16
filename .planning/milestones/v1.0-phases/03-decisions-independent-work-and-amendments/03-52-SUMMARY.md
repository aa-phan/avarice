---
phase: 03-decisions-independent-work-and-amendments
plan: 52
subsystem: exit-tools-authorization
tags: [exit, brief-gate, authorization, d-28, d-30, d-31, d-33]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-49 write-set check, brief-check report shape, relax path; plan 03-51 (runs before this plan in one checkout)
provides:
  - "gateClassification / gateForBrief: the D-31 gate of a reviewed classification file against a fresh uncapped write-set check"
  - "brief-check --all (uncapped report), brief-gate and write-authorization subcommands"
  - "D-28 fresh-approval rule in authorizationOf; the gate inside authorize; relax closed in the exit"
affects: [03-53, 03-54, 03-55, 03-56, 03-57]

actuals:
  tokens: 26000
  tasks: 2
  commits: 4
plan_head_before: a1768ec9c832ee6f8335fb11c11b84edad43e67f
plan_head_after: f19bdd346263fb9852ac7fcb8b150df10681c8ad

tech-stack:
  added: []
  patterns:
    - "A reviewed file is a claim: the gate takes every fact it judges (findings, location, protection, conventions membership, digest, pin) from a fresh check at the pin and judges the file against it"
    - "flags() returns bools for valueless flags without changing how valued flags parse"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-52-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-52-red-task2.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "The gate fails closed: a fresh report without protectedGlobs, a capped fresh report, a brief that does not compile, a finding listed twice, a brief the file invents and a repository that moved during the check are all problems"
  - "A `kept` finding in a protected file passes the gate (the brief leaves the spec as it is); only a `changed` one is refused (D-30)"
  - "The uncapped report alone carries each brief's protectedGlobs and the `uncapped` marker, so the default brief-check output is byte-identical (verified against the HEAD version on a real repository)"
  - "write-authorization stores briefCheck.path relative to the checkout the tools live in, like the brief paths; authorizationOf reads it against that checkout"
  - "authorizationOf additionally requires the classification's own checkedAt to be no later than ownerConfirmedAt (not only the writer): a hand-edited authorization cannot predate its file"

requirements-completed: [AUT-1, AUT-2, AUT-3]

duration: about 45min
completed: 2026-11-10
status: complete

coverage:
  - id: D1
    description: "brief-gate re-runs the write-set check uncapped at the pin and passes only a classification that classifies every fresh finding kept or changed at its own path and line, with no changed finding in a protected file or outside the conventions' write set, no digest, pin, conventions or Write-list (D-30) problem"
    requirement: AUT-1
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#the D-31 gate: gateClassification and gateForBrief (plan 03-52)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#brief-gate and write-authorization on a temporary repository (plan 03-52)"
        status: pass
    human_judgment: false
  - id: D2
    description: "write-authorization writes the approval only when the gate passes, the cap is at most 4.50 USD, the ceiling at most 25 USD, the decision reference is not empty and ownerConfirmedAt is an ISO time no earlier than the classification's checkedAt; otherwise exit 2 and no file"
    requirement: AUT-2
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#write-authorization exits 2 and writes nothing for a cap above 4.50, a ceiling above 25, an empty decision reference and an owner time that is early or not a time"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#write-authorization writes the approval once the gate passes: the fields, the order of the briefs, the cap flag and the digest of the classification file"
        status: pass
    human_judgment: false
  - id: D3
    description: "field, authorize and evidence accept only a fresh approval (selection approve, exitRules D-26..D-35, matching briefCheck sha256, caps within D-33/D-05, complete order); every earlier authorization file is refused with exit 2"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#authorization: only a fresh approval authorizes a start (plan 03-52, D-28)"
        status: pass
      - kind: other
        ref: "node scripts/exit-run-phase3-tools.ts field --authorization-file .planning/phases/03-decisions-independent-work-and-amendments/03-49-exit-authorization.json --pick perRunCapUsd -> exit 2"
        status: pass
    human_judgment: false
  - id: D4
    description: "authorize runs the gate again for the one brief it starts and refuses with exit 2, starting nothing, when a finding of that brief fails it; another brief's failing finding does not stop it"
    requirement: AUT-1
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#authorize runs the gate for the brief it is about to start (D-31)"
        status: pass
    human_judgment: false
  - id: D5
    description: "relax refuses an evidence file marked exitRules D-26..D-35 and leaves it byte-identical; judgeFinish with relaxAllowed false lists the record as a problem and relaxes nothing; the evidence stage passes relaxAllowed false"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#relax refuses an evidence file marked exitRules D-26..D-35, naming D-28, and leaves it byte-identical (plan 03-52)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#with relaxAllowed false a relax record is a problem and relaxes nothing, and with the option absent the record counts as before (plan 03-52, D-28)"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 52: The D-31 brief gate, the gate-enforced authorization writer and D-28's fresh approval Summary

**An exit start is now mechanically impossible unless the owner approved, after the re-discussion, briefs whose every write-set finding was classified in a reviewed file that the tools re-judge against a fresh uncapped check at the pin: `brief-gate` and `write-authorization` are new, `authorize` runs the gate for the brief it starts, only a fresh `approve` authorizes anything, and the relax path cannot act in the exit.**

## Performance

- **Duration:** about 45 min
- **Tasks:** 2 of 2 (Task 1 a tracer, Task 2 auto; both TDD)
- **Files:** 2 modified (`scripts/exit-run-phase3-tools.ts`, `test/unit/exit-evidence.test.ts`), 2 RED evidence records created
- **No file under `src/` changed; no brief changed (`git diff --exit-code 4525c27 -- test/benchmark/phase3` clean); no live run, no spend**

## Accomplishments

- `flags()` (now exported) returns `bools`, the set of flags with no value; `brief-check --all --source R` records both (pinned by a case).
- `writeSetCheck(repo, rev, input, { limitPerNeedle })`: `Infinity` lists every finding with an empty `truncated`; with no options the findings and `truncated` are as before (the existing cases pass unchanged).
- `briefCheckReport(source, briefPaths, pinRef, options)` extracted from `brief-check`. The default report is byte-identical to the HEAD version on a real repository (compared JSON with `checkedAt` masked, and the printed text). `--all` adds `uncapped: true` and each brief's `protectedGlobs`, which the gate needs for D-30.
- `gateClassification` / `gateForBrief`: protection, location, conventions membership, digest, pin and conventions revision all come from the fresh report; the file's own `protected` and `insideConventions` values are ignored (a forged `protected: false` on a `changed` spec finding still fails).
- `brief-gate --classification F [--source REPO] [--pin SHA]`: exit 0 and `brief-gate: pass: N finding(s) classified in M brief(s)`, exit 1 with one `brief-gate: FAIL` line per problem, exit 2 on usage. The repository's HEAD, status and refs are compared before and after.
- `write-authorization`: validates the cap (D-33), ceiling (D-05), decision reference, ISO owner time against the classification's `checkedAt`, runs the same gate, and writes through a temporary file and a rename with the fields in the plan's order (`plan` from `AVARICE_PHASE3_PLAN`).
- `authorizationOf` (now exported): `AUTHORIZING_SELECTIONS = ['approve']`, `exitRules === 'D-26..D-35'`, cap at most 4.50, ceiling at most 25, a readable `briefCheck` file with a matching sha256, an ISO `ownerConfirmedAt` no earlier than that file's `checkedAt`, and an `order` that holds each brief's `run` exactly once. The `Authorization` value carries `order`, `briefs[].run/expects` and `briefCheckPath`.
- `authorize` calls the gate for the brief it starts (fresh uncapped check of that one brief) after the digest match and before the evidence and spend checks.
- `relax` refuses an evidence file with top-level `exitRules: D-26..D-35` (file byte-identical). `judgeFinish` gained `relaxAllowed`; the evidence stage passes `false`.

## TDD Gate Compliance

Both tasks ran RED then GREEN; no REFACTOR commit.

- Task 1 RED `f128c9b`, GREEN `66c78ad`. RED output (`node --test --test-reporter=tap test/unit/exit-evidence.test.ts`): 100 tests, 76 pass, 24 fail. The pure-function cases failed with `TypeError: exitTools.gateClassification is not a function` (the new exports are read through a namespace import so the file loads and the cases fail on the missing function, not on loading); the CLI cases failed on planned assertions (for example `brief-gate` exited 2 with the usage line where the case expects 1; `limitPerNeedle: Infinity` still returned 25 findings, `expected: 30, actual: 25`). `gsd_run check tdd-red-evidence` on the record `03-52-red-task1.json` returned `RED_EVIDENCE_OK` (`target_test_failed`), target "brief-gate exits 1 on a dropped finding and prints one FAIL line for it; the repository is as it was". Semantic assessment: the target ran against a real temporary git repository, the fixture's own `brief-check --all` run succeeded, and the case failed on the status assertion, not on setup.
- Task 2 RED `44c982f`, GREEN `f19bdd3`. RED output: 115 tests, 98 pass, 17 fail (the refusal cases got exit 0 where they expect 2; the gate-in-authorize case reached the preflight instead of refusing; the relax and `relaxAllowed` cases failed on their assertions). `RED_EVIDENCE_OK` on `03-52-red-task2.json`, target "refuses an authorization with a per-run cap of 4.95, exit 2" (`field` printed the cap and exited 0). Semantic assessment: the `before` hook ran the real writer and the case failed on the planned exit-status assertion.
- One mid-RED fixture correction, recorded for honesty: the first RED run of Task 2 showed the "passes the gate" authorize case failing at the preflight (`staleness: FAIL no-planning`); I added `.planning/ROADMAP.md` to the temporary repository, then re-ran RED before committing. The committed RED is the second run.

## Gate problem messages

`brief-gate` prints `brief-gate: FAIL <brief>: <path>:<line> <needle>: <why>` (file-level problems use `(file)` for the brief). The reasons, each naming its decision:

- `missing from the classification file, so unclassified (D-31)`
- `the fresh check does not report this finding (D-31)`
- `the classification is <value>, not kept or changed (D-31)`
- `assertedAt is <value>, not the finding's own location <path>:<line> (D-31)`
- `classified changed, but the file is protected and no run may write it (D-30, D-31)`
- `classified changed, but the file is outside the conventions' write set and no run may write it (D-31)`
- `listed twice in the file (D-31)`
- `the digest ... in the file differs from the fresh parse ...: the brief changed after it was classified (D-31)`
- `the fresh check was capped (truncated {...}), so its findings cannot all be classified (D-31)`
- `the Write list names <path>, which matches a protected glob (D-30)`
- `the brief does not pass the fresh check: does not parse|compile ... (D-31)`, `the classification file holds no entry for this brief (D-31)`, `the file classifies a brief the fresh check does not hold (D-31)`
- `the classification was made at pin ..., the fresh check ran at pin ... (D-31)` and the same for the conventions revision
- `authorize`: `refusing to start <brief>: the D-31 gate found N problem(s): ...`

## Authorization files of plans 03-28 to 03-49 no longer authorize anything

Every `03-NN-exit-authorization.json` for NN from 28 to 49 is refused by `field`, `authorize` and `evidence` with exit 2 (none carries `exitRules: D-26..D-35`, and 03-49's selection is `answer-2-in-place`). A case iterates every such file in the phase directory; `field` on `03-49-exit-authorization.json` prints `the authorization selection is "answer-2-in-place", not "approve": only a fresh approval authorizes a start (D-28)` and exits 2. The files stay on disk as history. The relax subcommand and the relaxed finish judge stay in the tool for the history of plan 03-49 and cannot act in the new exit.

## Verification

- `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts`: 151 tests, 151 pass, 0 fail.
- `npm run typecheck` (`tsc -p .`): no output (clean). `node scripts/check-boundaries.ts`: `check-boundaries: ok (99 file(s))`.
- `field --authorization-file .../03-49-exit-authorization.json --pick perRunCapUsd; test $? -eq 2`: printed `old-authorization-refused`.
- `git diff --exit-code 4525c27 -- test/benchmark/phase3`: exit 0 (briefs unchanged). `git status --porcelain -- src`: empty. `git diff --name-only` over this plan's commits lists only `scripts/exit-run-phase3-tools.ts` and `test/unit/exit-evidence.test.ts`.
- Regression sweep: `npm run test:unit` 2046 pass, 0 fail.
- Acceptance: `grep -n "export function gateClassification" scripts/exit-run-phase3-tools.ts` prints line 861 (after the Task 2 edits); the dispatcher handles `brief-gate` and `write-authorization`; the forged-`protected: false` case fails the gate in both the pure and the CLI cases; the existing writeSetCheck cases pass unchanged.

## Documentation surfaces for the documentation plan

`docs/system/` exists in this checkout but, as in plan 03-51, this plan lists its surfaces instead of editing it mid-phase. For the phase's documentation plan: the exit tools' subcommands `brief-check --all`, `brief-gate` and `write-authorization` (flags, exit codes 0/1/2, the `brief-gate: pass`/`FAIL` lines); the classification file shape (per finding `classification` kept|changed, `assertedAt` `<path>:<line>`, `reason`); the authorization file fields as the writer writes them (`selection`, `exitRules`, `decisionRef`, `briefs[{path,digest,run,expects}]`, `order`, `perRunCapUsd`, `perRunCapFlag`, `ceilingUsd`, `host`, `briefCheck{path,sha256,checkedAt}`, `ownerConfirmedAt`, `plan`); and the D-28 rules (only a fresh approval authorizes, the 4.50 and 25 USD limits, relax closed under `exitRules: D-26..D-35`).

## Deviations from Plan

None - plan executed exactly as written.

Notes, none a deviation: (1) the plan's Task 1 RED evidence is taken from a namespace import of the new exports so the pure-function cases fail on a missing function instead of on loading; (2) `authorizationOf` and `flags` and the `Authorization` interface are exported, additively, so the cases can call them; (3) the compiled contract's protected globs include AVARICE's own always-protected paths beyond the conventions' list, so the `--all` report's `protectedGlobs` case asserts membership of the relevant globs, not equality with the conventions' list; (4) the per-task commit and SUMMARY commit steps ran as separate simple commands because the sandbox refuses compound commands that contain git.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-03-128 (a tampered classification: protected finding marked unprotected, dropped finding) is covered by the forged-file cases at the pure and CLI level; T-03-129 (old in-place or relaxed authorization starting a run) by the refusal cases and the `field` check on 03-49's file; T-03-130 (cap above 4.50 or ceiling above 25) by `write-authorization` and `authorizationOf`, both pinned; T-03-131 (a relax record counting toward 3 of 3) by the `relax` refusal and `relaxAllowed: false`.

## Self-Check: PASSED

- FOUND: scripts/exit-run-phase3-tools.ts, test/unit/exit-evidence.test.ts, 03-52-red-task1.json, 03-52-red-task2.json
- FOUND commits: f128c9b, 66c78ad, 44c982f, f19bdd3
- STATE.md and ROADMAP.md untouched.
