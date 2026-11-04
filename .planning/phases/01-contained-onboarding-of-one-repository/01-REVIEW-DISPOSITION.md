---
phase: 01
review: 01-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "A host started by the intel or knowledge index step is never reaped on resume, so a resume can relaunch beside a surviving host"
  - id: CR-02
    severity: critical
    disposition: open
    title: "Shell read confinement is deny-list only and non-recursive, so secret globs, sibling staging trees and non-listed credential stores are readable"
  - id: CR-03
    severity: critical
    disposition: open
    title: "The staging diff gate cannot see gitignored files, so a hostile `.gitignore` blinds validation scope and the pre-activation scope check"
  - id: WR-01
    severity: warning
    disposition: open
    title: "Kill-point flake lead: no volatile field enters the record body, but the nested `indexes.absent` array carries timeout-bounded outcomes (not reproduced)"
  - id: WR-02
    severity: warning
    disposition: open
    title: "A transient index failure is stored as a `completed` step and never retried, so the record permanently says \"absent\""
  - id: WR-03
    severity: warning
    disposition: open
    title: "The kill-point test cannot tell a healthy reference from a degraded one and swallows a missing graph snapshot"
  - id: WR-04
    severity: warning
    disposition: open
    title: "Ledger writers other than transition, checkpoint, contract and activation carry no lease fence, so a fenced-out holder can still write"
  - id: WR-05
    severity: warning
    disposition: open
    title: "`parseArgs` crashes on flag names that collide with `Object.prototype`"
  - id: WR-06
    severity: warning
    disposition: open
    title: "The hook checks only the verb prefix of `gsd_run`, never its arguments"
  - id: WR-07
    severity: warning
    disposition: open
    title: "The sandbox probe is a 5 s `spawnSync`, cached forever per process; one slow probe makes the executor unavailable for the whole run"
  - id: WR-08
    severity: warning
    disposition: open
    title: "`exit-run.sh` spend guard fails open on a non-numeric value"
  - id: IN-01
    severity: info
    disposition: open
    title: "`bin/avarice` and `bin/avarice.ts` are identical copies"
  - id: IN-02
    severity: info
    disposition: open
    title: "Test fault and lease overrides are honored by the production entry point"
  - id: IN-03
    severity: info
    disposition: open
    title: "Digests of text read through a UTF-8 decode are not digests of the file bytes"
  - id: IN-04
    severity: info
    disposition: open
    title: "`reap` can throw on a failed `ps` spawn"
  - id: IN-05
    severity: info
    disposition: open
    title: "The profile `config.json` is written but never read"
open: 16
total: 16
recorded: 2026-11-04T06:32:47.102Z
---

# Phase 01: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| CR-02 | critical | open | - |
| CR-03 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| WR-06 | warning | open | - |
| WR-07 | warning | open | - |
| WR-08 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
