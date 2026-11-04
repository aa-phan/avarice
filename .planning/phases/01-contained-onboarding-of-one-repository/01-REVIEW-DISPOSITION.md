---
phase: 01
review: 01-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "`workRoot` is required by type only; an empty or relative value silently produces a policy that denies everything"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "The WR-03 type guard is not exercised by `npm test`"
  - id: IN-01
    severity: info
    disposition: open
    title: "Stale comment cites an option form that no longer has a value-taking owner"
  - id: IN-02
    severity: info
    disposition: open
    title: "Redundant local and an unused export left behind by the deletion"
  - id: IN-03
    severity: info
    disposition: open
    title: "Misindented line, and the doc cites a test that does not cover the claim"
  - id: IN-04
    severity: info
    disposition: open
    title: "The agent gets no hint that shell grep is gone"
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "`grep -d RECURSE` and `--directories=Recurse` bypass the recursive-grep secret-glob check"
  - id: WR-03
    severity: warning
    disposition: fixed
    title: "`ScopeInput.workRoot` is optional, so omitting it silently drops the work-root deny"
  - id: WR-04
    severity: warning
    disposition: fixed
    title: "Integration assertion that the settings carry no containing Read deny is vacuous"
  - id: CR-02
    severity: critical
    disposition: open
    title: "Shell read confinement is deny-list only and non-recursive, so secret globs, sibling staging trees and non-listed credential stores are readable"
  - id: CR-03
    severity: critical
    disposition: open
    title: "The staging diff gate cannot see gitignored files, so a hostile `.gitignore` blinds validation scope and the pre-activation scope check"
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
  - id: IN-05
    severity: info
    disposition: open
    title: "The profile `config.json` is written but never read"
open: 11
total: 16
recorded: 2026-11-04T22:06:00.000Z
---

# Phase 01: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | fixed | quick 261104-nxh (0923c03) |
| WR-02 | warning | fixed | quick 261104-nxh (a942bc7) |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| CR-01 | critical | fixed | quick 261104-jnc (5e67793), superseded by 261104-l3t (99dd4fb): shell grep denied by name (not in the current review) |
| WR-03 | warning | fixed | quick 261104-jnc (974d8b1): ScopeInput.workRoot required (not in the current review) |
| WR-04 | warning | fixed | quick 261104-jnc (89f4a39): vacuous Read-deny assertion fixed (not in the current review) |
| CR-02 | critical | open | - (not in the current review) |
| CR-03 | critical | open | - (not in the current review) |
| WR-05 | warning | open | - (not in the current review) |
| WR-06 | warning | open | - (not in the current review) |
| WR-07 | warning | open | - (not in the current review) |
| WR-08 | warning | open | - (not in the current review) |
| IN-05 | info | open | - (not in the current review) |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
