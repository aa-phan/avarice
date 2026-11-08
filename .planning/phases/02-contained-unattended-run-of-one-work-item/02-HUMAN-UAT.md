---
status: testing
phase: 02-contained-unattended-run-of-one-work-item
source: [02-VERIFICATION.md, 02-35-REVIEW.md]
started: 2026-11-08T00:00:00Z
updated: 2026-11-08T00:00:00Z
---

Owner decisions from the re-verification after gap-closure round 02-27..02-35 (commit 835ab92, status human_needed, 8/8 success criteria verified). The previous session (owner decisions after 02-26) is in git history: its two issues became G-02-H2 and G-02-H4, both closed by this round and confirmed by the verifier (G-02-H2 reproduced closed against real git; both disposition files show open: 0). The earlier completed UAT stays in 02-UAT.md.

## Current Test

number: 1
name: Owner decision on 02-35-REVIEW WR-01 (proxy dials only the first vetted address)
expected: |
  Owner accepts the behavior, or schedules a fix. The egress proxy vets every resolved address but dials only the first (src/adapters/exec/allowlist-proxy.ts:117-122, :196), so a registry whose first address is unreachable (for example an IPv6 address with no route) gets a 502 where Node would have fallen back to the next address. Traced from code, not run: no live `npm ci` has gone through the post-02-34 proxy.
awaiting: user response

## Tests

### 1. Owner decision on 02-35-REVIEW WR-01 (proxy dials only the first vetted address)

expected: Owner accepts the behavior, or schedules a fix. The egress proxy vets every resolved address but dials only the first (src/adapters/exec/allowlist-proxy.ts:117-122, :196), so a registry whose first address is unreachable (for example an IPv6 address with no route) gets a 502 where Node would have fallen back to the next address. Traced from code, not run: no live `npm ci` has gone through the post-02-34 proxy.
result: [pending]

### 2. Owner decision on 02-35-REVIEW WR-02 (any failed lease renewal aborts the host)

expected: Owner accepts, or schedules the review's fix (abort only on a lease conflict). Any failed renewal, including a transient store error, aborts the unit in flight (src/app/run-service.ts:134-140, :158-162) and charges its full reservation; no busy_timeout is set in src. Resume still recovers the run.
result: [pending]

### 3. Owner decision on 02-35-REVIEW WR-03 (invisible-character set)

expected: Owner accepts the current set, or schedules widening it. The stripped set (src/cli/render/style.ts:18) meets the plan's list but omits U+206A-206F, the tag block U+E0000-E007F, U+FFF9-FFFB, U+180E, U+034F and the Hangul fillers.
result: [pending]

### 4. Owner decision on 02-35-REVIEW WR-04 and triage of the round's info findings

expected: Owner decides the charge policy and triages the rest. A host that ends with no result event is charged its full reservation even when it failed before any model call (src/app/invocation.ts:159), so two zero-cost failures with the retry charge two reservations; the review suggests requiring evidence the model ran. The six info items (IN-01..IN-06 in 02-35-REVIEW.md) are marked fixed, skipped or deferred, recorded in a new 02-35-REVIEW-DISPOSITION.md.
result: [pending]

### 5. Owner confirmation of decisions left open on purpose

expected: Owner confirms or redirects each: (a) private-network registries are now unsupported (LAN mirror, RFC 1918/CGNAT, IP literals, localhost, single-label names, public names resolving private); (b) substring acceptance of `test:<text>` (IN-07, deferred, findings.md); (c) the remaining home-path residue (28 spike evidence files, 1 spike script, 1 proposal document, ~115 .planning files) deferred to the public-release decision; (d) an operator SIGTERM does not abort the unit in flight (accepted threat T-02-108); (e) the Read permission-deny rule does not match file-shaped credentials (.netrc, .npmrc, .git-credentials, .pgpass), which remain denied by the sandbox, the hook and the Read allow list (findings.md, settings.ts:109); (f) the live question whether the host admits a redirect through a prefix rule such as `ls:*` (LIVE-CASES.md).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
