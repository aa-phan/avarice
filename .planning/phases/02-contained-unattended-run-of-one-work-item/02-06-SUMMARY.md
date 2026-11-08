---
phase: 02-contained-unattended-run-of-one-work-item
plan: 06
subsystem: containment
tags: [seatbelt, loopback, egress-proxy, npm-ci, spike, s2-c, d-11]
status: complete

requires:
  - phase: 01-onboarding
    provides: SandboxedExecutor, buildSeatbeltProfile, the CommandSpec contract and the footprint test (NFR-1)
provides:
  - "CommandSpec.allowLoopbackPorts and SeatbeltInput.allowLoopbackPorts: one allow line per validated loopback port after (deny network*)"
  - "src/ports/egress-proxy.ts: EgressProxy, EgressProxyHandle, EgressAttempt"
  - "src/adapters/exec/allowlist-proxy.ts: startAllowlistProxy, AllowlistEgressProxy (node:http and node:net only)"
  - "spikes/phase-2-wave-0/S2-C-npm-ci-proxy.md: A1 confirmed on npm 11.19.1 at the portfolio pin 9f1cd8d"
affects: [02-14]

actuals:
  tokens: 11500
  tasks: 3
  commits: 3
plan_head_before: 24ac85174076a35b47eff6a3f1ed36a0c035b8e6
plan_head_after: 8b8c3a5dfa76378892bce2af06f5125f25972494

tech-stack:
  added: []
  patterns:
    - "A sandboxed supervisor step gets one loopback port, never a host name; the host allowlist lives in a proxy listening on that port"
    - "A spike that needs the real network is a skipped test (AVARICE_NET=1) that doubles as its reproducer and writes its evidence to a report path"

key-files:
  created:
    - src/ports/egress-proxy.ts
    - src/adapters/exec/allowlist-proxy.ts
    - test/integration/allowlist-proxy.test.ts
    - test/containment/npm-ci-proxy.test.ts
    - spikes/phase-2-wave-0/S2-C-npm-ci-proxy.md
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-06-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-06-red-evidence-task2.json
  modified:
    - src/adapters/exec/seatbelt-profile.ts
    - src/adapters/exec/sandboxed-executor.ts
    - src/ports/command-executor.ts
    - test/containment/executor.test.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "allowLoopbackPorts is validated in buildSeatbeltProfile (integer 1..65535, else invalid with field allowLoopbackPorts) so the executor spawns nothing on a bad value"
  - "The proxy matches the exact lower-cased host:port, refuses a target with a path, userinfo, a space or a port outside 1..65535 as 400 reported as host invalid port 0, and reports host and port only"
  - "The footprint test exempts exactly one file, allowlist-proxy.ts, from the no-network-import and no-listener scan and holds it to its own rules: node:http and node:net only, no package import, one listen on 127.0.0.1"

patterns-established:
  - "Attempt records carry host, port, allowed and atMs, never a path, header or body"

requirements-completed: [CON-2, CON-5, NFR-1, ONB-10]

coverage:
  - id: D1
    description: "A sandboxed command may reach exactly the loopback ports named in allowLoopbackPorts; a second loopback port is refused, no field means no network, and a malformed port is refused before anything is spawned"
    requirement: CON-2
    verification:
      - kind: integration
        ref: "test/containment/executor.test.ts#allowLoopbackPorts, #buildSeatbeltProfile"
        status: pass
    human_judgment: false
  - id: D2
    description: "An in-repo allowlisting CONNECT proxy admits only an exact host:port, answers 403, 400, 405 and 502 as specified, reports every attempt and closes idempotently, using Node built-ins only"
    requirement: NFR-1
    verification:
      - kind: integration
        ref: "test/integration/allowlist-proxy.test.ts"
        status: pass
      - kind: unit
        ref: "test/unit/footprint.test.ts#the allowlist proxy is the only listener and it stays on the loopback"
        status: pass
    human_judgment: false
  - id: D3
    description: "S2-C: npm ci --ignore-scripts on the portfolio at 9f1cd8d succeeds through the sandbox and the proxy, every lockfile host is registry.npmjs.org, the owner's checkout is unchanged (A1 confirmed)"
    requirement: ONB-10
    verification:
      - kind: integration
        ref: "AVARICE_NET=1 test/containment/npm-ci-proxy.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The sandbox is the control and fails closed: no proxy or sandbox means no run, never an unsandboxed run or a wider profile"
    requirement: CON-5
    verification:
      - kind: integration
        ref: "test/containment/failclosed.test.ts, test/containment/executor.test.ts#without a working sandbox"
        status: pass
    human_judgment: false
