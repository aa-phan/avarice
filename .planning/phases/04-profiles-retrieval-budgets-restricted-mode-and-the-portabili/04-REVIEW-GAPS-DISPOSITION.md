---
phase: 04
review: 04-REVIEW-GAPS.md
titles: json
findings:
  - id: GCR-01
    severity: critical
    disposition: fixed
    title: "The approval prompt cuts every bound value at 80 characters, so the `gitOptions` and `env` that CR-03's fix binds can be hidden from the owner (cites CR-03)"
  - id: GWR-01
    severity: warning
    disposition: fixed
    title: "`gh pr -R <repo> create` and the other forms with a persistent flag between the group and the subcommand are not classified (cites WR-03 for the analogous npm case)"
  - id: GWR-02
    severity: warning
    disposition: fixed
    title: "Brace expansion hides a privileged command, and neither the scanner nor the documented residuals mention it"
  - id: GWR-03
    severity: warning
    disposition: fixed
    title: "A git alias defined on the same line (`git -c alias.p=push p`) is not classified"
  - id: GWR-04
    severity: warning
    disposition: fixed
    title: "One out-of-scope file with an ordinary name makes `patch()` refuse, so the whole restricted patch is dropped (cites WR-13)"
  - id: GWR-05
    severity: warning
    disposition: fixed
    title: "A bindings lock left by a crashed writer whose PID is reused is never taken over, so every binding write fails with `unavailable`"
  - id: GWR-06
    severity: warning
    disposition: fixed
    title: "A corrupt profile config is still skipped, so its profile's roots are not denied; WR-17's fix covers only an unreadable one (cites WR-17)"
  - id: GWR-07
    severity: warning
    disposition: fixed
    title: "The new bindings race test never shows that the two writers overlapped, which is the defect WR-42 recorded for the other race tests (cites WR-42)"
  - id: GIN-01
    severity: info
    disposition: fixed
    title: "A here-document with an unquoted delimiter is scanned twice, so one `$(git push)` in it asks for two approvals"
  - id: GIN-02
    severity: info
    disposition: fixed
    title: "The wrapper and launcher list is a fixed allow-list; common ones are missing and the residual text does not name them"
  - id: GIN-03
    severity: info
    disposition: fixed
    title: "A Grep with a brace glob is refused with a reason that says it has no glob"
  - id: GIN-04
    severity: info
    disposition: fixed
    title: "`stepSpendUsd` records the whole cap for any step with no `invocation.finished`, even a step that never started a model"
  - id: GIN-05
    severity: info
    disposition: fixed
    title: "A reused pack item keeps the flags it was built with"
total: 13
recorded: 2026-11-25T00:00:00.000Z
---

# Phase 04: Code Review Gaps Disposition

The review is `04-REVIEW-GAPS.md`; the owner ruled every finding fix on 2026-11-23 (`04-UAT.md`). All 13 findings are fixed by plans 04-56 to 04-63. Each fix was driven by a test that failed first, and the failing run is kept as the red record named below. The commits are those of `git log --oneline ed9e123..HEAD`; the plan SUMMARY files list the tests, files and verification of each.

| Finding | Severity | Disposition | UAT gap | Plan | Fix commits | Red record |
|---------|----------|-------------|---------|------|-------------|------------|
| GCR-01 | critical | fixed | G-04-1 | 04-56 | `0c1dee0` (attended refusal), `e113216` (run and gate), `f06df42` (documentation) | `04-56-red-task1.json`, `04-56-red-task2.json` |
| GWR-01 | warning | fixed | G-04-2-GWR-01 | 04-57 | `e5fd2d3` (test), `2c8c3ac` (fix) | `04-57-red-task1.json` |
| GWR-02 | warning | fixed | G-04-2-GWR-02 | 04-62 | `d7c26c2` (test), `6d74e0f` (fix), `0bc645a` (test), `8090119` (row text) | `04-62-red-task1.json`, `04-62-red-task2.json` |
| GWR-03 | warning | fixed | G-04-2-GWR-03 | 04-57 | `844cc4e` (test), `1dd8ac1` (fix) | `04-57-red-task2.json` |
| GWR-04 | warning | fixed | G-04-2-GWR-04 | 04-58 | `7842114` (fix), `24b2cf7` (test) | `04-58-red-task1.json`, `04-58-red-task2.json` |
| GWR-05 | warning | fixed | G-04-2-GWR-05 | 04-59 | `d0dcd67` (test), `9a96983` (fix) | `04-59-red-task1.json` |
| GWR-06 | warning | fixed | G-04-2-GWR-06 | 04-59 | `17f366c` (test), `3158918` (fix) | `04-59-red-task2.json` |
| GWR-07 | warning | fixed | G-04-2-GWR-07 | 04-59 | `2d21aa2` (test), `6633b13` (test helper); a test-only fix, the defect is the test | `04-59-red-task3.json` |
| GIN-01 | info | fixed | G-04-2-GIN-01 | 04-57 | `e45d02e` (test), `bb186b0` (fix) | `04-57-red-task3.json` |
| GIN-02 | info | fixed | G-04-2-GIN-02 | 04-63 | `1644986` (test), `77fd1a8` (wrappers and launchers), `0af3e81` (test), `2bd1e03` (string forms, here-strings, residual list) | `04-63-red-task1.json`, `04-63-red-task2.json` |
| GIN-03 | info | fixed | G-04-2-GIN-03 | 04-60 | `f3ee009` | `04-60-red-task1.json` |
| GIN-04 | info | fixed | G-04-2-GIN-04 | 04-61 | `3df584b` (test), `ba323be` (fix) | `04-61-red-task3.json` |
| GIN-05 | info | fixed | G-04-2-GIN-05 | 04-60 | `59e06cd` | `04-60-red-task2.json` |

Each red record is in this directory. GCR-01 is the gap of UAT test 1; the other 12 are the gaps `G-04-2-<finding>` of UAT test 2. A fix whose test and fix share one commit, such as `f3ee009` and `59e06cd`, has its failing run in the red record, not in an earlier commit.
