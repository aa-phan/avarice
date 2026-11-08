---
phase: 02-contained-unattended-run-of-one-work-item
plan: 02-35-round
reviewed: 2026-11-08T00:00:00Z
depth: standard
diff_range: 2ac2b63..HEAD
files_reviewed: 29
files_reviewed_list:
  - scripts/checkout-digest.ts
  - scripts/exit-run-phase2-tools.ts
  - src/adapters/exec/allowlist-proxy.ts
  - src/adapters/git/run-source.ts
  - src/adapters/git/run-workspace.ts
  - src/adapters/git/staging-base.ts
  - src/adapters/graph/graphify.ts
  - src/adapters/gsd/gsd-onboarding.ts
  - src/adapters/sqlite/ledger.ts
  - src/app/budget.ts
  - src/app/checks.ts
  - src/app/invocation.ts
  - src/app/run-resume.ts
  - src/app/run-service.ts
  - src/app/run-stages/item.ts
  - src/app/run-stages/stage.ts
  - src/cli/commands/onboard.ts
  - src/cli/commands/resume.ts
  - src/cli/commands/supervise.ts
  - src/cli/render/style.ts
  - src/domain/conventions.ts
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - src/domain/normalized-root.ts
  - src/ports/ledger.ts
  - src/ports/run-workspace.ts
  - test/helpers/fake-run-host.ts
  - test/helpers/live-attended.ts
  - test/helpers/live-harness.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Gap-closure round 02-27..02-35: Scoped Code Review Report

**Reviewed:** 2026-11-08
**Depth:** standard
**Files Reviewed:** 29
**Diff range:** 2ac2b63..HEAD (changed hunks only; surrounding code read for context)
**Status:** issues_found

## Summary

The round's changes were read hunk by hunk: the DNS-pinning proxy and its address classifier, the atomic budget settlement (`settleBudgets`), the lease-loss abort signal, the reap and reconcile hardening, the lexical secret-glob check on git object names, the git output-form walker, the credential-path list, the check-output redaction, the cleanup guard and `redactHome` in the live helpers, and the CLI output unification. `tsc -p .` (the project's `typecheck`) passes with no output. No test suite was run, and no live or paid run was made. Reproductions below are code traces unless stated otherwise.

No blocker was found. The two changes with the most risk were traced end to end and hold:

- The lexical object-name check (`lexicalObjectRule`) closes CR-01 of 02-26. It matches the name as written from both git's base (the staging root) and the shell's directory, and it handles `..` and `.` on the string without touching the file system.
- `settleBudgets` runs every charge and the event in one `tx`. A conflict inside it aborts the whole transaction, so the charge order change in `settleInvocation` and `chargeOrphans` is safe.

The four warnings are behavioral risks the new code introduces: a connectivity regression in the proxy, a destructive abort on any renewal error, an incomplete invisible-character set in the terminal sanitizer whose stated purpose is to hide nothing, and a budget policy that charges the full reservation for a host that failed before it ran. The info items are smaller gaps and overstatements.

## Warnings

### WR-01: The proxy dials only the first resolved address, so a host with an unreachable first address now fails where it used to connect

**File:** `src/adapters/exec/allowlist-proxy.ts:152-161` (resolver, `lookup(..., { all: true, verbatim: true })` then `ok(first.address)`) and `src/adapters/exec/allowlist-proxy.ts:196` (`connect(target.port, resolved.value)`)

**Issue:** `resolvePublicAddress` checks every returned address, then returns only `found[0]`. `admit` dials that one address. `verbatim: true` keeps the resolver's order, so a name with AAAA and A records (registry.npmjs.org is one) is dialed on its IPv6 address first. On a machine whose IPv6 route is missing or broken, `connect` fails with ENETUNREACH or EHOSTUNREACH, the `error` handler answers `502 Bad Gateway`, and the tunnel is never tried on the A record. Before this round `connect(port, hostname)` used Node's address-family auto-selection and would have fallen back. The sandboxed check or host would see its registry fetch fail for a reason that has nothing to do with the allowlist. This is traced from the code; not executed.

**Fix:** keep the vetting but let Node still pick among the vetted addresses. Return the whole vetted list from the resolver and give `connect` a `lookup` that returns it without a second resolution:

```ts
const addrs = vetted.map((a) => ({ address: a.address, family: a.family }));
const upstream = connect({
  port: target.port,
  host: target.host, // used only for SNI-less bookkeeping; the lookup below decides the address
  lookup: (_name, options, cb) => (options.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family)),
});
```

