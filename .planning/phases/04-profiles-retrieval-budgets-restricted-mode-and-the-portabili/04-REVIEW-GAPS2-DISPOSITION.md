---
phase: 04
review: 04-REVIEW-GAPS2.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "The Phase 4 benchmark README says the ADR-017 verdict file is \"not yet present\" and gives an AC-8 token bound of 50%"
  - id: WR-02
    severity: warning
    disposition: open
    title: "`approve` displays a different text from the one the approval binds when a value holds an invisible formatting character (cites GCR-01)"
  - id: IN-01
    severity: info
    disposition: open
    title: "`coproc NAME { ... }`, `sudo -s` and `sudo -i` with a command are not classified (cites GIN-02)"
  - id: IN-02
    severity: info
    disposition: open
    title: "A git alias created earlier on the same line (`git config alias.p push && git p`) is classified as `none` (cites GWR-03)"
  - id: IN-03
    severity: info
    disposition: open
    title: "A host that leaves many out-of-scope files can still make `patch()` fail and withhold its in-scope patch (cites GWR-04)"
  - id: IN-04
    severity: info
    disposition: open
    title: "`loadCoverage` accepts any text for `judgedBy`, `judgedAt` and `method`, so the verdict's input record carries no check of who made it"
open: 5
total: 6
recorded: 2026-11-25T10:07:57.829Z
---

# Phase 04: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | fixed | 04-70, df3611a |
| WR-02 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |

The owner decided on 2026-11-25 not to fix WR-02 in this gap closure, because it changes `src` and would need both full-suite Node legs rerun, so it stays open.

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
