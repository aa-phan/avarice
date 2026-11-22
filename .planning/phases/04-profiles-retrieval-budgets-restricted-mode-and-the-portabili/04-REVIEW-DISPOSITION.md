---
phase: 04
review: 04-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "Attended hook allows any privileged command longer than 65,536 characters, and the parser fails open past its nesting and wrapper limits (part A)"
  - id: CR-02
    severity: critical
    disposition: open
    title: "A double-quoted `)` inside `$(...)` makes the splitter lose the rest of the line, hiding a privileged command (part A)"
  - id: CR-03
    severity: critical
    disposition: open
    title: "The approval digest omits git global options and leading environment assignments, so an approved push can go to a different target (part A)"
  - id: CR-04
    severity: critical
    disposition: open
    title: "Attended hook lets one approval authorize every privileged command in a compound shell line (part D)"
  - id: CR-05
    severity: critical
    disposition: open
    title: "Catastrophic regex backtracking in the planning-section heading parser hangs the supervisor on a hostile repository (part E)"
  - id: WR-01
    severity: warning
    disposition: open
    title: "Common literal wrappers and quoting forms are not parsed, so `git push` inside them is not seen (part A)"
  - id: WR-02
    severity: warning
    disposition: open
    title: "Wrapper table lookup reads the prototype chain, so a command named `constructor` or `__proto__` crashes the classifier (part A)"
  - id: WR-03
    severity: warning
    disposition: open
    title: "`npm publish` is not recognized when an unlisted valued option comes first (part A)"
  - id: WR-04
    severity: warning
    disposition: open
    title: "`gh api` approval binds endpoint and method but not the request body (part A)"
  - id: WR-05
    severity: warning
    disposition: open
    title: "`knowledgeChunkLimit` returns NaN for a negative cost cap, which removes the cost cap (part A)"
  - id: WR-06
    severity: warning
    disposition: open
    title: "Broad-discovery gate is bypassed by a Grep `glob` or `type` that matches everything (part A)"
  - id: WR-07
    severity: warning
    disposition: open
    title: "Onboarding resume fails open when the launching host cannot be reaped (part B)"
  - id: WR-08
    severity: warning
    disposition: open
    title: "An interrupted privileged action does not stop a run that is already blocked on another reason (part B)"
  - id: WR-09
    severity: warning
    disposition: open
    title: "The no-replay rule is not enforced by the approval gate (part B)"
  - id: WR-10
    severity: warning
    disposition: open
    title: "Path-scoped map falls back to the full read scope instead of failing (part B)"
  - id: WR-11
    severity: warning
    disposition: open
    title: "The whole-file read caps are not enforced by anything a run does (part B)"
  - id: WR-12
    severity: warning
    disposition: open
    title: "A restricted run whose host leaves an unreadable or oversize output aborts the stage after the host ran, and every resume launches the host again (part C)"
  - id: WR-13
    severity: warning
    disposition: open
    title: "The restricted patch is never checked against the contract's write scope, although the owner is told to `git apply` it (part C)"
  - id: WR-14
    severity: warning
    disposition: open
    title: "A kill between activation and the start of a requested promotion leaves it neither done nor reported (part C)"
  - id: WR-15
    severity: warning
    disposition: open
    title: "Bindings registry write is an unlocked read-modify-write; concurrent writers drop a binding (part D)"
  - id: WR-16
    severity: warning
    disposition: open
    title: "`cmd:` provider rejects a good credential when the helper's stderr is large (part D)"
  - id: WR-17
    severity: warning
    disposition: open
    title: "Profile registry skips a profile config it could not read, so that profile's moved roots are not denied (part D)"
  - id: WR-18
    severity: warning
    disposition: open
    title: "A code node's graph excerpt carries untrusted neighbour IDs and descriptions but is not marked untrusted (part E)"
  - id: WR-19
    severity: warning
    disposition: open
    title: "`gsd-intel` excerpts are never marked untrusted (part E)"
  - id: WR-20
    severity: warning
    disposition: open
    title: "`gsd-planning` `refresh` reads through intermediate symbolic links, contradicting the adapter's stated guarantee (part E)"
  - id: WR-21
    severity: warning
    disposition: open
    title: "Excluded read directories are only excluded at the repository root (part E)"
  - id: WR-22
    severity: warning
    disposition: open
    title: "Promotion path check admits `.git` segments and non-canonical paths at the one boundary that writes to the user's checkout (part E)"
  - id: WR-23
    severity: warning
    disposition: open
    title: "`patch()` returns a lossy UTF-8 decoding of a binary-capable diff (part E)"
  - id: WR-24
    severity: warning
    disposition: open
    title: "`install-host` refuses only on the AVARICE_RUN variable, not on a run's process tree, although it now writes an executable hook entry (part F)"
  - id: WR-25
    severity: warning
    disposition: open
    title: "`install-host` writes a hook entry that blocks on failure without checking that the hook script exists (part F)"
  - id: WR-26
    severity: warning
    disposition: open
    title: "A corrupt binding or enterprise-pattern registry makes `avarice doctor` exit 3 before it can diagnose anything (part F)"
  - id: WR-27
    severity: warning
    disposition: open
    title: "`approve` reports a missing approval request as \"no such approval\" (part F)"
  - id: WR-28
    severity: warning
    disposition: open
    title: "AC-8 summary counts infrastructure failures as task failures and ignores `tokensComplete`, contradicting the documented judge-error semantics (part G)"
  - id: WR-29
    severity: warning
    disposition: open
    title: "Token comparison uses raw totals while success uses rates; unequal task counts make the AC-8 token test and the D-08 rule wrong (part G)"
  - id: WR-30
    severity: warning
    disposition: open
    title: "`spendStep` can under-record (or lose) the spend of a step that really ran (part G)"
  - id: WR-31
    severity: warning
    disposition: open
    title: "AC-14 `run-one` records 0 spend when the ledger read fails, and under-records partially reported costs (part G)"
  - id: WR-32
    severity: warning
    disposition: open
    title: "A completed, paid run is discarded, and the whole evaluation halts, when judge preparation throws (part G)"
  - id: WR-33
    severity: warning
    disposition: open
    title: "`eval-retrieval.ts --live` has no owner-authorization gate; the ceiling is the only guard (part G)"
  - id: WR-34
    severity: warning
    disposition: open
    title: "The AC-14 spend authorization is a plain JSON field the agent can write, so the TTY check in `authorize` is not a guard (part G)"
  - id: WR-35
    severity: warning
    disposition: open
    title: "`exit-run-phase4.sh --run --only <unknown id>` exits 0 having run nothing; `--ruling-ref` without `--only` applies to every repository (part G)"
  - id: WR-36
    severity: warning
    disposition: open
    title: "The arm repository still contains the denied files in git history, contradicting the stated guarantee, and `assertNoLeak` does not check it (part G)"
  - id: WR-37
    severity: warning
    disposition: open
    title: "The fake-remote \"duplicate\" fault changes nothing, so the tests that claim duplicate tolerance pass vacuously (part G)"
  - id: WR-38
    severity: warning
    disposition: open
    title: "doctor and doctor-versions tests flake under load because the doctor probe timeout is a fixed 1 s and the fake `claude` is a Node process (part H)"
  - id: WR-39
    severity: warning
    disposition: open
    title: "the artifact-kind source scan misses call sites written with the `{ kind, runId }` shorthand, so the \"a new kind cannot be added without deciding whether it is redacted\" guard has a hole (part H)"
  - id: WR-40
    severity: warning
    disposition: open
    title: "credential-ref tests `return` early on an unexpected error kind, silently skipping the remaining assertions (part H)"
  - id: WR-41
    severity: warning
    disposition: open
    title: "the moved-roots sandbox denial is judged only by `exitCode !== 0`, which a timeout, a cancellation or a broken `ls`/`cat` also satisfies (part H)"
  - id: WR-42
    severity: warning
    disposition: open
    title: "the two process-race tests pass when the processes run one after the other, so they cannot show the race they claim (part H)"
  - id: IN-01
    severity: info
    disposition: open
    title: "`evaluatePolicy` treats an omitted `organization` as \"no organization policy\" even for an enterprise profile (part A)"
  - id: IN-02
    severity: info
    disposition: open
    title: "`normalizeRemote` mis-parses a URL with a raw `@` in the password, so the remote can miss an enterprise pattern (part A)"
  - id: IN-03
    severity: info
    disposition: open
    title: "Policy action table has actions that no shell form can reach (part A)"
  - id: IN-04
    severity: info
    disposition: open
    title: "Run start records the brief reference after the run is created, and the active-run limit check is not atomic (part B)"
  - id: IN-05
    severity: info
    disposition: open
    title: "`openSync(path, O_RDONLY)` on a FIFO blocks the process (part B)"
  - id: IN-06
    severity: info
    disposition: open
    title: "A run's cumulative retrieval caps use the contract rows, not the profile caps in force now (part B)"
  - id: IN-07
    severity: info
    disposition: open
    title: "A redacted restricted patch can stop applying, and the block text does not say so (part C)"
  - id: IN-08
    severity: info
    disposition: open
    title: "Whether an onboarding is restricted is read only from the mapping plan, and an absent plan selects the contained host (part C)"
  - id: IN-09
    severity: info
    disposition: open
    title: "`spendBudgets` turns a repeated row name into a `conflict` instead of a refusal (part D)"
  - id: IN-10
    severity: info
    disposition: open
    title: "`readEnterprisePatterns` follows a symbolic-link profile directory that `knownProfileRoots` refuses (part D)"
  - id: IN-11
    severity: info
    disposition: open
    title: "Attended hook spends the approval before the host decides whether the command runs (part D)"
  - id: IN-12
    severity: info
    disposition: open
    title: "Circular imports between `staging-base.ts` and `promotion.ts` / `staged-specs.ts` (part E)"
  - id: IN-13
    severity: info
    disposition: open
    title: "`commitPromotion` does not guard NUL in the message; `copyIntoCheckout` loses its progress on a late error (part E)"
  - id: IN-14
    severity: info
    disposition: open
    title: "`approve` shows the full request and asks before checking whether it was already granted (part F)"
  - id: IN-15
    severity: info
    disposition: open
    title: "The host configuration directory and hook entry are resolved by four slightly different copies (part F)"
  - id: IN-16
    severity: info
    disposition: open
    title: "`readInputFile` can block forever on a FIFO path given to `evidence add --file` or `context add --file` (part F)"
  - id: IN-17
    severity: info
    disposition: open
    title: "Importing `test/helpers/live-harness.ts` mutates `process.env` for every importer, which makes `eval-retrieval.ts`'s own conditional dead (part G)"
  - id: IN-18
    severity: info
    disposition: open
    title: "`status-bench.ts` derives its path from `URL.pathname` (part G)"
  - id: IN-19
    severity: info
    disposition: open
    title: "The executor contract case \"denies the network\" has no positive control (part G)"
  - id: IN-20
    severity: info
    disposition: open
    title: "Task `id` is used unvalidated as a path component (part G)"
  - id: IN-21
    severity: info
    disposition: open
    title: "`briefFor` does not neutralize fence lines or enforce brief limits (part G)"
  - id: IN-22
    severity: info
    disposition: open
    title: "Robustness gaps in the live driver's setup and evidence copy (part G)"
  - id: IN-23
    severity: info
    disposition: open
    title: "`git push` no longer exercises the denied-prefix path in the \"deny beats allow\" mutation test (part H)"
  - id: IN-24
    severity: info
    disposition: open
    title: "approval-guard trigger assertions match only the table name (part H)"
  - id: IN-25
    severity: info
    disposition: open
    title: "the live attended case records `ghStubRan` after the second session but never asserts it (part H)"
  - id: IN-26
    severity: info
    disposition: open
    title: "fixtures are built in `describe` bodies, so they run at file load and a failure there is a suite-load failure (part H)"
  - id: IN-27
    severity: info
    disposition: open
    title: "`setup` and `teardown` of the assembler-caps describe are ordinary tests (part H)"
  - id: IN-28
    severity: info
    disposition: open
    title: "the seeded credential value is excluded from the hook-target input of the AC-5 corpus (part H)"