Or try each vetted address in order until one connects.

### WR-02: Any failed lease renewal aborts the host in flight, including a transient store error, and the killed unit is charged its full reservation

**File:** `src/app/run-service.ts:134-140` (timer) and `src/app/run-service.ts:160-163` (loop)

**Issue:** The timer treats every `renewRunLease` failure as "another process took over": it records `lease.lost`, stops the timer and calls `lost.abort()`. The abort ends the host's process group at once (`claude-host.ts:319`), and `completeRunInvocation` then charges the killed invocation `max(reported, costCapUsd)`. A renewal can fail for reasons that are not a takeover, for example a busy or briefly unavailable SQLite store, which `renewLeaseOn` returns as a store error through `tx`. Before this round such a failure stopped the loop at its next check and left a running host to finish. Now one transient write failure kills a healthy unit mid-flight, spends its whole cost reservation, and leaves the run to a resume. The 02-31 message "the lease was lost during the unit" is also reported for a lease that was never lost.

**Fix:** abort only when the renewal failed because the lease was lost (the `conflict` kind), and treat other errors as retryable until the lease has actually expired:

```ts
if (!renewed.ok) {
  lease.lost = renewed.error;
  clearInterval(timer);
  if (renewed.error.kind === 'conflict') lost.abort();
}
```

Apply the same condition at the loop's own renewal (`run-service.ts:160`).

### WR-03: The invisible-character set in `stripControl` still lets hidden text through, which is the property the comment says it provides

**File:** `src/cli/render/style.ts:16` (`INVISIBLE_FORMAT`)

**Issue:** The comment says the class removes the characters that "hide part of" a text. It lists U+061C, U+200B-U+200F, U+202A-U+202E, U+2060, U+2066-U+2069 and U+FEFF. It omits several characters that render as nothing or that hide text:

- U+206A-U+206F (the deprecated format controls: inhibit and activate symmetric swapping, shaping and digit forms).
- The tag block U+E0000-U+E007F, which carries invisible ASCII-shaped text (the form used to hide instructions in strings an operator or a model reads).
- U+FFF9-U+FFFB (interlinear annotation anchors), U+180E, U+034F, and the blank-rendering hangul fillers U+115F, U+1160, U+3164 and U+FFA0.

`stripControl` is the single sanitizer for recorded strings reaching the terminal (T-02-03). A recorded message that contains a tag-block payload prints as an apparently empty or shorter line.

**Fix:** extend the class (the tag block needs the `u` flag):

```ts
const INVISIBLE_FORMAT = /[\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]/gu;
```

Keep the soft hyphen out, as now.

### WR-04: A host that ends with no result event is charged its full reservation, so a failure that spent nothing can exhaust the cost budget

**File:** `src/app/invocation.ts:159` (`d.resultSeen === false` added to `wasKilled`)

**Issue:** `resultSeen === false` now marks the invocation killed, and `settleInvocation` charges `max(reported, reservation.costCapUsd)` to `costUsd`. The reasoning in the comment (a crash prints no result, so its cost is unknown) holds when the host ran. It also fires when the host process failed before any model call: a CLI that exits non-zero on a usage or login error, an exit 0 that printed nothing, a parse failure of the stream. Each such failure now spends a full per-invocation cap against the run's cost budget. With the CON-16 retry, two zero-cost failures charge two caps. The ledger event reports `basis: 'reservation'`, so the owner sees a charge for a run that spent nothing and a run that reaches `budget_exhausted` without having used the budget.

**Fix:** keep the conservative charge only when there is evidence the model could have run, for example when the stream recorded a turn or a tool call (`numTurns > 0` or `transcriptBytes > 0`), and charge the reported cost (0) when the process exited at once with an empty stream:

```ts
return d !== undefined && (d.timedOut || d.signal !== null || (d.resultSeen === false && (d.numTurns > 0 || d.transcriptBytes > 0)));
```

If the owner decision is "charge every unknown", state the consequence for fast failures in the budget documentation instead.

## Info

### IN-01: A started launch that cannot be reaped stops every resume with an `internal` error and no recovery path

**File:** `src/app/run-resume.ts:83-84`

**Issue:** The new returns fail closed, which is right for a host that may still be running. For a host with no `reap`, or a started row without a session ID, every later resume repeats the same `internal` error: the row stays `started` and nothing in the CLI marks it interrupted. `prepareRunInvocation` always writes the session ID, so the second case needs a damaged row, and the first needs a host adapter without `reap`. The message does not tell the owner what to do.