---

# Phase 2 Plan 06: Loopback allowance, allowlist proxy and spike S2-C Summary

**A supervisor step can now be given exactly one loopback port, behind it an in-repo CONNECT proxy admits only `registry.npmjs.org:443`, and `npm ci --ignore-scripts` on the portfolio at 9f1cd8d ran through both: A1 is confirmed, 15 CONNECTs, all to the registry.**

## Performance

- **Duration:** about 8 min (start 18:48 UTC, end 18:55 UTC, 2026-11-05)
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 12 changed (770 insertions, 6 deletions) plus this summary

## Accomplishments

- Task 1 (tracer): `allowLoopbackPorts` on `CommandSpec` and `SeatbeltInput`. The profile gains one `(allow network-outbound (remote ip "localhost:<port>"))` line per port after `(deny network*)`; `grep -c "remote ip"` on the profile builder returns 1. Tests: the allowed port connects, a second loopback port fails, no field means neither port is reachable, and `[0]`, `[70000]`, `[1.5]`, `['80']` give `invalid` with field `allowLoopbackPorts` and spawn nothing. The existing executor and fail-closed suites pass unchanged (56 tests).
- Task 2: `EgressProxy` port and `startAllowlistProxy`. Binds 127.0.0.1 on an ephemeral port; 403 for a CONNECT off the allowlist (the upstream is never opened), 400 for a malformed target, 405 for a non-CONNECT request, 502 when an allowed upstream is down; a throwing observer cannot change what is admitted; `close()` destroys open tunnels on both sides and is idempotent. 13 loopback-only tests, stable over repeated runs.
- Task 3 (spike S2-C): the reproducer test plus the record at `spikes/phase-2-wave-0/S2-C-npm-ci-proxy.md`. npm 11.19.1, node v26.9.0: exit 0, `added 146 packages in 2s`, 271272 KiB in `node_modules`, `node_modules/.package-lock.json` present, 244 lockfile `resolved` URLs all on `registry.npmjs.org`. Two control probes: a direct `curl --noproxy '*'` fails and never reaches the proxy; a CONNECT to `example.com:443` through the proxy fails and is recorded as refused. The owner's checkout was identical before and after (`?? .env`, HEAD 9f1cd8d51f83252ad11a8c486c4245b1b9fc3066).

**A1: confirmed.** Plan 02-14's install step needs no owner decision on network access: no `*:443` widening and no offline-cache fallback.

## Task Commits

1. Task 1: `f9371ac` feat(02-06): sandboxed commands may be given exact loopback ports
2. Task 2: `4a4535a` feat(02-06): allowlisting CONNECT proxy adapter and EgressProxy port
3. Task 3: `8b8c3a5` test(02-06): spike S2-C, npm ci through the sandbox and the allowlist proxy (A1 confirmed)

