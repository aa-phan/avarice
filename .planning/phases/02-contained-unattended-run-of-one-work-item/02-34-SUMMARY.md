---
phase: 02-contained-unattended-run-of-one-work-item
plan: 34
subsystem: containment
tags: [egress-proxy, ssrf, dns-rebinding, conventions, gap-closure]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: the allowlisting egress proxy (02-06), the dependency install (02-14), credential locations and integrations documentation (02-33)
provides:
  - isPublicAddress(ip) and a default resolver in the allowlist proxy; any non-public resolved address refuses the tunnel with 403
  - the tunnel is opened to the vetted address, never the name (no second resolution)
  - a test-only resolve option on startAllowlistProxy, held out of production by a footprint pin
  - readHosts refuses localhost, names under it, single-label names and numeric or 0x last labels
  - containment.md, config-reference.md and integrations.md describe the address check, the host rules and the private-registry consequence
affects: [02-35 documentation pass, verify-work 2]

plan_head_before: 65061d86bee11eaa7a458fa9313260477185cbbd
plan_head_after: 86e6fcbad23bb57993132b6d8256c3a0f3e245c7

actuals:
  tokens: 13000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "the proxy resolves and vets an allowlisted name itself and connects to the vetted address; a test-only resolve option replaces resolution and is never passed by production composition"
    - "a source-text footprint pin names every call site of startAllowlistProxy and the forwarding of the composed proxy"

key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-34-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-34-red-evidence-task2.json
  modified:
    - src/adapters/exec/allowlist-proxy.ts
    - src/domain/conventions.ts
    - test/integration/allowlist-proxy.test.ts
    - test/unit/footprint.test.ts
    - test/unit/conventions.test.ts
    - test/integration/run-deps.test.ts
    - docs/system/containment.md
    - docs/system/config-reference.md
    - docs/system/integrations.md

key-decisions:
  - "The proxy refuses an address by parsing it into numbers (node:net isIPv4/isIPv6 for the form check only); IPv4-mapped and NAT64 (64:ff9b::/96) addresses are judged by the IPv4 address they carry, and the deprecated IPv4-compatible ::/96 form is refused with :: and ::1."
  - "A resolver error of kind invalid means refused (403, recorded allowed false); any other error is a failed lookup (502, recorded allowed true). Recording happens after resolution, so a refused host shows as refused."
  - "AllowlistEgressProxy destructures allow and onAttempt and passes an object literal of those two names; the egress port is unchanged (git diff of src/ports/egress-proxy.ts is empty)."
  - "metadata.google.internal stays accepted by the conventions; only the proxy can refuse it, when it resolves to a non-public address."

patterns-established:
  - "Test seams that disable a control are pinned out of production by a source scan of every call site, not only by convention"

requirements-completed: [CON-5, RC-5, CON-1]

coverage:
  - id: D1
    description: "The install proxy resolves an allowlisted host itself, refuses the tunnel with 403 for any non-public resolved address (IPv4, IPv6, mapped), records the attempt as refused, and connects to the vetted address"
    requirement: "CON-5"
    verification:
      - kind: integration
        ref: "test/integration/allowlist-proxy.test.ts#the production proxy refuses an allowlisted host that is not public (R-WR-02, T-02-117)"
        status: pass
      - kind: integration
        ref: "test/integration/allowlist-proxy.test.ts#the proxy connects to the address its resolver vetted, never to the name (R-WR-02, T-02-118)"
        status: pass
      - kind: unit
        ref: "test/integration/allowlist-proxy.test.ts#isPublicAddress (R-WR-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The repository conventions refuse localhost, names under it, single-label names and numeric or 0x last labels as registry hosts, and accept public DNS names"
    requirement: "RC-5"
    verification:
      - kind: unit
        ref: "test/unit/conventions.test.ts#refuses a registry host that can only mean a local target"
        status: pass
      - kind: unit
        ref: "test/unit/conventions.test.ts#accepts a public DNS name as a registry host"
        status: pass
    human_judgment: false
  - id: D3
    description: "The test resolver seam stays out of production: no call site of startAllowlistProxy outside the proxy module, and the composed proxy forwards only allow and onAttempt"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/footprint.test.ts#the proxy's resolver seam stays out of production"
        status: pass
      - kind: integration
        ref: "test/integration/allowlist-proxy.test.ts#AllowlistEgressProxy refuses 127.0.0.1:<port> even when its input carries a resolve property"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/system describes the address check, the registry host rules and the private-registry consequence as built"
    verification: []
    human_judgment: true
    rationale: "Prose accuracy and the fresh prose review belong to plan 02-35; no test asserts documentation wording."

