---
phase: 02
review: 02-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "`git show <rev>:<path>` and `git log -p` bypass the secret-glob read denial"
  - id: WR-01
    severity: warning
    disposition: open
    title: "Unsanitized note and reason printed to the terminal (audit residual W-1, confirmed)"
  - id: WR-02
    severity: warning
    disposition: open
    title: "Install egress proxy admits any declared host, including loopback and private addresses"
  - id: WR-03
    severity: warning
    disposition: open
    title: "Check, install and list sandboxes deny only three credential directories"
  - id: WR-04
    severity: warning
    disposition: open
    title: "A crashed host that reports no result is charged $0"
  - id: WR-05
    severity: warning
    disposition: open
    title: "Orphan charging is three separate ledger writes"
  - id: WR-06
    severity: warning
    disposition: open
    title: "Commit-id patterns disagree between adapters and domain (SHA-256 repositories)"
  - id: WR-07
    severity: warning
    disposition: open
    title: "`Math.min(...times)` throws on a large commit range"
  - id: WR-08
    severity: warning
    disposition: open
    title: "Live attended harness allows `Bash(cat:*)` (audit residual W-3, confirmed)"
  - id: WR-09
    severity: warning
    disposition: open
    title: "`cleanupAttended` recursively deletes directories under the real home with no containment assertion (audit residual W-2, confirmed)"
  - id: IN-01
    severity: info
    disposition: open
    title: "Home path committed in four live-evidence files (audit residual W-4)"
  - id: IN-02
    severity: info
    disposition: open
    title: "Portfolio drafts test passes vacuously on any other machine"
  - id: IN-03
    severity: info
    disposition: open
    title: "Literal invisible characters in the control-strip regex, with incomplete coverage"
  - id: IN-04
    severity: info
    disposition: open
    title: "`checkRelative` splits on backslash"
  - id: IN-05
    severity: info
    disposition: open
    title: "Resume silently skips reaping when it cannot"
  - id: IN-06
    severity: info
    disposition: open
    title: "Host invocation takes a signal that is never aborted"
  - id: IN-07
    severity: info
    disposition: open
    title: "`test:<text>` acceptance matches by substring"
  - id: IN-08
    severity: info
    disposition: open
    title: "Gated-commit recognition does not check the commit's parent"
  - id: IN-09
    severity: info
    disposition: open
    title: "Run-ref allowance in the checkout digest is a prefix match"
open: 19
total: 19
recorded: 2026-11-07T10:13:47.116Z
---

# Phase 02: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| WR-06 | warning | open | - |
| WR-07 | warning | open | - |
| WR-08 | warning | open | - |
| WR-09 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |
| IN-08 | info | open | - |
| IN-09 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