Commits measured as `git rev-list --count 24ac851..8b8c3a5` = 3 (before this summary commit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The footprint test forbids the proxy's own imports and listener**
- **Found during:** Task 2
- **Issue:** `test/unit/footprint.test.ts` (NFR-1) fails any `src` file that imports `node:net` or `node:http` or calls `.listen(`. The plan requires the proxy to be built from exactly those modules and also requires the footprint test to stay green.
- **Fix:** One narrow exemption keyed to the single file `src/adapters/exec/allowlist-proxy.ts` (the same pattern the test already uses for the two process-group leaders), and a new test block that holds that file to its own rules: only `node:http` and `node:net` among network modules, no package import, exactly one `.listen(` and it is `0, '127.0.0.1'`, no `fetch`, no detached child, no `.unref()`. Every other source file is still scanned. The runtime check "no command listens on a socket while it runs" is untouched; no AVARICE command starts the proxy yet. Not weakened: containment, the hook, the sandbox profile or any gate.
- **Files modified:** test/unit/footprint.test.ts
- **Verification:** footprint suite 10/10, `npm run test:unit` 1017 pass 0 fail
- **Commit:** 4a4535a

**2. [Rule 2 - Missing critical] Control probes added to the spike test**
- **Found during:** Task 3
- **Issue:** A successful install alone does not show the sandbox denies a direct route or that the proxy refuses another host with a real client.
- **Fix:** A second test in `test/containment/npm-ci-proxy.test.ts` (same `AVARICE_NET` gate) running `curl` both ways under the same profile.
- **Commit:** 8b8c3a5

**3. [Rule 3 - Blocking] "before and after" porcelain of the owner's checkout is recorded by the test**
- **Found during:** Task 3
- **Issue:** The harness refuses git commands aimed at another directory from a worktree-isolated session, so the plan's `git -C ~/aa-phan-portfolio-v2 status --porcelain` check could not be run by hand.
- **Fix:** The test reads the checkout's status and HEAD before the clone and after the install, asserts equality, and writes both to the report; the values are in the spike record.
- **Commit:** 8b8c3a5

**Total deviations:** 3 (2 blocking, 1 missing critical). **Impact:** none on scope; the footprint exemption is the one change a reviewer should look at.

## Issues Encountered

- The harness refuses compound shell commands and git commands that name another directory; files were written with Write and Edit (plus short Python edit scripts) and git was run one at a time from the worktree root, `git rev-parse --show-toplevel` printed `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before each commit.
- No live model run and no live-spend entry: this plan never calls `claude`. The only network use was the plan-directed `AVARICE_NET=1` spike against registry.npmjs.org.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. The new listener is the one in T-02-15 and T-02-17 (127.0.0.1 only, exact allowlist, closed after one step; nothing starts it yet). The allowance exists only on `CommandSpec`; no agent invocation sets it.

## Next Phase Readiness

Plan 02-14 can start the proxy with the project's lockfile hosts as `allow`, set `allowLoopbackPorts: [proxy.port]` on the install `CommandSpec`, and read `attempts()` for ONB-10's network detection. Install scripts stay off (`--ignore-scripts`). A lockfile whose `resolved` hosts are not the registry (git or tarball URLs) is outside what S2-C proved and needs an owner decision. The requirement IDs CON-2, CON-5, NFR-1 and ONB-10 are shared with later plans, so `requirements.ready-ids` reports none ready; they are listed under `requirements-completed` and not yet marked in REQUIREMENTS.md.

## Self-Check: PASSED

- FOUND: src/ports/egress-proxy.ts, src/adapters/exec/allowlist-proxy.ts, test/integration/allowlist-proxy.test.ts, test/containment/npm-ci-proxy.test.ts, spikes/phase-2-wave-0/S2-C-npm-ci-proxy.md, 02-06-red-evidence-task1.json, 02-06-red-evidence-task2.json
- FOUND commits: f9371ac, 4a4535a, 8b8c3a5 (ancestors of HEAD)
- Plan verification: executor, failclosed, allowlist-proxy and footprint suites 81 pass 0 fail; `AVARICE_NET=1` S2-C run 2 pass; without `AVARICE_NET` the test is skipped; `node scripts/check-boundaries.ts` ok; `npx tsc -p .` clean; `npm run test:unit` 1017 pass.