open: 75
total: 75
recorded: 2026-11-22T08:41:20.573Z
---

# Phase 04: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| CR-02 | critical | open | - |
| CR-03 | critical | open | - |
| CR-04 | critical | open | - |
| CR-05 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| WR-06 | warning | open | - |
| WR-07 | warning | open | - |
| WR-08 | warning | open | - |
| WR-09 | warning | open | - |
| WR-10 | warning | open | - |
| WR-11 | warning | open | - |
| WR-12 | warning | open | - |
| WR-13 | warning | open | - |
| WR-14 | warning | open | - |
| WR-15 | warning | open | - |
| WR-16 | warning | open | - |
| WR-17 | warning | open | - |
| WR-18 | warning | open | - |
| WR-19 | warning | open | - |
| WR-20 | warning | open | - |
| WR-21 | warning | open | - |
| WR-22 | warning | open | - |
| WR-23 | warning | open | - |
| WR-24 | warning | open | - |
| WR-25 | warning | open | - |
| WR-26 | warning | open | - |
| WR-27 | warning | open | - |
| WR-28 | warning | open | - |
| WR-29 | warning | open | - |
| WR-30 | warning | open | - |
| WR-31 | warning | open | - |
| WR-32 | warning | open | - |
| WR-33 | warning | open | - |
| WR-34 | warning | open | - |
| WR-35 | warning | open | - |
| WR-36 | warning | open | - |
| WR-37 | warning | open | - |
| WR-38 | warning | open | - |
| WR-39 | warning | open | - |
| WR-40 | warning | open | - |
| WR-41 | warning | open | - |
| WR-42 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |
| IN-08 | info | open | - |
| IN-09 | info | open | - |
| IN-10 | info | open | - |
| IN-11 | info | open | - |
| IN-12 | info | open | - |
| IN-13 | info | open | - |
| IN-14 | info | open | - |
| IN-15 | info | open | - |
| IN-16 | info | open | - |
| IN-17 | info | open | - |
| IN-18 | info | open | - |
| IN-19 | info | open | - |
| IN-20 | info | open | - |
| IN-21 | info | open | - |
| IN-22 | info | open | - |
| IN-23 | info | open | - |
| IN-24 | info | open | - |
| IN-25 | info | open | - |
| IN-26 | info | open | - |
| IN-27 | info | open | - |
| IN-28 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
