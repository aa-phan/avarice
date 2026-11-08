Verdict: BOUNCE

Severity: **BLOCKER** means it cannot ship, **WARNING** means it needs rework, **OBS** is worth noting.

I could not compute a SHA-256 digest, run git, or run tests: I had Read, Grep and Glob only. So this verdict is tied to the working-tree contents as read, not to a digest. I took the diff file as given and did not confirm that the two new load-sensitive tests actually failed under load. I only checked that the cited lines name those tests.

## BLOCKER

None.

## WARNING

**W1. containment.md, "Running the host": the new lease sentence says the wrong thing about the run's signal.**
- **Location:** "The caller also passes an abort signal with the same timeout. For a run, that signal is also aborted when the supervisor loses its run lease."
- **Problem:** For a run, the caller passes no timeout signal at all. The signal is the lease controller alone (`src/app/run-service.ts:127-128`, `src/app/run-stages/item.ts:526`). Only onboarding passes a timeout signal (`src/app/stages/map.ts:57`). "Also" therefore describes a signal that does not exist for a run.
- **Fix:** "An onboarding passes an abort signal with the same timeout. A run passes a signal that is aborted when the supervisor loses its run lease; its wall clock is the adapter's own."
- **Confidence:** high.

**W2. containment.md, Settlement: the startup sentence gives the wrong reason and covers too much.**
- **Location:** "A host that fails at startup and ends without a result is therefore charged a full cost reservation, because its invocation unit is spent anyway."
- **Problem 1:** The reason is wrong. The reservation is charged because a host with no result reports no cost (`src/app/invocation.ts:151-159`, `resultSeen === false`). Spending the invocation unit is not the cause.
- **Problem 2:** "Fails at startup" also covers a spawn failure. The adapter reports that as an `unavailable` error (`src/adapters/host-claude/claude-host.ts:288`, `:343`), which is not a kill. It is charged its unit and the reported cost of 0, not the reservation.
- **Fix:** "A host process that starts and exits without a result is therefore charged a full cost reservation. A host the adapter cannot start is charged its invocation unit and no cost."
- **Confidence:** high.

**W3. containment.md, egress proxy bullet: "reserved, in IPv4 or IPv6" claims more than the code checks.**
- **Location:** "If any of them is loopback, unspecified, private, shared (carrier-grade NAT), link-local, multicast or reserved, in IPv4 or IPv6, the tunnel is refused with 403…"
- **Problem:** `isPublicAddress` (`src/adapters/exec/allowlist-proxy.ts:78-105`) does not cover every reserved range.
  - In IPv4 it lets the documentation ranges through: 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24.
  - In IPv6 it only refuses unique local, link-local, multicast, and the all-zero prefix forms. It lets through 2001:db8::/32, 100::/64 and the other IPv6 reserved blocks.
- **Fix:** Name what is refused. In IPv4 that is 0/8, 240/4 and the benchmarking range. In IPv6 it is unique local, link-local, multicast, and unspecified or loopback. Alternatively, drop "reserved" for IPv6 and say "most reserved IPv4 ranges".
- **Confidence:** high.

**W4. containment.md, egress proxy bullet: the IPv4-in-IPv6 sentence covers too much.**
- **Location:** "An IPv4 address carried inside an IPv6 address is judged as that IPv4 address."
- **Problem:** Only two forms are judged by their IPv4 address: IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 (`64:ff9b::/96`) (`allowlist-proxy.ts:97-98`).
  - The IPv4-compatible form `::a.b.c.d` is refused outright (`:99`).
  - 6to4 (`2002::/16`) and Teredo (`2001::/32`) also carry an IPv4 address but are judged as public IPv6. For example, `2002:0a00:0001::` carries 10.0.0.1 and is admitted.
- **Fix:** "An IPv4-mapped address and an address under the NAT64 prefix are judged as the IPv4 address they carry."
- **Confidence:** high.

**W5. containment.md: an unchanged sentence now contradicts the new corrective-reason paragraph.**
- **Location:** The context sentence "A deny is not an error: it prints the PreToolUse deny JSON with reason `avarice: {rule}` (followed by a corrective sentence for the read-before-edit and loop rules)…" versus the new paragraph "A `shell-git-output` or `shell-git-object` refusal tells the model the admitted spelling…".
- **Problem:** The hook now also adds a corrective reason for the two git rules (`src/domain/hook-decision.ts:594-599`, `:751`; printed at `src/hook/pre-tool-use.ts:334`). The earlier sentence lists only read-before-edit and loop rules.
- **Fix:** Extend the parenthesis to "for the read-before-edit, loop and git output and object rules". Then drop "The hook prints this reason after the rule" from the new paragraph, so the mechanism is stated in one place.
- **Confidence:** high.

