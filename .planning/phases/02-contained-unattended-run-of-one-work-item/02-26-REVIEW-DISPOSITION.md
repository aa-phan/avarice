---
phase: 02
review: 02-26-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "The path in a git object name is matched against secret globs only after symlinks in the working copy are resolved, so a revision's secret blob can be printed"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "Some integration tests only record whether git printed the secret, so they cannot fail when it does"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "Two separate tables describe git's short-option grammar and disagree; a word the first table consumes as a value skips the object-name check"
  - id: IN-01
    severity: info
    disposition: skipped
    title: "Object paths are resolved from `stagingPath`, which assumes the top of the git working copy is the staging root"
  - id: IN-02
    severity: info
    disposition: fixed
    title: "Legitimate read-only git use that the hook refuses"
  - id: IN-03
    severity: info
    disposition: fixed
    title: "`git rev-parse` and `git ls-files` are outside the output-form allow-list"
  - id: IN-04
    severity: info
    disposition: fixed
    title: "Integration test setup runs when the test file is loaded, and the corpus helper cannot express quoted words"
open: 0
total: 7
recorded: 2026-11-08T04:24:00.000Z
---

# Phase 02: Code Review Disposition (plan 02-26 scoped review)

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | fixed | Plan 02-27, gap G-02-H2 (commit 0b35653): the hook also matches the path part of a git object name against the secret globs as written, from the working copy root and from the shell's directory, before the canonical check. Proven on real git for a live link, a dangling link and a link on a parent directory. |
| WR-01 | warning | fixed | Plan 02-27 (commit 04b4111): the real-git rigs are built in `before` hooks, `git show :sub` is asserted admitted and sentinel-free, and the reported-only block is gone. |
| WR-02 | warning | fixed | Plan 02-27 (commit 06ee1fe): one operand walker serves the object check and the output check, the git rows of the value-letter table are pinned to the output forms, and `M` is dropped from the `git status` value letters. |
| IN-01 | info | skipped | The model has no admitted way to change directory (`cd` and `git -C` are not admitted and `git -c` is refused), so the hook's working copy root and shell directory match git's resolution. Documented in docs/system/containment.md rule 12. |
| IN-02 | info | fixed | Plan 02-27 (commit 06ee1fe): `shell-git-output` and `shell-git-object` denials carry a corrective reason that names the admitted spelling, printed after the rule. |
| IN-03 | info | fixed | Plan 02-27 (commit 06ee1fe): a comment beside the output-form table records why `git rev-parse` and `git ls-files` have no entry and what was probed. |
| IN-04 | info | fixed | Plan 02-27 (commit 04b4111): git runs on the lexer's own words through the exported `commandWords`, and every rig sits in a `before` hook. |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