**Fix:** add the next action to the error text (for example that the host process must be ended by hand and the step marked interrupted), or document it in the resume section of `docs/system/`.

### IN-02: The proxy records an attempt as `allowed` for a 502 and as refused for a 403 on an allowlisted host

**File:** `src/adapters/exec/allowlist-proxy.ts:189-190` and `src/adapters/exec/allowlist-proxy.ts:194-195`

**Issue:** `record(host, port, !refusedHost)` writes `allowed: true` when the lookup failed (no tunnel was opened) and `allowed: false` when an allowlisted name resolved to a non-public address. A consumer that reads `attempts()` as "tunnels opened" or "names refused by the allowlist" counts both wrongly. `record(..., true)` is also written before the `client.destroyed` check, so a client that left during the lookup is reported as an allowed connection that never happened.

**Fix:** either give `EgressAttempt` an `outcome` (`allowed`, `refused-allowlist`, `refused-address`, `lookup-failed`) or document that `allowed` means "the target was on the allowlist". Move the `record` below the `destroyed` check.

### IN-03: The IPv6 classifier misses a few special-use ranges

**File:** `src/adapters/exec/allowlist-proxy.ts:84-96` (`isPublicAddress`)

**Issue:** The embedded-IPv4 forms handled are IPv4-mapped (`::ffff:0:0/96`) and NAT64 (`64:ff9b::/96`). The classifier treats these as public: 6to4 `2002::/16` and Teredo `2001::/32` (both carry an IPv4 address), SIIT `::ffff:0:0:0/96`, the discard prefix `100::/64`, and documentation `2001:db8::/32`. IPv4 test nets (192.0.2/24, 198.51.100/24, 203.0.113/24) and 192.88.99/24 are also admitted. A name would have to resolve into one of these for it to matter, and a host would need a route for it, so this is hardening, not a bypass.

**Fix:** add those prefixes to the refusal list, or restrict IPv6 to `2000::/3` minus `2001::/32`, `2001:db8::/32` and `2002::/16`.

### IN-04: `CREDENTIAL_PATHS` omits other common credential stores

**File:** `src/domain/invocation-scope.ts:384-399`

**Issue:** The list adds the right stores, and the comment already says it is a deny list over otherwise allowed reads. It still leaves out `.azure`, `.cargo/credentials.toml`, `.config/git/credentials`, `.terraform.d`, `.yarnrc.yml`, `.config/op` and `.local/share/keyrings`. Because the list is the single source for the sandbox, the hook and the write denials, an addition costs one line.

**Fix:** add the entries the owner wants denied, or record the list as intentionally minimal in `docs/system/`.

### IN-05: `redactHome`'s doc says every live recorder writes through it, but only the attended results do

**File:** `test/helpers/live-harness.ts:150-152`; call sites `test/helpers/live-attended.ts:264`, unredacted writes at `test/helpers/live-attended.ts:738`, `test/helpers/live-harness.ts:818`, `:914`, `:1415`, `:1809`

**Issue:** The comment reads "Every live recorder writes through this so committed evidence holds no local path". Only `appendAttendedResult` does. The spend ledgers (`live-harness.ts:186`, `:255`) and every `transcript*.jsonl` write the raw string. The transcripts sit in a temporary evidence directory and are not committed by the helper, so the exposure depends on what the owner copies out. The comment promises more than the code does.

**Fix:** either narrow the comment to "the attended results file", or pass the transcript text through `redactSecrets` and `redactHome` at the five write sites.

### IN-06: Test-only code in production surfaces, and a leaked sleeper when the hook callback throws

**File:** `src/domain/hook-decision.ts:335-340` (`commandWords`) and `test/helpers/fake-run-host.ts:278-291`

**Issue:** `commandWords` is exported from a production domain module for tests, with no production caller (its own comment says so); a structural unused-export check will list it. Separately, in `FakeRunHost` the sleeper (a 30-minute `setTimeout`, detached and unref'd) is started before `hang.onStart?.(req)` and before the abort wait. If `onStart` throws (for example an `assert` inside it), nothing ends the process group, so the sleeper outlives the test run by up to 30 minutes.

**Fix:** move `commandWords` into a test helper that imports `lex` through a test-only export, or keep it and mark it so. Wrap the hang in `try { ... } finally { end the group }`.

---

_Reviewed: 2026-11-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