duration: 21min
completed: 2026-11-07
status: complete
---

# Phase 02 Plan 34: Proxy address vetting and registry host rules Summary

**The install proxy resolves an allowlisted name itself, refuses any non-public address (loopback, private, CGNAT, link-local, multicast, reserved, mapped) with 403 and dials the vetted address, while the conventions refuse localhost, single-label and IP-spelled registry hosts (R-WR-02)**

## Performance

- **Duration:** 21 min
- **Started:** 2026-11-08T03:54:00Z (approximate; the start was not recorded at launch)
- **Completed:** 2026-11-08T04:16:00Z
- **Tasks:** 3
- **Files modified:** 9 (plus two RED evidence files)

## Accomplishments

- R-WR-02 is fixed in both layers. Layer 1 (proxy): `isPublicAddress`, a default resolver using `lookup(host, { all: true, verbatim: true })` that vets every address, and a tunnel opened to the vetted address, which also closes DNS rebinding (T-02-117, T-02-118). Layer 2 (conventions): `readHosts` refuses `localhost`, `*.localhost`, names with no dot and names whose last label is all digits or a `0x` form, with string operations only.
- The resolver seam is held out of production (T-02-119): the egress port is unchanged, `AllowlistEgressProxy` forwards `allow` and `onAttempt` by name, a runtime test smuggles a `resolve` property through the composed proxy and still gets a 403 for a live loopback server, and a footprint pin fails if any file under `src/` other than the proxy module names `startAllowlistProxy` or the class forwards more.
- Proven offline against live loopback echo servers: `localhost:<port>` and `127.0.0.1:<port>` are refused by the production proxy and the server accepts no connection. The only DNS in the tests is the OS lookup of `localhost`.
- run-deps now reaches its loopback registry as `registry.avarice.test`, mapped to 127.0.0.1 only through the test resolver.

## Task Commits

1. **Task 1: Tracer, proxy vetting** - `44d9383` (test, RED), `9ca3b92` (feat, GREEN)
2. **Task 2: conventions refusal** - `7447412` (test, RED), `1f0b131` (feat, GREEN)
3. **Task 3: docs/system** - `86e6fcb` (docs)

**Plan metadata:** the commit that adds this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

RED then GREEN commits exist for Tasks 1 and 2 (`test(02-34)` precedes `feat(02-34)` each time). No refactor commit.

- **RED, Task 1:** 43 tests reported, 10 fail: the `isPublicAddress` cases, the production refusals of `localhost`, `127.0.0.1`, link-local and private literals, the smuggled-`resolve` case, the vetted-address cases, the `node:dns/promises` import pin and resolver seam check (3). Semantic assessment: the target tests executed and failed on the planned assertions (a 200 where a 403 was expected). The test file cannot load without an `isPublicAddress` export, so the RED run used an uncommitted placeholder export that always answered true; it was reverted before the commit. Evidence: `02-34-red-evidence-task1.json`.
- **RED, Task 2:** 24 tests reported, 1 fails: the local-host refusal case, with all twelve forms accepted (the `127.0.0.1` and `2130706433` cases among them). The case collects every accepted host so the failure names them all. Evidence: `02-34-red-evidence-task2.json`.

## Files Created/Modified

- `src/adapters/exec/allowlist-proxy.ts` - `isPublicAddress`, `ResolveHost`, the default resolver, the test-only `resolve` option, `admit` (resolve, record, connect to the vetted address), the composed proxy forwarding two names
- `src/domain/conventions.ts` - `readHosts` refuses local-only hosts
- `test/integration/allowlist-proxy.test.ts` - address cases, production refusals, vetted-address cases, the smuggled `resolve`
- `test/unit/footprint.test.ts` - proxy imports pinned to `node:dns/promises`, `node:http`, `node:net`; the resolver seam describe (three tests)
- `test/unit/conventions.test.ts`, `test/integration/run-deps.test.ts` - refused and accepted host lists; the named test registry and its resolver
- `docs/system/containment.md`, `config-reference.md`, `integrations.md` - address check, host rules, private-registry consequence

