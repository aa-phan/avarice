---
phase: 02
review: 02-35-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: skipped
    title: "The proxy dials only the first resolved address, so a host with an unreachable first address now fails where it used to connect"
  - id: WR-02
    severity: warning
    disposition: skipped
    title: "Any failed lease renewal aborts the host in flight, including a transient store error, and the killed unit is charged its full reservation"
  - id: WR-03
    severity: warning
    disposition: skipped
    title: "The invisible-character set in `stripControl` still lets hidden text through, which is the property the comment says it provides"
  - id: WR-04
    severity: warning
    disposition: deferred
    title: "A host that ends with no result event is charged its full reservation, so a failure that spent nothing can exhaust the cost budget"
  - id: IN-01
    severity: info
    disposition: deferred
    title: "A started launch that cannot be reaped stops every resume with an `internal` error and no recovery path"
  - id: IN-02
    severity: info
    disposition: deferred
    title: "The proxy records an attempt as `allowed` for a 502 and as refused for a 403 on an allowlisted host"
  - id: IN-03
    severity: info
    disposition: deferred
    title: "The IPv6 classifier misses a few special-use ranges"
  - id: IN-04
    severity: info
    disposition: deferred
    title: "`CREDENTIAL_PATHS` omits other common credential stores"
  - id: IN-05
    severity: info
    disposition: deferred
    title: "`redactHome`'s doc says every live recorder writes through it, but only the attended results do"
  - id: IN-06
    severity: info
    disposition: deferred
    title: "Test-only code in production surfaces, and a leaked sleeper when the hook callback throws"
open: 0
total: 10
recorded: 2026-11-08T07:30:00.000Z
---

# Phase 02: Code Review Disposition (scoped review of gap-closure round 02-27..02-35)

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | skipped | Owner accepted the behavior at Phase 02 UAT (02-HUMAN-UAT.md test 1, 2026-11-08): the proxy dials only the first vetted address. |
| WR-02 | warning | skipped | Owner accepted the behavior at Phase 02 UAT (02-HUMAN-UAT.md test 2, 2026-11-08): any failed lease renewal aborts the unit in flight; resume recovers the run. |
| WR-03 | warning | skipped | Owner accepted the current set at Phase 02 UAT (02-HUMAN-UAT.md test 3, 2026-11-08): the stripped set meets the plan's list. |
| WR-04 | warning | deferred | Owner deferred the charge policy at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08); recorded as a deferred follow-up. |
| IN-01 | info | deferred | Owner deferred at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08). |
| IN-02 | info | deferred | Owner deferred at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08). |
| IN-03 | info | deferred | Owner deferred at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08). |
| IN-04 | info | deferred | Owner deferred at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08). |
| IN-05 | info | deferred | Owner deferred at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08). |
| IN-06 | info | deferred | Owner deferred at Phase 02 UAT (02-HUMAN-UAT.md test 4, 2026-11-08). |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved.