**W6. findings.md: several new "(now at …)" annotations point at the wrong code.** I checked about 30 annotations; these do not hold:
- `ledger.ts:170 (now at :171)`: line 171 is in `listOnboardings`. The `json_extract` scan for the blocked reason is at `src/adapters/sqlite/ledger.ts:213`.
- `ledger.ts:503 (now at :504)`: line 504 is the end of a contract read. The supersession `UPDATE … SET superseded_at` is at `:579`.
- `ledger.ts:437 (now at :438)`: line 438 is in `checkFence`. The step recorder upsert is `recordStepResult` at `:507`, with `ON CONFLICT` at `:514`.
- `ledger.ts:635 (now at :636)`: line 636 is `createBudgets`. The artifact `INSERT OR IGNORE` is at `:739`.
- `ledger.ts:620 (now at :621)`: line 621 is the `insertEvent` comment. The `budget_exhausted` classification is at `:709` and `:719`.
- `graphify.ts:131 (now at :132)`: line 132 is the missing-binary branch. The version is recorded at `src/adapters/graph/graphify.ts:138-140`.
- The reworded line `item.ts:611 (now at :629)` keeps its inner cite `item.ts:639`. Line 639 is now the invocations-budget check. The enforcement-failure test is at `src/app/run-stages/item.ts:657`.

The pattern suggests the Phase 1 ledger lines, which were already stale, were each shifted by +1 without being opened.
- **Fix:** Re-point each annotation at the lines given above.
- **Confidence:** high.

## OBS

**O1. containment.md, check-order step 5: the example does not show the "even" clause.**
- **Location:** "…even a word that rule 11 read as an option value. For example `git status -M HEAD:.env` is `deny-secret-read`…"
- **Problem:** Rule 11 does not read `-M` of `git status` as taking a value, because `SHORT_VALUE_OPTIONS['git status']` is `''` (`hook-decision.ts:354`). `HEAD:.env` is an operand under both tables, so the example does not show what the "even" clause describes. The stated verdict is correct (`test/unit/hook-decision.test.ts:1245`).
- **Fix:** Present it as an example of the operand rule only, or drop "even a word that rule 11 read as an option value".
- **Confidence:** medium.

**O2. containment.md: one fact is stated in several places.**
- **Problem:** The as-written match of an object path is described three times: in the canonical-path paragraph, in the read-rules paragraph and in rule 12. The symlink over-deny appears in both rule 12 and the new Quirks bullet.
- **Fix:** Keep rule 12 as the owner and reduce the other two paragraphs to a pointer. The Quirks bullet can stay if Quirks is meant as a summary list.
- **Confidence:** medium.

## Verified, no finding

- **Rule 12 and the read-rules paragraph:** two bases, `.` removed and `..` applied on the string, climbing above `/` gives `outside-read-set`, then the canonical read rules (`hook-decision.ts:515-538`, `normalized-root.ts:12-24`). `cd` and `git -C` are not admitted (`invocation-scope.ts:85-97`). The symlink-in-revision over-deny is real.
- **The corrective-reason paragraph's content:** matches `GIT_RULE_REASONS`.
- **Settlement:**
  - One transaction (`budget.ts:210-215`).
  - A crash is charged its reservation (`invocation.ts:159`).
  - An orphan's charge and event are written in one transaction, with no wall clock charged (`budget.ts:111-125`).
- **Credential locations:** the list matches `CREDENTIAL_PATHS` (`invocation-scope.ts:387-400`). The list is shared by the onboarding and run scopes (`:291`, `:542`), the run write denials (`:514`), the checks (`checks.ts:121`), graphify (`graphify.ts:92`) and GSD (`gsd-onboarding.ts:106`).
- **Check-output redaction:** `checks.ts:228`. The two removed findings lines (proxy address check, unredacted check output) are no longer needed.
- **Proxy:** connects to the vetted address (`allowlist-proxy.ts:196`); a lookup failure gives 502 and is recorded as allowed (`:188-191`). The conventions' host refusals are at `conventions.ts:237`.
- **Lease abort:** ends the process group as the wall clock does and stays settled (`claude-host.ts:311-319`, `item.ts:527-532`).
- **Limits and Quirks bullets:** accurate.
- **New findings lines:**
  - `finish.ts:206` (substring match; proposal at `:126`).
  - `map.ts:57`.
  - `supervise.ts:35` (no SIGTERM handler exists in `src/cli`).
  - `settings.ts:109`.
  - `allowlist-proxy.ts:91`.
  - `run-start.test.ts:23`, `shell-supervisor.test.ts:111`, `claude-host.test.ts:705`.
- **Correct annotations:**
  - `hook-decision.ts:238`, `:260`, `:267`, `:527`, `:656`, `:790` and `:820`.
  - `ledger.ts:469`, `:485`, `:759`, `:916`, `:954`, `:1043`, `:1119`, `:1197` and `:1271`.
  - `checks.ts:91`, `:121`, `:156`, `:159`, `:201`, `:206` and `:235`.
  - `item.ts:573`, `:629`, `:644`, `:837` and `:866`.
  - `conventions.ts:249`.
  - `run-workspace.ts:202` and `:417`.
  - `run-source.ts:55`.
  - `invocation.ts:177` and `:405`.
  - `onboard.ts:13` and `:31`.
  - `invocation-scope.ts:500`.
  - `budget.ts:115` and `:130`.

No dashes, delivery history in prose, sentences over 35 words, or heading-case problems in the changed text.