## Decisions Made

See key-decisions. Notes for the owner and for plan 02-35:

- **Footprint pin change (on purpose):** the proxy's allowed network imports changed from `node:http`, `node:net` to `node:dns/promises`, `node:http`, `node:net`. The rule that the proxy is the only listener and stays on 127.0.0.1 is unchanged, and the "no source file imports a network module" scan still excludes only the proxy module.
- **Private-registry consequence (owner check, flagged assumption):** after this plan an install cannot reach a registry on a private network: a LAN mirror, an RFC 1918 or CGNAT address, a public name that resolves to a private address (split-horizon DNS), an IP literal, `localhost` or a single-label name. A stored run contract that names such a host fails at the proxy on install. Reverting is a code change with no stored-data migration.
- Documentation updates for 02-35: the three documents are updated and need the fresh `technical-writer:prose-reviewer` pass. `coverage.md` was not touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The existing `AllowlistEgressProxy` test dialed 127.0.0.1 and expected 200**
- **Found during:** Task 1 (RED)
- **Issue:** with the address check, the composed proxy correctly refuses that tunnel, so the old test's expectation became wrong, not the code.
- **Fix:** the test now asserts the composed proxy starts, answers 403 outside the allowlist and reports the attempt. The loopback tunnel cases moved to the direct `startAllowlistProxy` tests with the test resolver.
- **Files modified:** test/integration/allowlist-proxy.test.ts
- **Committed in:** 44d9383

**2. [Rule 2 - Missing critical] The deprecated IPv4-compatible IPv6 form (`::a.b.c.d`) is refused**
- **Found during:** Task 1 (GREEN)
- **Issue:** the plan names `::` and `::1` only; `::7f00:1` would otherwise pass as public.
- **Fix:** the whole `::/96` prefix is refused.
- **Files modified:** src/adapters/exec/allowlist-proxy.ts
- **Committed in:** 9ca3b92

---

**Total deviations:** 2 auto-fixed (1 test expectation, 1 hardening)
**Impact on plan:** none on scope. The proxy's `502` for a name that does not resolve and the unchanged `403` for a non-allowlisted target (no resolution) pass at base and still pass.

## Issues Encountered

- The full `npm test` run reported 2 failures, both on the known load-sensitive list: the SIGTERM case in `test/integration/claude-host.test.ts` and the WR-07 probe case (FC-10) in `test/mutation/fail-closed.test.ts`. Running those two files alone passed (74 of 74). Full suite: 2629 tests, 2572 pass, 2 load-sensitive failures, 55 skipped; `npx tsc -p .` is clean. The full run came after the last code and docs change.
- The `test/containment/npm-ci-proxy.test.ts` suite (real DNS, gated by `AVARICE_NET=1`) was not run; it needs no change because `registry.npmjs.org` resolves to public addresses.

## Known Stubs

None.

## Threat Flags

None. The new surface (DNS lookup from the proxy) is covered by T-02-117, T-02-118 and T-02-119.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 02-35 (documentation pass): review the three updated documents, record the footprint pin change and the private-registry consequence in coverage and findings as needed.

## Self-Check: PASSED

- Files: the two RED evidence files, the proxy module, conventions, the five test files and the three documents exist.
- Commits `44d9383`, `9ca3b92`, `7447412`, `1f0b131`, `86e6fcb` are ancestors of HEAD; `git rev-list --count 65061d8..HEAD` was 5 before this SUMMARY.
- Acceptance criteria: `isPublicAddress` exported once; `connect(target.port, target.host)` gone; `git diff --quiet -- src/ports/egress-proxy.ts` exits 0; four lines match "resolver seam" in the footprint test; the resolver seam run passes 3 of 3; the stale "applies no check to the address" sentence is gone.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-07*
