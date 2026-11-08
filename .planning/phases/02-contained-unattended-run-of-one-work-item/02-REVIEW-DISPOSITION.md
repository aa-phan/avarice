---
phase: 02
review: 02-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "`git show <rev>:<path>` and `git log -p` bypass the secret-glob read denial"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "Unsanitized note and reason printed to the terminal (audit residual W-1, confirmed)"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "Install egress proxy admits any declared host, including loopback and private addresses"
  - id: WR-03
    severity: warning
    disposition: fixed
    title: "Check, install and list sandboxes deny only three credential directories"
  - id: WR-04
    severity: warning
    disposition: fixed
    title: "A crashed host that reports no result is charged $0"
  - id: WR-05
    severity: warning
    disposition: fixed
    title: "Orphan charging is three separate ledger writes"
  - id: WR-06
    severity: warning
    disposition: fixed
    title: "Commit-id patterns disagree between adapters and domain (SHA-256 repositories)"
  - id: WR-07
    severity: warning
    disposition: fixed
    title: "`Math.min(...times)` throws on a large commit range"
  - id: WR-08
    severity: warning
    disposition: fixed
    title: "Live attended harness allows `Bash(cat:*)` (audit residual W-3, confirmed)"
  - id: WR-09
    severity: warning
    disposition: fixed
    title: "`cleanupAttended` recursively deletes directories under the real home with no containment assertion (audit residual W-2, confirmed)"
  - id: IN-01
    severity: info
    disposition: fixed
    title: "Home path committed in four live-evidence files (audit residual W-4)"
  - id: IN-02
    severity: info
    disposition: skipped
    title: "Portfolio drafts test passes vacuously on any other machine"
  - id: IN-03
    severity: info
    disposition: fixed
    title: "Literal invisible characters in the control-strip regex, with incomplete coverage"
  - id: IN-04
    severity: info
    disposition: fixed
    title: "`checkRelative` splits on backslash"
  - id: IN-05
    severity: info
    disposition: fixed
    title: "Resume silently skips reaping when it cannot"
  - id: IN-06
    severity: info
    disposition: fixed
    title: "Host invocation takes a signal that is never aborted"
  - id: IN-07
    severity: info
    disposition: deferred
    title: "`test:<text>` acceptance matches by substring"
  - id: IN-08
    severity: info
    disposition: fixed
    title: "Gated-commit recognition does not check the commit's parent"
  - id: IN-09
    severity: info
    disposition: fixed
    title: "Run-ref allowance in the checkout digest is a prefix match"
open: 0
total: 19
recorded: 2026-11-08T04:24:00.000Z
---

# Phase 02: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | fixed | Plan 02-26 (commits 2d6ed2f and 9383cb8 judge the path part of a git object name and allow-list the git output forms); the symlink gap its own review found was closed by plan 02-27 (0b35653). |
| WR-01 | warning | fixed | Plan 02-28 (commit 04bed71): onboard, resume and supervise print every outcome, note and error line through one printer that strips control characters. |
| WR-02 | warning | fixed | Plan 02-34 (commits 9ca3b92 and 1f0b131): the proxy resolves the name, refuses any non-public address and dials the vetted address; the conventions refuse `localhost`, single-label and IP-spelled registry hosts. Private-network registries are now unsupported, a flagged assumption for the owner (findings.md). |
| WR-03 | warning | fixed | Plan 02-33 (commits fa82c9e, aed6e62 and 18a3863): one list of twelve credential locations feeds the check, onboarding, run, graph and GSD sandboxes and the hook, and check output is stored redacted. Part not taken: the allow-list inversion, because node and npm need many system paths; a credential kept outside the list stays readable (containment.md Limits). |
| WR-04 | warning | fixed | Plan 02-32 (commit e283a45): an invocation that ended without a result event is charged its full cost reservation. |
| WR-05 | warning | fixed | Plan 02-32 (commit 18d8e89): a settlement and an orphan conversion are written in one ledger transaction. |
| WR-06 | warning | fixed | Plan 02-29 (commit 8cefde8): commit ids are 40 lowercase hex digits and a SHA-256 repository is refused at the first commit read. |
| WR-07 | warning | fixed | Plan 02-29 (commit 808467b): the oldest commit time is a single-pass minimum, so a 150000-line history no longer throws. |
| WR-08 | warning | fixed | Plan 02-31 (commit b4f7a64): the attended allow list holds only `git status` and `git log --oneline` for git and no `cat`, `head`, `git diff` or `git show` rule. Open question left to a live session: whether the host admits a redirect through a prefix rule such as `ls:*` (test/containment/LIVE-CASES.md). |
| WR-09 | warning | fixed | Plan 02-31 (commit b4f7a64): `cleanupAttended` checks real paths and the fixture tag before it removes anything and throws otherwise. |
| IN-01 | info | fixed | Narrow fix only: plan 02-31 (commits 8807d4a and f148e3d) makes the live recorders write the home directory as `~` and rewrites the four committed evidence files. The wider residue (28 spike evidence files, one spike script, one proposal document and 115 planning files) is deferred to the owner's decision on a public release. |
| IN-02 | info | skipped | Not a defect: node:test reports those cases as skipped with the reason printed, and the parse and compile cases run unconditionally. |
| IN-03 | info | fixed | Plan 02-28 (commit 6a47d78): the control-strip class covers the full bidi, zero-width, word-joiner and byte-order-mark set, written with `\u` escapes and guarded by an ASCII-only source test. |
| IN-04 | info | fixed | Plan 02-29 (commit 808467b): clone paths are split at a slash only, so a file named `a\b` is one name. |
| IN-05 | info | fixed | Plan 02-30 (commit b44e22c): a started launch that cannot be reaped (no session ID, or a host with no reap) stops the resume with every row still started. |
| IN-06 | info | fixed | Plan 02-30 (commit ce09fa9): the run's abort signal is aborted when the supervisor loses its lease, which ends the unit's host. Part not taken: an abort on SIGTERM, because a handler would turn an operator stop into a cancelled unit that the stage classifies and retries, which needs its own design and an owner decision (threat T-02-108 accepted; runs.md Quirks; findings.md). |
| IN-07 | info | deferred | Substring matching of `test:<text>` is the documented behavior and the owner's R1 briefs depend on it, while the proposal shows exact IDs. Recorded as a spec contradiction in docs/system/findings.md (`src/app/run-stages/finish.ts:206`) for the owner to decide. |
| IN-08 | info | fixed | Plan 02-30 (commit b44e22c): a gated item's moved HEAD is the supervisor's commit only with matching trailers and one parent equal to the attempt's snapshot head. |
| IN-09 | info | fixed | Plan 02-29 (commit 2e0bda1): `--allow-run-refs` allows exactly one segment under the run prefix. Part not taken: the review's `refsAllowed <= 1` assertion, because the Phase 2 exit evidence tool already fails any new ref other than the run's own branch. |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
